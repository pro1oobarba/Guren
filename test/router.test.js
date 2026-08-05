import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../router/Router.js';
import { ModelRegistry } from '../registry/ModelRegistry.js';

test('tier перевешивает latency: сильная модель с плохим пингом обходит слабую с хорошим', () => {
  const registry = new ModelRegistry();
  // tier 1 (маленькая, "8b") — но очень быстрая
  registry.upsert('cloudflare', '@cf/meta/llama-3.1-8b-instruct', { alive: true, latency: 50 });
  // tier 3 (70b) — но заметно медленнее
  registry.upsert('sambanova', 'Meta-Llama-3.3-70B-Instruct', { alive: true, latency: 2000 });

  const router = new Router({ providers: {}, registry });
  const ranked = router.rank('general');

  assert.equal(ranked[0].modelId, 'Meta-Llama-3.3-70B-Instruct', 'сильная модель должна быть первой несмотря на latency');
});

test('rank() включает остывшие мёртвые модели (eligible), не только alive', () => {
  const registry = new ModelRegistry();
  registry.upsert('groq', 'm', { alive: false, error: 'timeout' });
  const entry = registry.get('groq', 'm');
  entry.retryAfter = Date.now() - 1;

  const router = new Router({ providers: {}, registry });
  const ranked = router.rank('general');

  assert.equal(ranked.length, 1);
});

test('execute() делает fallback на следующую модель при ошибке первой', async () => {
  const registry = new ModelRegistry();
  registry.upsert('bad', 'm1', { alive: true, latency: 50 });
  registry.upsert('good', 'm2', { alive: true, latency: 50 });

  const providers = {
    bad: { enabled: true, chat: async () => { throw new Error('boom'); } },
    good: { enabled: true, chat: async () => 'ok' },
  };

  const router = new Router({ providers, registry });
  const result = await router.execute({ task: 'general', messages: [] });

  assert.equal(result.text, 'ok');
  assert.equal(registry.get('bad', 'm1').alive, false, 'упавшая модель должна быть помечена мёртвой');
});

test('execute() кидает понятную ошибку, если кандидатов нет вообще', async () => {
  const registry = new ModelRegistry();
  const router = new Router({ providers: {}, registry });
  await assert.rejects(() => router.execute({ task: 'general', messages: [] }), /Нет доступных моделей/);
});
