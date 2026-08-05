# CONTRIBUTING — Рекомендации по разработке

## Общее

AI Kernel — модульное приложение. Каждый файл делает **одно** и делает это хорошо.

---

## Добавление нового провайдера

### 1. Создай класс

Файл `providers/newprovider.js`:

```js
import { BaseProvider } from './BaseProvider.js';

export class NewProvider extends BaseProvider {
  constructor({ apiKey, /* другие параметры */ }) {
    super({
      name: 'newprovider',
      apiKey,
      baseUrl: 'https://api.example.com/v1',
      enabled: Boolean(apiKey),
    });
  }

  async listModels() {
    if (!this.enabled) return [];
    
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      return (data.data ?? []).map((m) => ({
        id: m.id,
        provider: this.name,
        contextWindow: m.context_window ?? null,
      }));
    } catch (err) {
      throw new Error(`${this.name}: listModels failed — ${err.message}`);
    }
  }

  async chat(modelId, messages, options = {}) {
    if (!this.enabled) {
      throw new Error(`${this.name} — нет ключа в .env`);
    }

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          messages,
          max_tokens: options.maxTokens ?? 1024,
          temperature: options.temperature ?? 0.7,
        }),
        signal: options.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? '';
    } catch (err) {
      throw new Error(`${this.name} chat() failed — ${err.message}`);
    }
  }
}
```

### 2. Подключи в kernel.js

```js
import { NewProvider } from './providers/newprovider.js';

export class AIKernel {
  constructor(env = process.env) {
    this.providers = {
      // ... существующие провайдеры ...
      newprovider: new NewProvider({
        apiKey: env.NEW_PROVIDER_API_KEY,
        // другие параметры
      }),
    };
    // остальное без изменений
  }
}
```

### 3. Добавь в .env.example

```
# NewProvider — https://example.com/signup
NEW_PROVIDER_API_KEY=
```

### 4. Тестируй

```bash
# Заполни NEW_PROVIDER_API_KEY в .env
npm run start
# Должна быть в health-check
```

**Готово.** Router и HealthChecker подхватят новый провайдер автоматически.

---

## Изменение ранжирования

Если хочешь, чтобы определённые модели выбирались раньше для конкретной задачи:

**Файл:** `router/Router.js`

```js
const TASK_KEYWORDS = {
  code: ['coder', 'code', 'deepseek', 'qwen', 'devstral', 'codestral'],
  roleplay: ['dolphin', 'hermes', 'nous', 'mythomax', 'chat'],
  // добавь здесь новую задачу или обнови существующую
  mytask: ['keyword1', 'keyword2'],
  general: ['instruct', 'chat'],
};
```

Или переопредели `rank()` целиком, если логика сложнее.

---

## Добавление логирования

Используй модуль `utils/logger.js`:

```js
import { log } from '../utils/logger.js';

log.info('информационное сообщение');
log.success('всё хорошо');
log.warn('внимание');
log.error('ошибка');
log.title('Заголовок раздела');
log.gray('маловажное сообщение');
```

**Не используй** `console.log()` напрямую (не будет цвета и времени).

---

## Обработка ошибок

### Правило

Все async операции должны быть в try-catch. Ошибки должны быть понятны пользователю:

```js
try {
  const data = await fetch(...).then(r => r.json());
  // ...
} catch (err) {
  // ✗ Плохо:
  // throw err;

  // ✓ Хорошо:
  throw new Error(`MyModule: не удалось загрузить данные — ${err.message}`);
}
```

### Для провайдеров

Используй `{ alive: false, error: '...' }` в Registry:

```js
if (!res.ok) {
  registry.upsert(provider, modelId, { 
    alive: false, 
    error: `HTTP ${res.status}` 
  });
  return;
}
```

---

## Структура кода

### Файлы провайдеров

```js
import { BaseProvider } from './BaseProvider.js';

export class MyProvider extends BaseProvider {
  constructor(config) { /* ... */ }
  async listModels() { /* ... */ }
  async chat(modelId, messages, options) { /* ... */ }
}
```

### Хранилища (Registry, MemoryManager)

```js
export class MyStorage {
  constructor() {
    this.data = new Map(); // или {}, или что-то ещё
  }

  get(key) { /* ... */ }
  set(key, value) { /* ... */ }
  all() { /* ... */ }
}
```

### Сервисы (Router, HealthChecker)

```js
export class MyService {
  constructor({ dependency1, dependency2 }) {
    this.dep1 = dependency1;
    this.dep2 = dependency2;
  }

  async doSomething() { /* ... */ }
}
```

---

## Тестирование локально

### 1. Базовая проверка синтаксиса

```bash
node --check providers/myprovider.js
```

### 2. Запуск с мокированным провайдером

```bash
cat > test.mjs << 'EOF'
import { ModelRegistry } from './registry/ModelRegistry.js';
import { Router } from './router/Router.js';

const providers = {
  test: {
    name: 'test',
    enabled: true,
    async chat(modelId) {
      if (modelId === 'fail') throw new Error('failed');
      return 'ok';
    }
  }
};

const registry = new ModelRegistry();
registry.upsert('test', 'ok', { alive: true, latency: 10 });
registry.upsert('test', 'fail', { alive: true, latency: 20 });

const router = new Router({ providers, registry });
const result = await router.execute({ 
  task: 'general', 
  messages: [{ role: 'user', content: 'hi' }] 
});

console.log('✓ Test passed:', result);
EOF
node test.mjs
rm test.mjs
```

### 3. Полный интеграционный тест

```bash
# Заполни реальные ключи в .env
npm run start
# Должно создать health-report.json и вернуть ответ
```

---

## Соглашения о коде

### Именование

- **Классы:** PascalCase (`MyProvider`, `HealthChecker`)
- **Методы/функции:** camelCase (`listModels`, `buildMessages`)
- **Константы:** UPPER_SNAKE_CASE (`TASK_KEYWORDS`, `FALLBACK_MODELS`)
- **Переменные:** camelCase (`provider`, `modelId`, `sessionId`)

### Форматирование

- **Отступы:** 2 пробела
- **Кавычки:** одинарные `'` для JS (кроме JSON в fetch body)
- **Длина строки:** ~100 символов (не жёсткое ограничение)
- **Точка с запятой:** обязательна в конце (не полагайся на ASI)

### Комментарии

```js
// Одна строка — обычный коммент

/**
 * Несколько строк — JSDoc для функций
 * @param {string} modelId
 * @returns {Promise<string>}
 */
async function chat(modelId) {
  // ...
}

// TODO: переделать fallback логику
```

### Async/await

```js
// ✓ Правильно:
try {
  const data = await fetch(...).then(r => r.json());
} catch (err) {
  log.error(err.message);
}

// ✗ Неправильно:
const data = await fetch(...); // что если упадёт?
```

---

## Скрипты в package.json

| Команда | Что | Когда |
|---------|-----|-------|
| `npm run start` | Запуск с health-check + тестовый запрос | Разработка, демо |
| `npm run health` | Только health-check | Проверка доступности |

Добавляй новые скрипты для других задач:
```json
"scripts": {
  "test": "node test-suite.js",
  "lint": "...",
  "benchmark": "..."
}
```

---

## Как не надо делать

### ❌ Добавлять npm-пакеты

```js
import axios from 'axios';  // ✗ нет! используй fetch
import dotenv from 'dotenv';  // ✗ нет! используй --env-file
import chalk from 'chalk';  // ✗ нет! используй ANSI codes
```

### ❌ Хранить credentials в коде

```js
const API_KEY = 'sk-12345...';  // ✗ должно быть в .env
```

### ❌ Не обрабатывать ошибки

```js
const data = await fetch(...).then(r => r.json());  // ✗ и если 404?
```

### ❌ Смешивать ответственность

```js
class SuperProvider {
  async chat(...) {
    // ... логика провайдера ...
    // ✗ здесь не должно быть:
    memory.append(...);  // это задача Kernel
    registry.upsert(...);  // это задача Kernel
  }
}
```

### ❌ Хардкодить списки моделей

```js
const MODELS = [
  'llama-3.3-70b',
  'gpt-4o',
  // ✗ завтра этот список будет неправильный
];
```

Всегда запрашивай `listModels()` заново.

---

## Debugging

### Логирование в health-check

```bash
npm run health  2>&1 | grep ERROR
```

### Проверка одного провайдера

```bash
cat > debug.mjs << 'EOF'
import { GroqProvider } from './providers/groq.js';

const groq = new GroqProvider({ apiKey: process.env.GROQ_API_KEY });
const models = await groq.listModels();
console.log('Models:', models.length);

const result = await groq.chat(models[0].id, [
  { role: 'user', content: 'hello' }
]);
console.log('Result:', result);
EOF
node --env-file=.env debug.mjs
rm debug.mjs
```

### Проверка памяти

```bash
cat > debug.mjs << 'EOF'
import { MemoryManager } from './memory/MemoryManager.js';

const mem = new MemoryManager();
mem.append('sess1', 'user', 'hello');
mem.append('sess1', 'assistant', 'hi');
mem.append('sess1', 'user', 'how are you');

const messages = mem.buildMessages('sess1', {
  systemPrompt: 'you are helpful',
  prompt: 'what time is it'
});

console.log(JSON.stringify(messages, null, 2));
EOF
node debug.mjs
rm debug.mjs
```

---

## Если что-то сломалось

1. Запусти `npm run health` — покажет, какие модели живы
2. Проверь `.env` — все ли ключи заполнены?
3. Лог всегда цветной — ищи красные `[✗ ERROR]`
4. Если провайдер `disabled` — нет ключа в .env или ошибка инициализации
5. Если модель `alive: false` — тайм-аут, rate limit или модель удалена

---

## Roadmap (идеи для будущего)

- [ ] Персистентная память (файл / SQLite)
- [ ] Логирование в файл (не только консоль)
- [ ] Метрики (сколько запросов, какие ошибки)
- [ ] Кэширование ответов (простой LRU cache)
- [ ] Поддержка функций/tools
- [ ] Встроенный HTTP сервер (не CLI только)
- [ ] Вебмориал для визуализации health-check
- [ ] Тесты с Jest или Vitest
