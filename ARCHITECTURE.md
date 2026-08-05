# AI Kernel — Архитектура

## Граф модулей

```
┌──────────────────────────────────────────────────┐
│ index.js (CLI)                                   │
│ Демонстрация: AI.init() → AI.generate()          │
└────────────────┬─────────────────────────────────┘
                 │ использует
                 ▼
┌──────────────────────────────────────────────────┐
│ kernel.js — AIKernel (главный фасад)             │
│ ├── init()                    (запуск, health)   │
│ ├── generate()                (базовой запрос)  │
│ ├── code() / roleplay() / analyze() (сахар)    │
│ └── saveReport()              (JSON диагностика)│
└────────┬──────────────────────┬─────────────┬───┘
         │ управляет            │             │
    ┌────▼────┐  ┌─────────┴────┐  ┌────────▼──┐
    │Providers │  │ MemoryManager│  │Router +   │
    └────┬────┘  └──────────────┘  │ Registry  │
    │                          └─────────────┘
    ├── Groq                         ▲ ▲
    ├── OpenRouter            ┌──────┘ │
    ├── Cloudflare        ┌───┘ ┌─────┘
    └── GitHub (disabled) │     ├── HealthChecker
                          │     │   └── пингует модели
                          │     │       → Registry
                          │     │
                    Router.execute()
                    ├── rank(task)  → [model1, model2, ...]
                    └── fallback loop
                        ├── провайдер1 → chat() → ✗ → alive=false
                        └── провайдер2 → chat() → ✓ → вернуть
```

---

## Классы и их ответственность

### 1. **BaseProvider** (`providers/BaseProvider.js`)

Абстрактный класс для всех провайдеров. Определяет интерфейс.

```js
class BaseProvider {
  async listModels()           // → [{ id, provider, contextWindow? }]
  async chat(modelId, messages, options)  // → text
  async ping(modelId)          // → { alive, latency }
}
```

**Наследуют:** GroqProvider, OpenRouterProvider, CloudflareProvider, GitHubModelsProvider

**Свойства экземпляра:**
- `name` — идентификатор провайдера ("groq", "openrouter", ...)
- `apiKey` / `baseUrl` — конфигурация доступа
- `enabled` — стоит ли это в .env? Если нет, провайдер скипается

---

### 2. **GroqProvider** (`providers/groq.js`)

Реализация для Groq (OpenAI-совместимый эндпоинт, очень быстрый инференс).

```js
class GroqProvider extends BaseProvider {
  async listModels()
    // GET https://api.groq.com/openai/v1/models
    // → возвращает все доступные модели Groq

  async chat(modelId, messages, options)
    // POST https://api.groq.com/openai/v1/chat/completions
    // body: { model, messages, max_tokens, temperature }
    // → возвращает choices[0].message.content
}
```

**Конструктор:** принимает только `apiKey` (читается из `process.env.GROQ_API_KEY`)

---

### 3. **OpenRouterProvider** (`providers/openrouter.js`)

Реализация для OpenRouter (агрегатор сотен моделей).

```js
class OpenRouterProvider extends BaseProvider {
  async listModels({ freeOnly = true })
    // GET https://openrouter.ai/api/v1/models
    // Если freeOnly=true: фильтр только где pricing.prompt==0 && pricing.completion==0
    // → рекомендуется для HealthChecker, чтобы не тратить лимиты

  async chat(modelId, messages, options)
    // POST https://openrouter.ai/api/v1/chat/completions
    // Заголовки: Authorization, HTTP-Referer, X-Title
    // → аналогично Groq по формату
}
```

**Особенность:** требует `siteUrl` и `appName` в заголовках (для их аналитики).

---

### 4. **CloudflareProvider** (`providers/cloudflare.js`)

Реализация для Cloudflare Workers AI (edge-инференс).

```js
class CloudflareProvider extends BaseProvider {
  async listModels()
    // GET https://api.cloudflare.com/client/v4/accounts/{id}/ai/models/search
    // Fallback: FALLBACK_MODELS (проверенные модели) если endpoint не доступен

  async chat(modelId, messages, options)
    // POST https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/{modelId}
    // body: { messages, max_tokens }
    // Проверяет response.success и извлекает response.result.response
}
```

**Конструктор:** принимает `accountId` и `apiToken`.

---

### 5. **ModelRegistry** (`registry/ModelRegistry.js`)

Хранилище стейта всех моделей. Ничего не знает о провайдерах.

```js
class ModelRegistry {
  upsert(provider, modelId, patch)
    // добавляет или обновляет запись о модели
    // ключ: "provider:modelId"
    // поле: { provider, modelId, alive?, latency?, error?, updatedAt }

  get(provider, modelId)
    // получить одну запись

  all()
    // все записи

  alive()
    // фильтр: только живые модели (alive === true)

  toJSON()
    // для сохранения в health-report.json
}
```

---

### 6. **Router** (`router/Router.js`)

Выбирает модель под задачу и реализует авто-fallback.

```js
class Router {
  rank(task)
    // берёт живые модели, ранжирует по:
    // 1. совпадению ключевых слов в названии (task-specific)
    // 2. низкой задержке (latency)
    // → [sorted models...]

  async execute({ task, messages })
    // для каждой модели в отранжированном списке:
    //   try: провайдер.chat()
    //   catch: помечаем dead, пробуем следующую
    // → { text, provider, modelId }
    // или выбрасываем Error если все упали
}
```

**Ключевые слова по задачам** — см. `TASK_KEYWORDS` в коде:
- code: ["coder", "code", "deepseek", "qwen", ...]
- roleplay: ["dolphin", "hermes", "nous", ...]
- analysis: ["70b", "72b", "405b", "large", ...]
- general: ["instruct", "chat"] (по умолчанию)

---

### 7. **HealthChecker** (`benchmark/HealthChecker.js`)

Пингует все модели и записывает результаты в Registry.

```js
class HealthChecker {
  async run({ openrouterFreeOnly = true })
    // для каждого активного провайдера:
    //   listModels({ freeOnly: для OpenRouter })
    //   для каждой модели: ping(modelId)
    //   upsert в registry
    //   логирует результат цветом
    // → printSummary()

  async pingOne(provider, modelId)
    // вызывает provider.ping()
    // логирует ✓ или ✗
}
```

**Результат ping:**
```js
{ alive: true/false, latency: 45, error?: "..." }
```

---

### 8. **MemoryManager** (`memory/MemoryManager.js`)

Хранилище истории сообщений по sessionId. **Полностью отделено** от логики провайдеров.

```js
class MemoryManager {
  get(sessionId)
    // → [{ role: 'user'|'assistant', content: '...' }]

  append(sessionId, role, content)
    // добавить сообщение в историю sessionId

  buildMessages(sessionId, { systemPrompt, prompt })
    // собрать полный список сообщений для отправки провайдеру:
    // [system, ...history, user: prompt]

  clear(sessionId)
    // забыть историю sessionId
}
```

**Жизненный цикл:**

```
AI.generate({ sessionId: 'user-123', prompt: '...' })
  ↓
messages = memory.buildMessages('user-123', { systemPrompt?, prompt })
  ↓
router.execute({ task, messages })
  ↓
memory.append('user-123', 'user', prompt)
memory.append('user-123', 'assistant', result.text)
  ↓
return result
```

При следующем вызове с тем же sessionId история уже накопилась.

---

### 9. **AIKernel** (`kernel.js`)

Главный фасад. Объединяет всё вместе.

```js
class AIKernel {
  constructor(env)
    // инициализирует все провайдеры, registry, router, memory, health

  async init({ saveReport = true, reportPath })
    // запускает health-check
    // создаёт health-report.json
    // → [list of model states]

  async generate({ task, prompt, sessionId, systemPrompt })
    // собирает messages в памяти
    // вызывает router.execute()
    // сохраняет в память
    // → { text, provider, modelId }

  code / roleplay / analyze(args)
    // синтаксический сахар
    // = generate({ ...args, task: '...' })
}
```

**Экспорт:**
```js
export const AI = new AIKernel();
// глобальный синглтон, все проекты используют одно ядро
```

---

### 10. **logger** (`utils/logger.js`)

Цветной вывод в консоль (ANSI escape sequences).

```js
log.info(msg)     // ℹ голубое
log.success(msg)  // ✓ зелёное
log.warn(msg)     // ⚠ жёлтое
log.error(msg)    // ✗ красное
log.title(msg)    // === заголовок ===
log.gray(msg)     // серое (маловажное)
```

---

## Поток данных при запросе

```
1. User вызывает:
   AI.generate({ task: 'code', prompt: '...', sessionId: 'sess1' })

2. AIKernel.generate():
   - memory.buildMessages('sess1', { prompt })
   - → messages = [system?, ...history, user]

3. router.execute({ task: 'code', messages }):
   - rank('code')
   - → [model-a (score 45), model-b (score 30), ...]

4. Для каждой модели:
   - Получи провайдер: providers[model.provider]
   - Спроси: await provider.chat(model.id, messages)
   - Если ✓:
     * Верни { text, provider, modelId }
     * goto 5
   - Если ✗:
     * registry.upsert(..., { alive: false })
     * log.warn(...)
     * Пробуй следующую

5. Если получили ответ:
   - memory.append('sess1', 'user', prompt)
   - memory.append('sess1', 'assistant', text)
   - return { text, provider, modelId }

6. User получает результат.
   При следующем вызове с 'sess1':
   - История уже содержит предыдущий запрос
   - Контекст растёт автоматически
```

---

## Инициализация (init)

```
AI.init()
  ↓
HealthChecker.run():
  ├── Для каждого провайдера:
  │   ├── listModels()
  │   └── Для каждой модели:
  │       ├── ping()
  │       └── registry.upsert(..., { alive, latency })
  │
  └── printSummary() в консоль
        [✓] groq/llama-3.3-70b — 123ms
        [✗] openrouter/gpt-4 — rate limit
        [✓] cloudflare/kimi-k2.6 — 456ms
        === Итог: 45 живых из 120 проверенных ===

  ↓
  saveReport('./health-report.json')
    [
      { provider: 'groq', modelId: '...', alive: true, latency: ... },
      ...
    ]

  ↓
return registry.all()
```

---

## Граф ошибок

```
Нет ключей в .env
  ↓ provider.enabled = false
  ↓ HealthChecker скипает
  ↓ Router не видит модели
  ↓ Ошибка только если это единственный провайдер

Список моделей не получен (HTTP ошибка)
  ↓ HealthChecker логирует [ERROR]
  ↓ Этот провайдер пропускается в health-check
  ↓ Router может использовать моду ли из прошлого run() если есть registry.entries

Модель не отвечает (timeout или HTTP ошибка)
  ↓ ping() возвращает { alive: false, error: '...' }
  ↓ registry.upsert(..., { alive: false })
  ↓ Router.rank() исключит её из кандидатов
  ↓ Если это была единственная кандидат → ошибка

chat() вернул ошибку во время execute()
  ↓ router.execute() ловит в try-catch
  ↓ помечает модель как alive: false
  ↓ пробует следующую
  ↓ Если все упали → throw Error(...)
```

---

## Расширяемость

### Добавить провайдер?

1. `providers/myprovider.js`:
   ```js
   export class MyProvider extends BaseProvider {
     async listModels() { ... }
     async chat(modelId, messages, options) { ... }
   }
   ```

2. `kernel.js`:
   ```js
   import { MyProvider } from './providers/myprovider.js';
   
   this.providers.myprovider = new MyProvider({
     apiKey: env.MY_PROVIDER_API_KEY,
     ...
   });
   ```

3. `.env.example`:
   ```
   MY_PROVIDER_API_KEY=...
   ```

Остальной код не меняется. Роутер автоматически учтёт новые модели.

### Изменить ранжирование?

Отредактируй `TASK_KEYWORDS` в `router/Router.js` или переопредели `rank(task)`.

### Добавить персистентность памяти?

Замени `Map` в `MemoryManager` на файловую систему или БД. Интерфейс не меняется.

---

## Лимиты и ограничения

| Что | Лимит | Почему |
|-----|-------|--------|
| Groq запросов | ~1000/день без карты | Бесплатный лимит |
| OpenRouter бесплатных | 50–200/день | Зависит от ранее потраченных денег |
| Cloudflare "нейронов" | 10 000/день | Бесплатный лимит |
| History в памяти | ~полный контекст модели | Попытка вместить всю историю в провайдер |

---

## Тестирование

### Unit-тесты (нет фреймворка, просто мокирование)

```js
// Мок-провайдер
const mockProvider = {
  enabled: true,
  async chat(modelId) { return 'mock response'; }
};

// Тест fallback
registry.upsert('mock', 'dead', { alive: false });
registry.upsert('mock', 'alive', { alive: true });
const result = router.execute({ task: 'general', messages });
// должна выбрать 'alive', не 'dead'
```

### Интеграционный тест

```bash
# с реальными ключами в .env
npm run start
# должно создать health-report.json
# должно вернуть один успешный ответ
```

---

## Производительность

- **Health-check:** параллельно пингует все модели (Promise.all), ~30–60 сек для сотен моделей
- **chat():** один запрос провайдеру, обычно 1–3 сек
- **fallback:** линейный поиск по кандидатам, тайм-ауты на пинг 12 сек, на chat 30 сек (можно настроить)

---

## Безопасность

- **Ключи в .env:** никогда не коммитим `.env`, только `.env.example`
- **Никаких credentials в логах:** ошибки логируют сообщение, не полный response
- **HTTPS:** все запросы к провайдерам только по https
- **Abort signals:** на все fetch-запросы ставим таймауты через AbortController
