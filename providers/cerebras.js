import { BaseProvider } from './BaseProvider.js';

/**
 * Cerebras — OpenAI-совместимый эндпоинт, инференс на wafer-scale чипах.
 * Бесплатный лимит: щедрый дневной лимит без карты.
 * Ключ: https://cloud.cerebras.ai/platform/apikeys
 */
export class CerebrasProvider extends BaseProvider {
  constructor({ apiKey }) {
    super({
      name: 'cerebras',
      apiKey,
      baseUrl: 'https://api.cerebras.ai/v1',
      enabled: Boolean(apiKey),
    });
  }

  async listModels() {
    if (!this.enabled) return [];
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`Cerebras listModels: HTTP ${res.status}`);
    const data = await res.json();
    return (data.data ?? []).map((m) => ({
      id: m.id,
      provider: this.name,
      contextWindow: m.context_window ?? null,
    }));
  }

  async chat(modelId, messages, options = {}) {
    if (!this.enabled) throw new Error('Cerebras выключен — нет CEREBRAS_API_KEY в .env');
    const args = { baseUrl: this.baseUrl, apiKey: this.apiKey, modelId, messages, options };
    return options.stream ? this._openAIChatStream(args) : this._openAIChat(args);
  }
}
