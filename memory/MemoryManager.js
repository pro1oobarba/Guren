import fs from 'node:fs';

const DEFAULT_STORE_PATH = new URL('../memory-store.json', import.meta.url);

// Без ограничений история сессии растёт бесконечно: файл на диске
// раздувается, а рано или поздно суммарная длина истории превысит context
// window модели и AI.generate() начнёт падать вместо ответа. Два независимых
// лимита: сколько сообщений вообще хранить на диске, и сколько из них
// (по грубой оценке символы/4 ≈ токены) реально уйдёт в запрос модели.
const DEFAULT_MAX_STORED_MESSAGES = 60;
const DEFAULT_MAX_CONTEXT_CHARS = 24_000; // ~6000 токенов — под самые скромные бесплатные модели

/**
 * MemoryManager — история сообщений по sessionId, персистентная в JSON-файле.
 * Пишется синхронно на каждый append/clear: история чата — это не поток
 * данных, а редкие точечные записи, синхронная запись проще и не рискует
 * гонкой при параллельных сессиях в одном процессе.
 * API не поменялся (get/append/buildMessages/clear) — весь остальной код
 * (Router, kernel.js) ничего не знает о персистентности.
 */
export class MemoryManager {
  constructor({
    storePath = DEFAULT_STORE_PATH,
    maxStoredMessages = DEFAULT_MAX_STORED_MESSAGES,
    maxContextChars = DEFAULT_MAX_CONTEXT_CHARS,
  } = {}) {
    this.storePath = storePath;
    this.maxStoredMessages = maxStoredMessages;
    this.maxContextChars = maxContextChars;
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
    if (history.length > this.maxStoredMessages) {
      history.splice(0, history.length - this.maxStoredMessages);
    }
    this.sessions.set(sessionId, history);
    this.#save();
  }

  /** Берёт самые свежие сообщения, пока их суммарная длина укладывается в бюджет. */
  #trimToBudget(history) {
    const kept = [];
    let total = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      total += history[i].content.length;
      // Даже если самое свежее сообщение само по себе больше бюджета,
      // отдаём хотя бы его — пустой историей отвечать нечем, но пусто
      // разговаривать с моделью не имеет смысла.
      if (total > this.maxContextChars && kept.length > 0) break;
      kept.unshift(history[i]);
    }
    return kept;
  }

  buildMessages(sessionId, { systemPrompt, prompt }) {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push(...this.#trimToBudget(this.get(sessionId)));
    messages.push({ role: 'user', content: prompt });
    return messages;
  }

  clear(sessionId) {
    this.sessions.delete(sessionId);
    this.#save();
  }
}
