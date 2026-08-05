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
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.7,
      }),
      signal: options.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Cerebras HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }
}
