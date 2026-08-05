import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTask } from '../router/classifyTask.js';

test('код-блок классифицируется как code', () => {
  assert.equal(classifyTask('Вот моя функция:\n```js\nfunction foo() {}\n```\nчто не так?'), 'code');
});

test('явная просьба написать функцию — code', () => {
  assert.equal(classifyTask('напиши функцию сложения двух чисел на JS'), 'code');
});

test('обращение "ты — персонаж" — roleplay', () => {
  assert.equal(classifyTask('Ты — волшебник в маленьком городке. Опиши заклятие.'), 'roleplay');
});

test('просьба сравнить/объяснить — analysis', () => {
  assert.equal(classifyTask('Сравни Python и JavaScript для веб-разработки'), 'analysis');
});

test('нейтральный промпт — general', () => {
  assert.equal(classifyTask('Привет! Как дела?'), 'general');
});

test('пустой prompt — general, без исключения', () => {
  assert.equal(classifyTask(''), 'general');
  assert.equal(classifyTask(undefined), 'general');
});
