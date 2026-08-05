import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { UsageTracker } from '../utils/usageTracker.js';

function tmpPath(name) {
  return new URL(`./${name}.tmp.json`, import.meta.url);
}

test('record() копит запросы и токены по провайдеру/модели за сегодня', (t) => {
  const storePath = tmpPath('usage-basic');
  t.after(() => fs.rmSync(storePath, { force: true }));

  const usage = new UsageTracker({ storePath });
  usage.record('groq', 'llama-3.3-70b', { promptTokens: 10, completionTokens: 5 });
  usage.record('groq', 'llama-3.3-70b', { promptTokens: 8, completionTokens: 3 });

  const today = usage.today();
  assert.equal(today.groq['llama-3.3-70b'].requests, 2);
  assert.equal(today.groq['llama-3.3-70b'].promptTokens, 18);
  assert.equal(today.groq['llama-3.3-70b'].completionTokens, 8);
});

test('record() без usage (null) всё равно считает запрос', (t) => {
  const storePath = tmpPath('usage-null');
  t.after(() => fs.rmSync(storePath, { force: true }));

  const usage = new UsageTracker({ storePath });
  usage.record('cloudflare', '@cf/meta/llama-3.1-8b', null);

  const today = usage.today();
  assert.equal(today.cloudflare['@cf/meta/llama-3.1-8b'].requests, 1);
  assert.equal(today.cloudflare['@cf/meta/llama-3.1-8b'].promptTokens, 0);
});

test('переживает новый инстанс (персистентность)', (t) => {
  const storePath = tmpPath('usage-persist');
  t.after(() => fs.rmSync(storePath, { force: true }));

  const u1 = new UsageTracker({ storePath });
  u1.record('groq', 'm', { promptTokens: 1, completionTokens: 1 });

  const u2 = new UsageTracker({ storePath });
  assert.equal(u2.today().groq.m.requests, 1);
});
