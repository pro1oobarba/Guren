# Quick Start — 5 минут до первого запроса

## 0. Проверь Node.js

```bash
node -v  # должно быть 22.x или выше
```

Если ниже или нет — установи с https://nodejs.org (LTS версия).

---

## 1. Получи ключи (5 минут)

| Провайдер | Ссылка | Что копировать |
|-----------|--------|----------------|
| **Groq** | https://console.groq.com/keys | API Key |
| **OpenRouter** | https://openrouter.ai/keys | API Key |
| **Cloudflare** | https://dash.cloudflare.com | Account ID + API Token |

Cloudflare подробнее:
- Account ID: на любой странице dashboard справа снизу (копируем цифры)
- API Token: My Profile (иконка вверху справа) → API Tokens → Create Token → шаблон "Workers AI: Read"

---

## 2. Настрой .env (2 минуты)

В папке проекта:

```bash
cp .env.example .env
```

Открой `.env` в редакторе и вставь ключи:

```env
GROQ_API_KEY=gsk_...
OPENROUTER_API_KEY=sk-or-v1-...
CLOUDFLARE_ACCOUNT_ID=abc123def456ghi789
CLOUDFLARE_API_TOKEN=v1.0_abcd1234...
```

**Сохрани, закрой редактор.**

---

## 3. Запусти (1 минута)

```bash
npm run start
```

**Что должно случиться:**

1. Консоль покажет красивый список проверяемых моделей:
   ```
   [✓] groq/llama-3.3-70b — 145ms
   [✗] openrouter/... — rate limit
   [✓] cloudflare/kimi-k2.6 — 234ms
   === Итог: 12 живых из 25 проверенных ===
   ```

2. Создастся файл `health-report.json` с результатами

3. Выведется демо-ответ на запрос "Напиши одно короткое предложение о том, зачем нужен AI Kernel":
   ```
   ✓ Ответила модель groq/llama-3.3-70b:
   AI Kernel позволяет использовать...
   ```

**Если что-то красное (ERROR) — смотри раздел "Если не работает" ниже.**

---

## 4. Используй в своём коде

```js
import { AI } from './kernel.js';

// один раз при старте твоего проекта
await AI.init();

// теперь можешь делать запросы
const result = await AI.generate({
  task: 'roleplay',
  prompt: 'Опиши таверну в маленьком городке',
  sessionId: 'user-123'  // история будет сохранена
});

console.log(result.text);     // полный ответ
console.log(result.provider); // кто ответил: "groq", "openrouter", ...
```

**Сахарные обёртки:**

```js
await AI.code({ prompt: 'Напиши функцию...' });
await AI.roleplay({ prompt: 'Ты — барт...' });
await AI.analyze({ prompt: 'Проанализируй текст...' });
```

---

## Если не работает

### Ошибка: `GROQ_API_KEY пуст` или подобная

**Причина:** ключ не скопирован в `.env`

**Решение:**
1. Открой `.env`
2. Убедись, что там что-то вроде `GROQ_API_KEY=gsk_...`
3. Нет `=` в конце, только значение ключа
4. Сохрани, закрой

### Ошибка: `node: unknown option '--env-file'`

**Причина:** Node.js ниже версии 20

**Решение:** обнови Node.js на https://nodejs.org (LTS)

### Ошибка: `Нет доступных моделей`

**Причина:** все провайдеры либо выключены (нет ключей), либо недоступны

**Решение:**
1. Проверь, что в `.env` заполнено хотя бы **одно** значение
2. Проверь интернет соединение
3. Проверь, не упал ли сам провайдер (попробуй открыть сайт провайдера в браузере)

### Ошибка: `HTTP 429` или `rate limit`

**Причина:** исчерпан дневной лимит запросов

**Решение:**
- Подожди до завтра (лимиты сбрасываются каждые 24 часа)
- Или добавь кредиты в OpenRouter / используй другой провайдер
- Или уменьшай количество моделей в health-check для OpenRouter

### Ошибка: `socket hang up` или `ECONNREFUSED`

**Причина:** интернет недоступен или провайдер упал

**Решение:**
1. Проверь интернет (`ping google.com`)
2. Попробуй позже
3. Проверь в браузере, работает ли сайт провайдера

---

## Файлы проекта

```
ai-kernel/
├── README.md                 ← общее описание
├── REQUIREMENTS.md           ← ТЗ (это, что ты читаешь)
├── ARCHITECTURE.md           ← как всё устроено
├── CONTRIBUTING.md           ← как разрабатывать
├── QUICKSTART.md             ← быстрый старт (это сейчас)
├── .env.example              ← шаблон для ключей
├── package.json              ← metadata
├── kernel.js                 ← главный фасад AI
├── index.js                  ← CLI демонстрация
├── providers/
│   ├── BaseProvider.js
│   ├── groq.js
│   ├── openrouter.js
│   ├── cloudflare.js
│   └── github.js
├── registry/
│   └── ModelRegistry.js
├── router/
│   └── Router.js
├── benchmark/
│   └── HealthChecker.js
├── memory/
│   └── MemoryManager.js
└── utils/
    └── logger.js
```

**Прочитай в таком порядке:**
1. README.md (общее введение)
2. QUICKSTART.md (этот файл, быстрый старт)
3. REQUIREMENTS.md (что именно требуется)
4. ARCHITECTURE.md (как всё работает)
5. CONTRIBUTING.md (как добавлять и менять)

---

## Дальше что?

**Подключи к своему проекту:**

```js
// в твоём боте / DM-ассистенте / анализаторе документов
import { AI } from '../ai-kernel/kernel.js';

// или скопируй папку ai-kernel как подмодуль:
// git submodule add https://github.com/.../ai-kernel.git

export async function askAI(prompt, sessionId) {
  try {
    const result = await AI.generate({
      task: 'general',
      prompt,
      sessionId,  // история для этого пользователя
    });
    return result.text;
  } catch (err) {
    console.error('AI недоступен:', err.message);
    return 'Извини, AI сейчас недоступен';
  }
}
```

**Твои проекты (Telegram бот, D&D помощник и т.д.) могут теперь делать:**

```js
const answer = await askAI('опиши врага', 'player-456');
```

И ядро автоматически выберет лучшую доступную модель, запомнит историю разговора, и переключится на запасную, если основная упадёт. Всё это невидимо для твоего кода.

---

## Помощь

Если что-то не ясно:
1. Прочитай README.md (более подробное введение)
2. Смотри примеры в `index.js` (CLI код)
3. Смотри ARCHITECTURE.md (объяснение как всё работает)
4. Глянь CONTRIBUTING.md (как расширять)

Good luck! 🚀
