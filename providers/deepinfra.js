import { BaseProvider } from './BaseProvider.js';

/**
 * DeepInfra — OpenAI-совместимый эндпоинт, много открытых моделей.
 * Платный по токенам, но цены очень низкие; листинг моделей бесплатный.
 * Ключ: https://deepinfra.com/dash/api_keys
 */
export class DeepInfraProvider extends BaseProvider {
  constructor({ apiKey }) {
    super({
      name: 'deepinfra',
      apiKey,
      baseUrl: 'https://api.deepinfra.com/v1/openai',
      enabled: Boolean(apiKey),
    });
  }

  async listModels() {
    if (!this.enabled) return [];
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`DeepInfra listModels: HTTP ${res.status}`);
    const data = await res.json();
    return (data.data ?? []).map((m) => ({
      id: m.id,
      provider: this.name,
      contextWindow: m.context_window ?? null,
    }));
  }

  async chat(modelId, messages, options = {}) {
    if (!this.enabled) throw new Error('DeepInfra выключен — нет DEEPINFRA_API_KEY в .env');
    const args = { baseUrl: this.baseUrl, apiKey: this.apiKey, modelId, messages, options };
    return options.stream ? this._openAIChatStream(args) : this._openAIChat(args);
  }
}
