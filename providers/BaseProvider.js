/**
 * BaseProvider — базовый (абстрактный) класс для всех AI-провайдеров.
 * Паттерн: Стратегия. Каждый провайдер реализует listModels() и chat(),
 * а ping()/health-check логика общая и живёт здесь.
 */
export class BaseProvider {
  constructor({ name, apiKey, baseUrl, enabled = true }) {
    if (new.target === BaseProvider) {
      throw new Error('BaseProvider — абстрактный класс, наследуйся от него, не создавай напрямую');
    }
    this.name = name;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.enabled = enabled;
  }

  /** Возвращает список моделей: [{ id, provider, contextWindow? }] */
  async listModels() {
    throw new Error(`${this.name}: listModels() не реализован`);
  }

  /**
   * Отправляет сообщения модели.
   * @returns {Promise<{ content: string, toolCalls: object[] | null }>}
   */
  async chat(_modelId, _messages, _options = {}) {
    throw new Error(`${this.name}: chat() не реализован`);
  }

  /**
   * Общая реализация для всех OpenAI-совместимых эндпоинтов
   * (/chat/completions) — большинство провайдеров ядра именно такие.
   * Cloudflare (свой формат запроса/ответа) и GitHub (заглушка) её не используют.
   * options.tools/toolChoice пробрасываются как есть (формат OpenAI tools API).
   */
  async _openAIChat({ baseUrl, apiKey, modelId, messages, options = {}, extraHeaders = {} }) {
    const body = {
      model: modelId,
      messages,
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.7,
    };
    if (options.tools) body.tools = options.tools;
    if (options.toolChoice) body.tool_choice = options.toolChoice;

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${this.name} HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const message = data.choices?.[0]?.message ?? {};
    return { content: message.content ?? '', toolCalls: message.tool_calls ?? null };
  }

  /**
   * Стриминговая версия _openAIChat: разбирает SSE (`data: {...}\n\n`,
   * `data: [DONE]`) вручную — без зависимостей, формат простой. На каждый
   * кусок текста дёргает options.onToken(delta), в конце отдаёт полный
   * склеенный текст (для памяти/лога) — так вызывающему коду не нужно
   * самому склеивать чанки, если стриминг нужен только для UX "печатает...".
   *
   * Tool-calling во время стриминга не собирается (deltas для tool_calls
   * приходят по кусочкам аргументов и их сборка — отдельная нетривиальная
   * задача) — если нужны и tools, и стрим одновременно, для этого запроса
   * используй обычный _openAIChat().
   *
   * Если поток оборвался ПОСЛЕ того, как хотя бы один токен уже ушёл
   * вызывающему через onToken — это не тихая ошибка для fallback на
   * следующую модель (пользователь уже увидел частичный ответ, молча
   * подменять модель было бы странно). Бросаем ошибку с полем
   * partialContent, Router.execute() на это смотрит и не делает fallback.
   */
  async _openAIChatStream({ baseUrl, apiKey, modelId, messages, options = {}, extraHeaders = {} }) {
    const body = {
      model: modelId,
      messages,
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.7,
      stream: true,
    };

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${this.name} HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.body) throw new Error(`${this.name}: сервер не вернул потоковое тело ответа`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // неполная строка — ждём следующего чтения

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]' || payload === '') continue;

          let chunk;
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue; // битый/разорванный между чтениями JSON-кусок — пропускаем, не роняем весь стрим
          }
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            content += delta;
            options.onToken?.(delta);
          }
        }
      }
    } catch (err) {
      if (content) {
        const wrapped = new Error(`${this.name}: обрыв потока после частичного ответа — ${err.message}`);
        wrapped.partialContent = content;
        throw wrapped;
      }
      throw err;
    } finally {
      reader.releaseLock();
    }

    return { content, toolCalls: null };
  }

  /**
   * Короткий health-check: шлёт "ping" и измеряет задержку.
   * Возвращает { alive, latency, error? }
   */
  async ping(modelId, timeoutMs = 12000) {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await this.chat(modelId, [{ role: 'user', content: 'ping' }], {
        maxTokens: 5,
        signal: controller.signal,
      });
      clearTimeout(timer);
      return { alive: true, latency: Date.now() - start };
    } catch (err) {
      clearTimeout(timer);
      return { alive: false, latency: Date.now() - start, error: err.message };
    }
  }
}
