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

  // stickyMessages: 0 — тест целенаправленно изолирует хвостовую обрезку,
  // sticky-механику покрывают отдельные тесты ниже.
  const mm = new MemoryManager({ storePath, maxContextChars: 30, maxStoredMessages: 100, stickyMessages: 0 });
  mm.append('s1', 'user', 'x'.repeat(20));
  mm.append('s1', 'assistant', 'y'.repeat(20));
  mm.append('s1', 'user', 'z'.repeat(20));

  const built = mm.buildMessages('s1', { prompt: 'новый вопрос' });
  // бюджет 30 символов — влезает только последнее сообщение истории + новый prompt
  assert.equal(built.length, 2);
  assert.equal(built[0].content, 'z'.repeat(20));
});

test('stickyMessages удерживает первые сообщения даже при обрезке хвоста ("амнезия ДМ")', (t) => {
  const storePath = tmpPath('sticky');
  t.after(() => fs.rmSync(storePath, { force: true }));

  const mm = new MemoryManager({ storePath, maxContextChars: 30, maxStoredMessages: 100, stickyMessages: 2 });
  mm.append('s1', 'user', 'завязка кампании: ты волшебник');
  mm.append('s1', 'assistant', 'добро пожаловать в город N');
  mm.append('s1', 'user', 'x'.repeat(20));
  mm.append('s1', 'assistant', 'y'.repeat(20));
  mm.append('s1', 'user', 'z'.repeat(20));

  const built = mm.buildMessages('s1', { prompt: 'новый вопрос' });
  // первые 2 (sticky) + сколько влезет из хвоста в оставшийся бюджет + новый prompt
  assert.equal(built[0].content, 'завязка кампании: ты волшебник', 'первое сообщение сессии не должно вытесняться');
  assert.equal(built[1].content, 'добро пожаловать в город N');
  assert.equal(built.at(-1).content, 'новый вопрос');
});

test('stickyMessages по умолчанию (2) работает без явной настройки', (t) => {
  const storePath = tmpPath('sticky-default');
  t.after(() => fs.rmSync(storePath, { force: true }));

  const mm = new MemoryManager({ storePath, maxContextChars: 10 });
  mm.append('s1', 'user', 'лор кампании');
  mm.append('s1', 'assistant', 'ок');
  for (let i = 0; i < 20; i++) mm.append('s1', 'user', `ход ${i}`);

  const built = mm.buildMessages('s1', { prompt: 'вопрос' });
  assert.equal(built[0].content, 'лор кампании', 'дефолтный sticky должен пережить долгий диалог');
});

test('sticky больше maxStoredMessages не ломается — sticky ограничен тем, что реально есть в истории', (t) => {
  const storePath = tmpPath('sticky-overflow');
  t.after(() => fs.rmSync(storePath, { force: true }));

  const mm = new MemoryManager({ storePath, stickyMessages: 5, maxStoredMessages: 3, maxContextChars: 1000 });
  mm.append('s1', 'user', 'a');
  mm.append('s1', 'user', 'b');
  mm.append('s1', 'user', 'c');

  const built = mm.buildMessages('s1', { prompt: 'q' });
  assert.equal(built.length, 4); // все 3 хранимых + новый prompt, без дублей
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
