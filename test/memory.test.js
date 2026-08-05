import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MemoryManager } from '../memory/MemoryManager.js';

function tmpPath(name) {
  return new URL(`./${name}.tmp.json`, import.meta.url);
}

test('история переживает новый инстанс (персистентность)', (t) => {
  const storePath = tmpPath('persist');
  t.after(() => fs.rmSync(storePath, { force: true }));

  const mm1 = new MemoryManager({ storePath });
  mm1.append('s1', 'user', 'привет');
  mm1.append('s1', 'assistant', 'привет!');

  const mm2 = new MemoryManager({ storePath }); // новый инстанс, как после рестарта процесса
  assert.equal(mm2.get('s1').length, 2);
  assert.equal(mm2.get('s1')[0].content, 'привет');
});

test('maxStoredMessages ограничивает рост истории на диске', (t) => {
  const storePath = tmpPath('cap');
  t.after(() => fs.rmSync(storePath, { force: true }));

  const mm = new MemoryManager({ storePath, maxStoredMessages: 3 });
  for (let i = 0; i < 10; i++) mm.append('s1', 'user', `msg${i}`);

  assert.equal(mm.get('s1').length, 3);
  assert.equal(mm.get('s1').at(-1).content, 'msg9', 'должны остаться самые свежие');
});

test('maxContextChars обрезает то, что реально уходит в запрос модели', (t) => {
  const storePath = tmpPath('budget');
  t.after(() => fs.rmSync(storePath, { force: true }));

  const mm = new MemoryManager({ storePath, maxContextChars: 30, maxStoredMessages: 100 });
  mm.append('s1', 'user', 'x'.repeat(20));
  mm.append('s1', 'assistant', 'y'.repeat(20));
  mm.append('s1', 'user', 'z'.repeat(20));

  const built = mm.buildMessages('s1', { prompt: 'новый вопрос' });
  // бюджет 30 символов — влезает только последнее сообщение истории + новый prompt
  assert.equal(built.length, 2);
  assert.equal(built[0].content, 'z'.repeat(20));
});

test('clear() удаляет сессию и это сохраняется на диске', (t) => {
  const storePath = tmpPath('clear');
  t.after(() => fs.rmSync(storePath, { force: true }));

  const mm = new MemoryManager({ storePath });
  mm.append('s1', 'user', 'привет');
  mm.clear('s1');

  const mm2 = new MemoryManager({ storePath });
  assert.equal(mm2.get('s1').length, 0);
});
