import fs from 'node:fs';

const DEFAULT_STORE_PATH = new URL('../memory-store.json', import.meta.url);

/**
 * MemoryManager — история сообщений по sessionId, персистентная в JSON-файле.
 * Пишется синхронно на каждый append/clear: история чата — это не поток
 * данных, а редкие точечные записи, синхронная запись проще и не рискует
 * гонкой при параллельных сессиях в одном процессе.
 * API не поменялся (get/append/buildMessages/clear) — весь остальной код
 * (Router, kernel.js) ничего не знает о персистентности.
 */
export class MemoryManager {
  constructor({ storePath = DEFAULT_STORE_PATH } = {}) {
    this.storePath = storePath;
    this.sessions = this.#load();
  }

  #load() {
    try {
      const raw = fs.readFileSync(this.storePath, 'utf-8');
      return new Map(Object.entries(JSON.parse(raw)));
    } catch {
      return new Map();
    }
  }

  #save() {
    const obj = Object.fromEntries(this.sessions);
    fs.writeFileSync(this.storePath, JSON.stringify(obj, null, 2), 'utf-8');
  }

  get(sessionId) {
    if (!sessionId) return [];
    return this.sessions.get(sessionId) ?? [];
  }

  append(sessionId, role, content) {
    if (!sessionId) return;
    const history = this.sessions.get(sessionId) ?? [];
    history.push({ role, content });
    this.sessions.set(sessionId, history);
    this.#save();
  }

  buildMessages(sessionId, { systemPrompt, prompt }) {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push(...this.get(sessionId));
    messages.push({ role: 'user', content: prompt });
    return messages;
  }

  clear(sessionId) {
    this.sessions.delete(sessionId);
    this.#save();
  }
}
