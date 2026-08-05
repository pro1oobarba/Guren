import { BaseProvider } from './BaseProvider.js';

/**
 * Groq — OpenAI-совместимый эндпоинт, очень быстрый инференс (LPU).
 * Бесплатный лимит: ~1000 запросов/день без карты.
 * Ключ: https://console.groq.com/keys
 */
export class GroqProvider extends BaseProvider {
  constructor({ apiKey }) {
    super({
      name: 'groq',
      apiKey,
      baseUrl: 'https://api.groq.com/openai/v1',
      enabled: Boolean(apiKey),
    });
  }

  async listModels() {
    if (!this.enabled) return [];
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`Groq listModels: HTTP ${res.status}`);
    const data = await res.json();
    return (data.data ?? []).map((m) => ({
      id: m.id,
      provider: this.name,
      contextWindow: m.context_window ?? null,
    }));
  }

  async chat(modelId, messages, options = {}) {
    if (!this.enabled) throw new Error('Groq выключен — нет GROQ_API_KEY в .env');
    return this._openAIChat({ baseUrl: this.baseUrl, apiKey: this.apiKey, modelId, messages, options });
  }
}
