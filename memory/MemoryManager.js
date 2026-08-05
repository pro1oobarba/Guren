import fs from 'node:fs';

const DEFAULT_STORE_PATH = new URL('../memory-store.json', import.meta.url);

// Без ограничений история сессии растёт бесконечно: файл на диске
// раздувается, а рано или поздно суммарная длина истории превысит context
// window модели и AI.generate() начнёт падать вместо ответа. Два независимых
// лимита: сколько сообщений вообще хранить на диске, и сколько из них
// (по грубой оценке символы/4 ≈ токены) реально уйдёт в запрос модели.
const DEFAULT_MAX_STORED_MESSAGES = 60;
const DEFAULT_MAX_CONTEXT_CHARS = 24_000; // ~6000 токенов — под самые скромные бесплатные модели

// "Амнезия": без этого длинный диалог рано или поздно вытесняет самое первое
// сообщение сессии — а это обычно системная завязка/лор ("ты волшебник в
// городе N", листы персонажа, правила мира), которую вызывающий код положил
// в самое начало намеренно. 2 сообщения = первая пара user+assistant.
const DEFAULT_STICKY_MESSAGES = 2;

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
    stickyMessages = DEFAULT_STICKY_MESSAGES,
  } = {}) {
    this.storePath = storePath;
    this.maxStoredMessages = maxStoredMessages;
    this.maxContextChars = maxContextChars;
    this.stickyMessages = stickyMessages;
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

  /**
   * Берёт самые свежие сообщения, пока их суммарная длина укладывается в
   * бюджет — но сначала безусловно резервирует место под первые
   * `stickyMessages` (обычно первая пара user+assistant: завязка кампании,
   * системный лор, лист персонажа). Без этого длинный диалог рано или
   * поздно вытесняет именно то сообщение, которое вызывающий код положил в
   * начало намеренно — история "продолжается", но модель забывает, с чего
   * всё началось.
   */
  #trimToBudget(history) {
    if (history.length === 0) return [];

    const sticky = history.slice(0, this.stickyMessages);
    const rest = history.slice(sticky.length);

    const stickyChars = sticky.reduce((sum, m) => sum + m.content.length, 0);
    const tailBudget = this.maxContextChars - stickyChars;

    const kept = [];
    let total = 0;
    for (let i = rest.length - 1; i >= 0; i--) {
      total += rest[i].content.length;
      // Даже если самое свежее сообщение само по себе больше бюджета,
      // отдаём хотя бы его — пустой историей отвечать нечем, но пусто
      // разговаривать с моделью не имеет смысла.
      if (total > tailBudget && kept.length > 0) break;
      kept.unshift(rest[i]);
    }
    return [...sticky, ...kept];
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
