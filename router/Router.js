import { log } from '../utils/logger.js';
import { getModelTier } from './modelTiers.js';

/**
 * Ключевые слова-подсказки — вторичный сигнал поверх tier (см. modelTiers.js).
 * Разруливает выбор между моделями одного tier под конкретную задачу.
 */
const TASK_KEYWORDS = {
  code: ['coder', 'code', 'deepseek', 'qwen', 'devstral', 'codestral'],
  roleplay: ['dolphin', 'hermes', 'nous', 'mythomax', 'chat'],
  analysis: ['70b', '72b', '405b', 'large', 'instruct'],
  general: ['instruct', 'chat'],
};

// ping() в HealthChecker уже был с таймаутом — реальный chat() в execute()
// таймаута не имел вообще: зависший провайдер вешал AI.generate() навсегда.
const DEFAULT_TIMEOUT_MS = 45_000;

// Разброс джиттера сопоставим по величине с latencyScore/aliveBonus —
// не перекрывает разницу между tier (×1000) или strength/keyword (×100/10),
// но у моделей одного tier с похожей задержкой порядок в ранге перестаёт
// быть жёстко детерминированным. Без этого один и тот же топ-кандидат
// получал бы весь трафик, съедая свою дневную квоту в одиночку, пока
// другая модель того же tier простаивала бы.
const JITTER_MAX = 5;

export class Router {
  constructor({ providers, registry, random = Math.random }) {
    this.providers = providers;
    this.registry = registry;
    this.random = random; // инъекция для детерминированных тестов
  }

  /**
   * Ранжирует живые модели под задачу. Главный сигнал — tier (реальная
   * "весовая категория" модели, см. modelTiers.js), внутри одного tier
   * решают: совпадение по strengths/ключевым словам под задачу, задержка
   * и небольшой случайный джиттер — чтобы нагрузка внутри tier не всегда
   * шла в одного и того же кандидата. Раньше latency и keyword-совпадение
   * перевешивали силу модели — 8B-модель с удачным словом в имени могла
   * обойти 70B. Теперь нет: tier остаётся главным сигналом.
   */
  rank(task) {
    const keywords = TASK_KEYWORDS[task] ?? TASK_KEYWORDS.general;
    // eligible(), не alive(): остывшие мёртвые модели (retryAfter истёк)
    // тоже участвуют — реальный вызов в execute() либо оживит их обратно,
    // либо вернёт в кулдаун. Так health не застревает на состоянии
    // разового прогона при старте процесса.
    const candidates = this.registry.eligible();
    const scored = candidates.map((entry) => {
      const idLower = entry.modelId.toLowerCase();
      const { tier, strengths } = getModelTier(idLower);
      const strengthBonus = strengths.includes(task) ? 1 : 0;
      const keywordScore = keywords.reduce((sum, kw) => (idLower.includes(kw) ? sum + 1 : sum), 0);
      const latencyScore = entry.latency ? 1000 / entry.latency : 0;
      const aliveBonus = entry.alive ? 5 : 0; // при равном tier подтверждённо живая модель приоритетнее остывшей
      const jitter = this.random() * JITTER_MAX;
      const score = tier * 1000 + strengthBonus * 100 + keywordScore * 10 + aliveBonus + latencyScore + jitter;
      return { ...entry, tier, score };
    });
    return scored.sort((a, b) => b.score - a.score);
  }

  /** Пробует модели по рангу, при ошибке/таймауте помечает мёртвой и переходит к следующей (авто-fallback) */
  async execute({ task, messages, timeoutMs = DEFAULT_TIMEOUT_MS, tools, toolChoice, responseFormat, maxTokens, stream, onToken }) {
    const candidates = this.rank(task);
    if (!candidates.length) {
      throw new Error('Нет доступных моделей — запусти AI.init() для health-check или проверь .env');
    }

    let lastError;
    for (const candidate of candidates) {
      const provider = this.providers[candidate.provider];
      if (!provider?.enabled) continue;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        log.info(`→ пробуем ${candidate.provider}/${candidate.modelId}`);
        const result = await provider.chat(candidate.modelId, messages, {
          signal: controller.signal,
          tools,
          toolChoice,
          responseFormat,
          maxTokens,
          stream,
          onToken,
        });
        return {
          text: result.content,
          toolCalls: result.toolCalls ?? null,
          usage: result.usage ?? null,
          provider: candidate.provider,
          modelId: candidate.modelId,
        };
      } catch (err) {
        // Стрим оборвался ПОСЛЕ того, как часть текста уже ушла вызывающему
        // через onToken — пользователь уже что-то увидел, молча пробовать
        // другую модель означало бы либо задвоить, либо незаметно оборвать
        // ответ на середине. Отдаём ошибку с тем, что успело прийти, наверх,
        // без fallback и без пометки модели мёртвой (частичный успех — не
        // однозначный признак что модель нерабочая).
        if (err.partialContent !== undefined) {
          const partialErr = new Error(err.message);
          partialErr.partialContent = err.partialContent;
          partialErr.provider = candidate.provider;
          partialErr.modelId = candidate.modelId;
          throw partialErr;
        }

        const message = err.name === 'AbortError' ? `таймаут ${timeoutMs}мс` : err.message;
        lastError = new Error(message);
        log.warn(`✗ ${candidate.provider}/${candidate.modelId} — ${message}, пробуем следующую модель`);
        this.registry.upsert(candidate.provider, candidate.modelId, { alive: false, error: message });
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error(`Все подходящие модели недоступны. Последняя ошибка: ${lastError?.message}`);
  }
}
