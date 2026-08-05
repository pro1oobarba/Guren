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
  registry.upsert('good', 'm2', { alive: true, latency: 100 });

  const providers = {
    bad: { enabled: true, chat: async () => { throw new Error('boom'); } },
    good: { enabled: true, chat: async () => ({ content: 'ok', toolCalls: null }) },
  };

  // random: () => 0 убирает джиттер — иначе при равном tier порядок между
  // m1/m2 случаен и тест иногда пробовал бы только "good", ни разу не
  // тронув "bad" (флаки-тест, а не баг в коде).
  const router = new Router({ providers, registry, random: () => 0 });
  const result = await router.execute({ task: 'general', messages: [] });

  assert.equal(result.text, 'ok');
  assert.equal(registry.get('bad', 'm1').alive, false, 'упавшая модель должна быть помечена мёртвой');
});

test('execute() кидает понятную ошибку, если кандидатов нет вообще', async () => {
  const registry = new ModelRegistry();
  const router = new Router({ providers: {}, registry });
  await assert.rejects(() => router.execute({ task: 'general', messages: [] }), /Нет доступных моделей/);
});

test('джиттер внутри одного tier распределяет, кто оказывается первым', () => {
  const registry = new ModelRegistry();
  // Одинаковый tier (оба 70b) и одинаковая latency — единственное, что
  // может развести порядок между ними, это случайный джиттер.
  registry.upsert('a', 'llama-3.3-70b-instruct', { alive: true, latency: 500 });
  registry.upsert('b', 'llama-3.1-70b-instruct', { alive: true, latency: 500 });

  const router = new Router({ providers: {}, registry });
  const firstPicks = new Set();
  for (let i = 0; i < 50; i++) {
    firstPicks.add(router.rank('general')[0].modelId);
  }

  assert.equal(firstPicks.size, 2, 'за 50 прогонов оба кандидата должны хоть раз оказаться первыми');
});

test('execute() пробрасывает tools/toolChoice в provider.chat и возвращает toolCalls', async () => {
  const registry = new ModelRegistry();
  registry.upsert('p', 'm', { alive: true, latency: 50 });

  const tools = [{ type: 'function', function: { name: 'get_weather' } }];
  const toolChoice = 'auto';
  let receivedOptions;

  const providers = {
    p: {
      enabled: true,
      chat: async (_modelId, _messages, options) => {
        receivedOptions = options;
        return { content: '', toolCalls: [{ id: 'call_1', function: { name: 'get_weather' } }] };
      },
    },
  };

  const router = new Router({ providers, registry });
  const result = await router.execute({ task: 'general', messages: [], tools, toolChoice });

  assert.equal(receivedOptions.tools, tools, 'tools должны дойти до provider.chat как есть');
  assert.equal(receivedOptions.toolChoice, toolChoice);
  assert.deepEqual(result.toolCalls, [{ id: 'call_1', function: { name: 'get_weather' } }]);
});

test('с инъекцией random=() => 0 джиттер не ломает стабильный порядок (регресс на детерминированность теста)', () => {
  const registry = new ModelRegistry();
  registry.upsert('a', 'llama-3.3-70b-instruct', { alive: true, latency: 400 });
  registry.upsert('b', 'llama-3.1-70b-instruct', { alive: true, latency: 500 });

  const router = new Router({ providers: {}, registry, random: () => 0 });
  const ranked = router.rank('general');

  assert.equal(ranked[0].modelId, 'llama-3.3-70b-instruct', 'без джиттера должна побеждать модель с меньшей задержкой');
});
