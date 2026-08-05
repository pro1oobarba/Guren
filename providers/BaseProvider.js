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

  /** Отправляет сообщения модели и возвращает текст ответа (строка) */
  async chat(_modelId, _messages, _options = {}) {
    throw new Error(`${this.name}: chat() не реализован`);
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
