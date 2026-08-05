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
