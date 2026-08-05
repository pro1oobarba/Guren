/**
 * Ручная таблица "силы" модели по семейству — заменяет угадывание по
 * ключевым словам в id. Семейства моделей (DeepSeek-V3, Llama-70B,
 * GPT-OSS-120B и т.д.) повторяются у разных бесплатных провайдеров и их
 * относительное качество не скачет от недели к неделе, даже когда
 * конкретный каталог (особенно у OpenRouter) меняется — поэтому статичная
 * таблица не требует непрерывного переобучения, только редких правок,
 * когда появляется новое заметное семейство.
 *
 * tier: 3 — крупные/сильные модели (70B+, флагманские MoE), годятся под
 *           код и анализ.
 *       2 — среднего размера, крепкий универсал.
 *       1 — маленькие/edge-модели (≤8B) — быстро, но слабее в рассуждениях.
 * Модель, которая не подошла ни под один паттерн, получает tier по
 * умолчанию (2) — не наказываем и не превозносим неизвестное.
 */
const MODEL_TIERS = [
  { match: /deepseek-v3|deepseek-r1/i, tier: 3, strengths: ['code', 'analysis'] },
  { match: /gpt-oss-120b/i, tier: 3, strengths: ['code', 'analysis', 'general'] },
  { match: /llama-3\.[13]-70b|llama-3\.3-70b/i, tier: 3, strengths: ['general', 'roleplay', 'analysis'] },
  { match: /qwen.*(coder|72b|480b)/i, tier: 3, strengths: ['code'] },
  { match: /(72b|70b|405b|120b|235b)/i, tier: 3, strengths: ['analysis'] },
  { match: /qwen/i, tier: 2, strengths: ['code', 'general'] },
  { match: /gemma-4|gemma-3-12b|gemma-3\b/i, tier: 2, strengths: ['general'] },
  { match: /(32b|27b|24b|20b)/i, tier: 2, strengths: ['general', 'analysis'] },
  { match: /(8b|7b|3b|2b|1b|mini|lite|nano|guard)/i, tier: 1, strengths: ['general'] },
];

const DEFAULT_TIER = { tier: 2, strengths: ['general'] };

/** Возвращает { tier, strengths } для id модели по первому совпавшему паттерну. */
export function getModelTier(modelId) {
  const idLower = modelId.toLowerCase();
  const match = MODEL_TIERS.find((entry) => entry.match.test(idLower));
  return match ?? DEFAULT_TIER;
}
