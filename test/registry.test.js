import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelRegistry } from '../registry/ModelRegistry.js';

test('живая модель остаётся в eligible()', () => {
  const reg = new ModelRegistry();
  reg.upsert('groq', 'm', { alive: true, latency: 100 });
  assert.equal(reg.eligible().length, 1);
});

test('мёртвая модель с не истёкшим кулдауном исключена из eligible()', () => {
  const reg = new ModelRegistry();
  reg.upsert('groq', 'm', { alive: false, error: 'network timeout' });
  assert.equal(reg.eligible().length, 0);
});

test('мёртвая модель после истечения retryAfter возвращается в eligible()', () => {
  const reg = new ModelRegistry();
  reg.upsert('groq', 'm', { alive: false, error: 'network timeout' });
  const entry = reg.get('groq', 'm');
  entry.retryAfter = Date.now() - 1; // подделываем истёкший кулдаун
  assert.equal(reg.eligible().length, 1);
});

test('дневная квота/пустой баланс получает длинный кулдаун (часы), не короткий', () => {
  const reg = new ModelRegistry();
  const before = Date.now();
  const entry = reg.upsert('deepinfra', 'm', {
    alive: false,
    error: 'DeepInfra HTTP 402: You need positive balance to do inference.',
  });
  const cooldownMs = entry.retryAfter - before;
  assert.ok(cooldownMs > 60 * 60 * 1000, `ожидали кулдаун > 1 часа, получили ${cooldownMs}мс`);
});

test('обычный rate limit получает короткий кулдаун (минуты), не часы', () => {
  const reg = new ModelRegistry();
  const before = Date.now();
  const entry = reg.upsert('groq', 'm', {
    alive: false,
    error: 'Groq HTTP 429: Rate limit reached for model (TPM)',
  });
  const cooldownMs = entry.retryAfter - before;
  assert.ok(cooldownMs < 60 * 60 * 1000, `ожидали кулдаун < 1 часа, получили ${cooldownMs}мс`);
});

test('alive: true сбрасывает retryAfter', () => {
  const reg = new ModelRegistry();
  reg.upsert('groq', 'm', { alive: false, error: 'timeout' });
  const revived = reg.upsert('groq', 'm', { alive: true, latency: 50 });
  assert.equal(revived.retryAfter, null);
});
