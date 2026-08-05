// Сколько ждать перед повторной попыткой мёртвой модели.
// - daily: дневная квота (RPD) или пустой баланс — само не пройдёт до
//   завтра/пополнения, нет смысла дёргать каждые пару минут.
// - rateLimit: RPM/TPM — короткий лимит в моменте, обычно снимается
//   за секунды-минуты.
// - error: сеть/таймаут/прочее — возможно, разовый сбой.
const COOLDOWN_MS = {
  daily: 6 * 60 * 60 * 1000,
  rateLimit: 10 * 60 * 1000,
  error: 2 * 60 * 1000,
};

// Порядок важен: сначала проверяем более специфичный "дневной/баланс"
// признак, иначе общий 429 перекрыл бы более узкий daily-кейс.
const DAILY_QUOTA_RE =
  /\bRPD\b|daily|per day|payment required|positive balance|insufficient funds|need positive|depleted|monthly|credits/i;
const RATE_LIMIT_RE = /\b(429|402)\b|quota|rate limit|too many requests/i;

/**
 * ModelRegistry — хранилище стейта моделей: жива/мертва, задержка, ошибка.
 * Ничего не знает о провайдерах и о том, как делать запросы — только стейт.
 * Мёртвая модель не остаётся мёртвой навсегда: у неё выставляется
 * retryAfter, и после остывания она снова попадает в eligible() —
 * следующий реальный запрос через Router её опробует заново.
 */
export class ModelRegistry {
  constructor() {
    this.entries = new Map(); // key: "provider:modelId" -> entry
  }

  key(provider, modelId) {
    return `${provider}:${modelId}`;
  }

  upsert(provider, modelId, patch) {
    const k = this.key(provider, modelId);
    const prev = this.entries.get(k) ?? { provider, modelId };
    const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };

    if (patch.alive === false) {
      const message = patch.error ?? '';
      const cooldown = DAILY_QUOTA_RE.test(message)
        ? COOLDOWN_MS.daily
        : RATE_LIMIT_RE.test(message)
          ? COOLDOWN_MS.rateLimit
          : COOLDOWN_MS.error;
      next.retryAfter = Date.now() + cooldown;
    } else if (patch.alive === true) {
      next.retryAfter = null;
    }

    this.entries.set(k, next);
    return next;
  }

  get(provider, modelId) {
    return this.entries.get(this.key(provider, modelId));
  }

  all() {
    return Array.from(this.entries.values());
  }

  alive() {
    return this.all().filter((e) => e.alive === true);
  }

  /** Живые + остывшие мёртвые (retryAfter истёк) — кандидаты для реальной попытки. */
  eligible() {
    const now = Date.now();
    return this.all().filter((e) => e.alive === true || (e.alive === false && e.retryAfter && e.retryAfter <= now));
  }

  toJSON() {
    return this.all();
  }
}
