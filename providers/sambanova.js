import { BaseProvider } from './BaseProvider.js';

/**
 * SambaNova Cloud — OpenAI-совместимый эндпоинт.
 * Бесплатный лимит: дневной лимит без карты.
 * Ключ: https://cloud.sambanova.ai/apis
 */
export class SambaNovaProvider extends BaseProvider {
  constructor({ apiKey }) {
    super({
      name: 'sambanova',
      apiKey,
      baseUrl: 'https://api.sambanova.ai/v1',
      enabled: Boolean(apiKey),
    });
  }

  async listModels() {
    if (!this.enabled) return [];
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`SambaNova listModels: HTTP ${res.status}`);
    const data = await res.json();
    return (data.data ?? []).map((m) => ({
      id: m.id,
      provider: this.name,
      contextWindow: m.context_window ?? null,
    }));
  }

  async chat(modelId, messages, options = {}) {
    if (!this.enabled) throw new Error('SambaNova выключен — нет SAMBANOVA_API_KEY в .env');
    return this._openAIChat({ baseUrl: this.baseUrl, apiKey: this.apiKey, modelId, messages, options });
  }
}
