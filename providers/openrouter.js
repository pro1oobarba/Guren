import { BaseProvider } from './BaseProvider.js';

/**
 * OpenRouter — сотни моделей за одним ключом.
 * listModels({ freeOnly: true }) отфильтровывает только бесплатные
 * (pricing.prompt === 0 И pricing.completion === 0, либо id оканчивается на ":free"),
 * чтобы health-check не тратил лимиты и не улетал в rate limit на платных моделях.
 * Бесплатный лайнап меняется каждую неделю — это ожидаемо, поэтому список моделей
 * всегда запрашивается заново, а не хардкодится.
 * Ключ: https://openrouter.ai/keys
 */
export class OpenRouterProvider extends BaseProvider {
  constructor({ apiKey, siteUrl, appName }) {
    super({
      name: 'openrouter',
      apiKey,
      baseUrl: 'https://openrouter.ai/api/v1',
      enabled: Boolean(apiKey),
    });
    this.siteUrl = siteUrl || 'http://localhost';
    this.appName = appName || 'AI-Kernel';
  }

  async listModels({ freeOnly = true } = {}) {
    if (!this.enabled) return [];
    const res = await fetch(`${this.baseUrl}/models`);
    if (!res.ok) throw new Error(`OpenRouter listModels: HTTP ${res.status}`);
    const data = await res.json();
    let models = data.data ?? [];
    if (freeOnly) {
      models = models.filter((m) => {
        const promptFree = Number(m.pricing?.prompt ?? 1) === 0;
        const completionFree = Number(m.pricing?.completion ?? 1) === 0;
        return (promptFree && completionFree) || m.id.endsWith(':free');
      });
    }
    return models.map((m) => ({
      id: m.id,
      provider: this.name,
      contextWindow: m.context_length ?? null,
    }));
  }

  async chat(modelId, messages, options = {}) {
    if (!this.enabled) throw new Error('OpenRouter выключен — нет OPENROUTER_API_KEY в .env');
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': this.siteUrl,
        'X-Title': this.appName,
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
      throw new Error(`OpenRouter HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }
}
