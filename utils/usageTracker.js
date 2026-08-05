import fs from 'node:fs';

const DEFAULT_STORE_PATH = new URL('../usage.json', import.meta.url);

/**
 * UsageTracker — примерный расход по дням/провайдерам: сколько запросов
 * и (если провайдер вернул usage — не все делают это в стриме) сколько
 * токенов. Не претендует на точный биллинг — цель просто увидеть, что
 * какой-то бесплатный лимит скоро кончится, до того как он молча кончится
 * посреди работы. Персистентно в usage.json, тот же синхронный паттерн
 * записи, что и у MemoryManager.
 */
export class UsageTracker {
  constructor({ storePath = DEFAULT_STORE_PATH } = {}) {
    this.storePath = storePath;
    this.data = this.#load();
  }

  #load() {
    try {
      return JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));
    } catch {
      return {};
    }
  }

  #save() {
    fs.writeFileSync(this.storePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  #today() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  }

  /** @param {{ promptTokens?: number, completionTokens?: number } | null} [usage] */
  record(provider, modelId, usage) {
    const day = this.#today();
    this.data[day] ??= {};
    this.data[day][provider] ??= {};
    this.data[day][provider][modelId] ??= { requests: 0, promptTokens: 0, completionTokens: 0 };

    const entry = this.data[day][provider][modelId];
    entry.requests += 1;
    entry.promptTokens += usage?.promptTokens ?? 0;
    entry.completionTokens += usage?.completionTokens ?? 0;

    this.#save();
  }

  /** Расход за сегодня, сгруппированный по провайдеру/модели. */
  today() {
    return this.data[this.#today()] ?? {};
  }

  /** Весь накопленный расход по дням. */
  all() {
    return this.data;
  }
}
