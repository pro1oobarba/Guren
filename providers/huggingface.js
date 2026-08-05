import { BaseProvider } from './BaseProvider.js';

// Резерв на случай, если у роутера нет открытого /models на этом токене
const FALLBACK_MODELS = [
  'meta-llama/Llama-3.1-8B-Instruct:novita',
  'Qwen/Qwen2.5-7B-Instruct:novita',
];

/**
 * Hugging Face — через Inference Providers router (OpenAI-совместимый),
 * агрегирует несколько бесплатных inference-провайдеров под одним токеном.
 * Ключ: https://huggingface.co/settings/tokens
 */
export class HuggingFaceProvider extends BaseProvider {
  constructor({ apiKey }) {
    super({
      name: 'huggingface',
      apiKey,
      baseUrl: 'https://router.huggingface.co/v1',
      enabled: Boolean(apiKey),
    });
  }

  async listModels() {
    if (!this.enabled) return [];
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const models = (data.data ?? []).map((m) => ({ id: m.id, provider: this.name }));
      if (models.length) return models;
      throw new Error('пустой каталог');
    } catch {
      return FALLBACK_MODELS.map((id) => ({ id, provider: this.name }));
    }
  }

  async chat(modelId, messages, options = {}) {
    if (!this.enabled) throw new Error('HuggingFace выключен — нет HF_TOKEN в .env');
    const args = { baseUrl: this.baseUrl, apiKey: this.apiKey, modelId, messages, options };
    return options.stream ? this._openAIChatStream(args) : this._openAIChat(args);
  }
}
