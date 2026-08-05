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

export class Router {
  constructor({ providers, registry }) {
    this.providers = providers;
    this.registry = registry;
  }

  /**
   * Ранжирует живые модели под задачу. Главный сигнал — tier (реальная
   * "весовая категория" модели, см. modelTiers.js), внутри одного tier
   * решают: совпадение по strengths/ключевым словам под задачу, затем
   * задержка. Раньше latency и keyword-совпадение перевешивали силу модели —
   * 8B-модель с удачным словом в имени могла обойти 70B. Теперь нет.
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
      const score = tier * 1000 + strengthBonus * 100 + keywordScore * 10 + aliveBonus + latencyScore;
      return { ...entry, tier, score };
    });
    return scored.sort((a, b) => b.score - a.score);
  }

  /** Пробует модели по рангу, при ошибке помечает мёртвой и переходит к следующей (авто-fallback) */
  async execute({ task, messages }) {
    const candidates = this.rank(task);
    if (!candidates.length) {
      throw new Error('Нет доступных моделей — запусти AI.init() для health-check или проверь .env');
    }

    let lastError;
    for (const candidate of candidates) {
      const provider = this.providers[candidate.provider];
      if (!provider?.enabled) continue;

      try {
        log.info(`→ пробуем ${candidate.provider}/${candidate.modelId}`);
        const text = await provider.chat(candidate.modelId, messages);
        return { text, provider: candidate.provider, modelId: candidate.modelId };
      } catch (err) {
        lastError = err;
        log.warn(`✗ ${candidate.provider}/${candidate.modelId} — ${err.message}, пробуем следующую модель`);
        this.registry.upsert(candidate.provider, candidate.modelId, { alive: false, error: err.message });
      }
    }

    throw new Error(`Все подходящие модели недоступны. Последняя ошибка: ${lastError?.message}`);
  }
}
