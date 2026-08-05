import { BaseProvider } from './BaseProvider.js';

// Резервный список, если /ai/models/search недоступен на твоём аккаунте
const FALLBACK_MODELS = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-3.1-8b-instruct',
  '@cf/mistral/mistral-7b-instruct-v0.2',
  '@cf/google/gemma-3-12b-it',
];

/**
 * Cloudflare Workers AI — инференс на edge-сети Cloudflare.
 * Бесплатный лимит: 10 000 "нейронов" в день без карты.
 * Нужны: Account ID (dashboard.cloudflare.com -> любая страница, ID справа снизу)
 * и API Token (My Profile -> API Tokens -> с правом Workers AI).
 */
export class CloudflareProvider extends BaseProvider {
  constructor({ accountId, apiToken }) {
    super({
      name: 'cloudflare',
      apiKey: apiToken,
      baseUrl: accountId ? `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai` : null,
      enabled: Boolean(accountId && apiToken),
    });
    this.accountId = accountId;
  }

  async listModels() {
    if (!this.enabled) return [];
    try {
      const res = await fetch(`${this.baseUrl}/models/search?task=Text+Generation&per_page=50`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const models = (data.result ?? []).map((m) => ({ id: m.name, provider: this.name }));
      if (models.length) return models;
      throw new Error('пустой каталог');
    } catch {
      // На некоторых аккаунтах /models/search недоступен — используем проверенный резерв
      return FALLBACK_MODELS.map((id) => ({ id, provider: this.name }));
    }
  }

  async chat(modelId, messages, options = {}) {
    if (!this.enabled) {
      throw new Error('Cloudflare выключен — нет CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN в .env');
    }
    const res = await fetch(`${this.baseUrl}/run/${modelId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages, max_tokens: options.maxTokens ?? 1024 }),
      signal: options.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Cloudflare HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!data.success) throw new Error(`Cloudflare error: ${JSON.stringify(data.errors ?? [])}`);
    // Workers AI не поддерживает tools в этом формате запроса — toolCalls
    // всегда null, но контракт возврата тот же, что у остальных провайдеров.
    return { content: data.result?.response ?? '', toolCalls: null };
  }
}
