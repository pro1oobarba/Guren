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
    const args = { baseUrl: this.baseUrl, apiKey: this.apiKey, modelId, messages, options };
    return options.stream ? this._openAIChatStream(args) : this._openAIChat(args);
  }

  /**
   * Whisper-транскрипция (multipart, отдельный эндпоинт от chat completions).
   * Бесплатный лимит Groq покрывает и это — не нужен отдельный STT-провайдер.
   * @param {string} audioBase64
   * @param {string} filename расширение важно для Whisper (ogg/mp3/wav/...)
   * @returns {Promise<string>} распознанный текст
   */
  async transcribe(audioBase64, filename = 'audio.ogg') {
    if (!this.enabled) throw new Error('Groq выключен — нет GROQ_API_KEY в .env');
    const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    const form = new FormData();
    form.append('file', new Blob([bytes]), filename);
    form.append('model', 'whisper-large-v3-turbo');
    const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Groq transcribe: HTTP ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.text;
  }
}
