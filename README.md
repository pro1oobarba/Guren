# AI Kernel — MVP

Универсальная прослойка между твоими проектами (бот, DM-помощник, анализ
документов) и несколькими бесплатными AI-провайдерами. Один вызов
`AI.generate()` — ядро само выбирает живую модель под задачу и, если она
не ответила, тихо переключается на следующую.

## ⚠️ Важное отличие от исходного ТЗ

В задании был четвёртый провайдер — **GitHub Models**. Я проверил
актуальное состояние сервиса: **GitHub полностью закрыл GitHub Models
30 июля 2026 года** — playground, каталог моделей, inference API и BYOK
убраны для всех, включая тех, кто уже пользовался сервисом. Это случилось
буквально за неделю до сегодняшнего дня, так что дело не в старой
информации — сервис реально мёртв.

Что я сделал вместо тихого умолчания:
- Убрал GitHub Models из рабочих провайдеров.
- Оставил `providers/github.js` как шаблон-заглушку с комментарием —
  пригодится, если захочешь позже подключить похожий сервис (Azure AI
  Foundry, Mistral, Google AI Studio — паттерн адаптера тот же).
- MVP работает на трёх провайдерах: **Groq, OpenRouter, Cloudflare
  Workers AI** — у всех троих есть щедрый бесплатный лимit без карты.

Архитектура именно поэтому и была спроектирована расширяемой — добавить
нового провайдера — это один новый файл в `providers/`, никаких переделок
остального кода. Пользуясь этим, после MVP добавили ещё пять бесплатных
провайдеров: **Cerebras, SambaNova, DeepInfra, Hyperbolic, Gemini,
HuggingFace** (router через Inference Providers). DeepInfra и Hyperbolic
на данный момент выключены через `PROVIDERS_DISABLED` в `.env` — ключи
живые, но там платный баланс $0. Итого 9 провайдеров в коде, 6 реально
активны и бесплатны из коробки. Подробности и live-статус смотри в
[CHANGELOG.md](CHANGELOG.md).

## Структура проекта

```
ai-kernel/
├── .env.example         # шаблон для ключей
├── package.json
├── kernel.js             # AI — главный фасад (main пакета)
├── index.js              # CLI-демонстрация (npm start)
├── providers/
│   ├── BaseProvider.js   # общая логика: OpenAI-совместимый чат/стрим, ping()
│   ├── groq.js
│   ├── openrouter.js
│   ├── cloudflare.js     # свой формат (не OpenAI-совместимый): без tools/stream/usage
│   ├── cerebras.js
│   ├── sambanova.js
│   ├── deepinfra.js      # выключен по умолчанию, см. PROVIDERS_DISABLED
│   ├── hyperbolic.js     # выключен по умолчанию, см. PROVIDERS_DISABLED
│   ├── gemini.js
│   ├── huggingface.js
│   └── github.js         # заглушка, см. выше
├── registry/
│   └── ModelRegistry.js  # стейт моделей: жива/мертва/остывает, задержка
├── router/
│   ├── Router.js          # ранжирование под задачу + auto-fallback + таймаут
│   ├── modelTiers.js      # таблица "силы" модели по семейству
│   └── classifyTask.js    # эвристика task по тексту промпта, если не передан явно
├── benchmark/
│   └── HealthChecker.js  # пингует все модели при старте
├── memory/
│   └── MemoryManager.js  # история сообщений по sessionId, персистентно
├── utils/
│   ├── logger.js          # цветной вывод в консоль (+ опционально в файл, LOG_FILE)
│   └── usageTracker.js    # usage.json — запросы/токены в день по провайдеру
├── scripts/
│   ├── checkEnv.js         # npm run doctor — линтер .env
│   ├── checkSecrets.js     # pre-commit хук — блокирует известные форматы ключей
│   └── installHooks.js     # npm run hooks:install
└── test/                 # npm test (node:test, без зависимостей)
```

## Шаг 1. Установи Node.js 22+

Проверь, что уже стоит:
```
node -v
```
Если версия ниже 22 или команда не найдена — поставь Node.js с сайта
https://nodejs.org (выбери LTS-версию, она сейчас 22+).

## Шаг 2. Получи бесплатные ключи

1. **Groq** — https://console.groq.com/keys → войти → Create API Key.
2. **OpenRouter** — https://openrouter.ai/keys → войти → Create Key.
3. **Cloudflare**:
   - Account ID: https://dash.cloudflare.com → он показан справа внизу
     на любой странице аккаунта.
   - API Token: My Profile (иконка профиля вверху справа) → API Tokens →
     Create Token → выбери шаблон с правом **Workers AI: Read**.

## Шаг 3. Настрой .env

В папке проекта скопируй `.env.example` в `.env` и впиши туда полученные
ключи (без кавычек, просто `КЛЮЧ=значение`).

В терминале (если .env ещё не создан):
```
cp .env.example .env
```
Затем открой `.env` в любом текстовом редакторе и заполни значения.

## Шаг 4. Запусти

Из папки проекта:
```
npm run start
```
Это сделает две вещи:
1. Пропингует все доступные бесплатные модели у активных провайдеров и
   покажет в консоли, какие живы, а какие нет (цветной вывод).
2. Сохранит результат в `health-report.json`.
3. Отправит один тестовый запрос через `AI.generate()` и покажет ответ.

Только health-check без тестового запроса:
```
npm run health
```

Другие полезные команды:
```
npm run doctor         # проверить .env на битые строки/пустые ключи/утечки в комментариях
npm test                # автотесты (node:test, без зависимостей)
npm run hooks:install   # поставить git pre-commit хук против утечки секретов
```

## Как использовать в своём проекте

```js
import { AI } from './kernel.js';

// один раз при старте своего приложения — прогревает реестр моделей
await AI.init();

const result = await AI.generate({
  task: 'roleplay',           // 'code' | 'roleplay' | 'analysis' | 'general' — необязателен, см. ниже
  prompt: 'Опиши таверну в маленьком городке',
  sessionId: 'user-123',      // история этого sessionId учитывается автоматически
  systemPrompt: 'Ты — рассказчик фэнтези-мира',
});

console.log(result.text);      // текст ответа
console.log(result.provider);  // какой провайдер ответил, напр. "groq"
console.log(result.modelId);   // какая именно модель
console.log(result.usage);     // { promptTokens, completionTokens } | null
```

Сахарные обёртки — то же самое, что `generate()`, но с зафиксированным `task`:
```js
await AI.code({ prompt: '...' });
await AI.roleplay({ prompt: '...' });
await AI.analyze({ prompt: '...' });
```

`task` можно не передавать вообще — эвристика по тексту промпта
(`router/classifyTask.js`) сама определит code/roleplay/analysis/general.

### Стриминг

```js
const result = await AI.generate({
  prompt: 'Напиши короткий рассказ',
  sessionId: 'user-123',
  stream: true,
  onToken: (delta) => process.stdout.write(delta), // кусок текста, по мере поступления
});
console.log(result.text); // полный склеенный текст доступен и после стрима
```

### Инструменты (tool-calling)

```js
const result = await AI.generate({
  prompt: 'Какая погода в Москве?',
  sessionId: 'user-123',
  tools: [{ type: 'function', function: { name: 'get_weather', parameters: { /* ... */ } } }],
  toolChoice: 'auto',
});
console.log(result.toolCalls); // [{ id, function: { name, arguments } }] | null
```
Не совмещай `tools` и `stream` в одном вызове — во время стрима
tool_calls не собираются (см. `providers/BaseProvider.js`). Cloudflare
не поддерживает ни то, ни другое (свой формат ответа).

### Учёт расхода

```js
console.log(AI.usageToday()); // { groq: { 'llama-3.3-70b': { requests, promptTokens, completionTokens } }, ... }
```
Пишется в `usage.json` (в `.gitignore`) после каждого успешного `generate()`.

## Как добавить нового провайдера

1. Создай `providers/newprovider.js`, унаследуй от `BaseProvider`,
   реализуй `listModels()` и `chat()` (смотри `providers/groq.js` как
   самый простой пример).
2. Подключи его в `kernel.js` в объекте `this.providers`.

Роутер и health-checker подхватят его автоматически — их код трогать не
нужно.

## Память между перезапусками

История сообщений по `sessionId` пишется в `memory-store.json` в корне
проекта (в `.gitignore`, не публикуется). Рестарт процесса не обнуляет
диалог — `MemoryManager` подгружает файл при старте. API не изменился
(`AI.generate({ sessionId })` работает как раньше).

Два независимых лимита защищают от бесконечного роста: не больше 60
последних сообщений хранится на диске на сессию, и не больше ~24 000
символов (≈6000 токенов) реально уходит в запрос модели за раз — старое
обрезается, самое свежее сообщение отдаётся всегда, даже если оно само
больше бюджета.

## Выключить провайдера без правки кода

Если у провайдера кончился баланс/квота, но ключ хочется сохранить —
не удаляй его из `.env`, просто добавь в `PROVIDERS_DISABLED`:

```
PROVIDERS_DISABLED=deepinfra,hyperbolic
```

Провайдер перестаёт участвовать в роутинге, но код и ключ остаются на
месте — убрать из списка, когда пополнишь баланс.

## Ограничения (осознанно, не баги)

- Ранжирование моделей под задачу (`router/modelTiers.js`) — это
  курируемая вручную таблица по семейству модели (DeepSeek-V3, Llama-70B
  и т.д.), не автоматический бенчмарк. Публичные бенчмарки этих семейств
  уже существуют и не скачут от недели к неделе — переизобретать их
  прогоном собственных тестов сочли нецелесообразным (сожгли бы дефицитную
  дневную квоту Gemini/HuggingFace без реального выигрыша в точности).
- Бесплатный лайнап OpenRouter меняется каждую неделю, поэтому список
  моделей запрашивается заново при каждом `init()`, а не хранится в коде.
- Память теперь персистентна (`memory-store.json`, см. ниже), но это
  плоский JSON-файл, не БД — подходит для одного процесса, не для
  конкурентной записи из нескольких инстансов ядра одновременно.
