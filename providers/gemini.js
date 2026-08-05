import { BaseProvider } from './BaseProvider.js';

// Каталог отдаёт и TTS/image/robotics/research модели — они не принимают
// обычный текстовый chat.completions и только тратят слоты health-check.
const NON_CHAT = /(tts|image|lyria|robotics|computer-use|antigravity|research)/i;

/**
 * Google Gemini — через официальный OpenAI-совместимый слой
 * (v1beta/openai), чтобы не писать отдельный формат под generateContent.
 * Бесплатный лимит: щедрый дневной лимит на flash-модели без карты.
 * Ключ: https://aistudio.google.com/apikey
 */
export class GeminiProvider extends BaseProvider {
  constructor({ apiKey }) {
    super({
      name: 'gemini',
      apiKey,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      enabled: Boolean(apiKey),
    });
  }

  async listModels() {
    if (!this.enabled) return [];
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`Gemini listModels: HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.data ?? [])
      .filter((m) => !NON_CHAT.test(m.id))
      .map((m) => ({ id: m.id, provider: this.name, contextWindow: null }));
    // "Полные" Flash/Pro-модели дают всего 20 запросов/день на free tier —
    // Lite и Gemma-варианты дают 500-14400/день. Раз health-check ограничен
    // MAX_MODELS_PER_PROVIDER моделями, приоритет — моделям с большим
    // дневным лимитом, а не "престижным" полным версиям, иначе выборка сама
    // упирается в потолок за пару прогонов.
    const dailyQuotaRank = (id) => {
      if (/gemma/i.test(id)) return 3; // ~14 400 RPD
      if (/lite/i.test(id)) return 2; // ~500 RPD
      return 1; // полные Flash/Pro — ~20 RPD
    };
    models.sort((a, b) => dailyQuotaRank(b.id) - dailyQuotaRank(a.id));
    return models;
  }

  async chat(modelId, messages, options = {}) {
    if (!this.enabled) throw new Error('Gemini выключен — нет GEMINI_API_KEY в .env');
    return this._openAIChat({ baseUrl: this.baseUrl, apiKey: this.apiKey, modelId, messages, options });
  }
}
