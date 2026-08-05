import { BaseProvider } from './BaseProvider.js';

/**
 * Hyperbolic — OpenAI-совместимый эндпоинт.
 * Бесплатный стартовый кредит без карты.
 * Ключ: https://app.hyperbolic.xyz/settings
 */
export class HyperbolicProvider extends BaseProvider {
  constructor({ apiKey }) {
    super({
      name: 'hyperbolic',
      apiKey,
      baseUrl: 'https://api.hyperbolic.xyz/v1',
      enabled: Boolean(apiKey),
    });
  }

  async listModels() {
    if (!this.enabled) return [];
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`Hyperbolic listModels: HTTP ${res.status}`);
    const data = await res.json();
    return (data.data ?? []).map((m) => ({
      id: m.id,
      provider: this.name,
      contextWindow: m.context_window ?? null,
    }));
  }

  async chat(modelId, messages, options = {}) {
    if (!this.enabled) throw new Error('Hyperbolic выключен — нет HYPERBOLIC_API_KEY в .env');
    const args = { baseUrl: this.baseUrl, apiKey: this.apiKey, modelId, messages, options };
    return options.stream ? this._openAIChatStream(args) : this._openAIChat(args);
  }
}
