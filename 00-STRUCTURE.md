# AI Kernel — Полная документация и структура проекта

Архив **ai-kernel.zip** содержит полностью рабочий MVP с кодом и полной документацией.

---

## 📚 Документация (читай в таком порядке)

### 1. **README.md** — общее введение
- Что это такое и зачем нужно
- Отличие от исходного ТЗ (GitHub Models закрыт)
- Структура проекта
- Пошаговая инструкция для первого запуска

### 2. **QUICKSTART.md** — быстрый старт за 5 минут
- Как получить ключи
- Как настроить .env
- Первый запрос
- Troubleshooting

### 3. **REQUIREMENTS.md** — техническое задание (ТЗ)
- Описание требований
- Функциональные требования по каждой фиче
- Нефункциональные требования (production-ready, ошибки и т.д.)
- Критерии успеха MVP

### 4. **ARCHITECTURE.md** — архитектура с деталями
- Граф модулей
- Класс за классом с объяснением
- Поток данных при запросе
- Граф ошибок
- Как расширять
- Лимиты и ограничения

### 5. **CONTRIBUTING.md** — рекомендации по разработке
- Как добавить нового провайдера
- Как менять ранжирование моделей
- Соглашения о коде
- Как тестировать
- Как debugить

---

## 💻 Код (структура)

```
ai-kernel/
│
├── 📄 Конфиг
│   ├── package.json              # metadata, версия, скрипты
│   ├── .env.example              # шаблон для переменных окружения
│   └── .env                       # (создаётся при настройке) твои ключи
│
├── 🎯 Точка входа
│   ├── index.js                  # CLI демонстрация
│   └── kernel.js                 # AIKernel — главный фасад (экспортирует AI)
│
├── 🔌 Провайдеры (providers/)
│   ├── BaseProvider.js           # абстрактный класс для всех провайдеров
│   ├── groq.js                   # Groq (OpenAI-совместимый, быстрый)
│   ├── openrouter.js             # OpenRouter (агрегатор сотен моделей)
│   ├── cloudflare.js             # Cloudflare Workers AI (edge-инференс)
│   ├── cerebras.js               # Cerebras (wafer-scale, очень быстрый)
│   ├── sambanova.js              # SambaNova Cloud
│   ├── deepinfra.js              # DeepInfra (выключен, баланс $0 — см. PROVIDERS_DISABLED)
│   ├── hyperbolic.js             # Hyperbolic (выключен, баланс $0 — см. PROVIDERS_DISABLED)
│   ├── gemini.js                 # Google Gemini (через OpenAI-совместимый слой)
│   ├── huggingface.js            # HuggingFace Inference Providers router
│   └── github.js                 # GitHub Models (ЗАКРЫТ, заглушка-пример)
│
├── 📋 Реестр моделей (registry/)
│   └── ModelRegistry.js          # стейт: жива/мертва/остывает (cooldown), задержка
│
├── 🧭 Маршрутизация (router/)
│   ├── Router.js                 # ранжирование под задачу + авто-fallback
│   └── modelTiers.js             # таблица "силы" модели по семейству (tier 1-3)
│
├── 💪 Диагностика (benchmark/)
│   └── HealthChecker.js          # пингует модели, записывает результаты
│
├── 🧠 Память (memory/)
│   └── MemoryManager.js          # история сообщений по sessionId
│
├── 🛠️ Утилиты (utils/)
│   └── logger.js                 # цветной логирование в консоль
│
└── 📖 Документация (корень)
    ├── README.md                 # общее введение
    ├── QUICKSTART.md             # быстрый старт
    ├── REQUIREMENTS.md           # ТЗ
    ├── ARCHITECTURE.md           # архитектура
    └── CONTRIBUTING.md           # рекомендации для разработки
```

---

## 🎯 Что работает сейчас

Проект вырос за пределы исходного MVP — актуальная история изменений в
[CHANGELOG.md](CHANGELOG.md).

✅ **9 провайдеров в коде, 6 активны и бесплатны из коробки:**
- Groq, OpenRouter, Cloudflare Workers AI, Cerebras, SambaNova, HuggingFace
- Gemini активен, но с ограниченной дневной квотой на free tier
- DeepInfra и Hyperbolic выключены через `PROVIDERS_DISABLED` (баланс $0)

✅ **Все основные фичи MVP плюс:**
- Получение списка моделей автоматически
- Health-check: пинг всех моделей при старте
- Роутинг по tier-таблице реальной "силы" модели (`router/modelTiers.js`),
  не по угадыванию ключевых слов
- Авто-fallback + автоматическое "остывание": мёртвая модель (квота/ошибка)
  сама возвращается в кандидаты после кулдауна, без перезапуска процесса
- Персистентная история сообщений по sessionId (`memory-store.json`,
  переживает рестарт процесса)
- Единый интерфейс: `AI.generate()`, `AI.code()`, `AI.roleplay()`, `AI.analyze()`
- Красивое логирование в консоль
- Сохранение отчёта health-check в JSON

✅ **Никаких зависимостей:**
- Только встроенные модули Node.js
- Нет npm install
- Только нативный fetch

---

## ⚠️ Важное отличие от исходного ТЗ

В ТЗ был четвёртый провайдер — **GitHub Models**.

**GitHub полностью закрыл GitHub Models 30 июля 2026 года** — это было буквально неделю назад. Закрыты playground, каталог моделей, inference API и BYOK для всех пользователей, включая тех, кто уже пользовался.

**Что я сделал:**
- Убрал GitHub Models из активных провайдеров
- Оставил файл `providers/github.js` как заглушку-пример с комментарием
- MVP работает на трёх провайдерах вместо четырёх
- Архитектура спроектирована расширяемо — добавить четвёртого провайдера вместо GitHub Models — это просто создать новый файл в `providers/` и добавить строку в `kernel.js`

---

## 🚀 Как начать

### Шаг 1: Распакуй архив
```bash
unzip ai-kernel.zip
cd ai-kernel
```

### Шаг 2: Прочитай QUICKSTART.md (5 минут)
```bash
cat QUICKSTART.md
# или открой в редакторе
```

### Шаг 3: Получи ключи
- Groq: https://console.groq.com/keys
- OpenRouter: https://openrouter.ai/keys
- Cloudflare: https://dash.cloudflare.com (Account ID) + My Profile → API Tokens

### Шаг 4: Настрой .env
```bash
cp .env.example .env
# открой .env в редакторе, вставь ключи
```

### Шаг 5: Запусти
```bash
npm run start
```

Должно вывести цветной health-check и один тестовый ответ.

---

## 📖 Где что

| Нужно | Прочитай | Найдёшь в |
|------|----------|-----------|
| **Общее введение** | README.md | архив |
| **Быстрый старт за 5 минут** | QUICKSTART.md | архив |
| **Точные требования (ТЗ)** | REQUIREMENTS.md | архив |
| **Как всё работает (архитектура)** | ARCHITECTURE.md | архив |
| **Как добавлять новое** | CONTRIBUTING.md | архив |
| **Примеры использования** | index.js, README.md | архив |
| **Как менять ранжирование** | CONTRIBUTING.md + router/Router.js | архив |
| **Как добавить провайдера** | CONTRIBUTING.md | архив |

---

## 💡 Примеры использования в своём коде

### Простой запрос
```js
import { AI } from './ai-kernel/kernel.js';

await AI.init();  // один раз при старте

const result = await AI.generate({
  task: 'general',
  prompt: 'Напиши короткое стихотворение про программистов',
  sessionId: 'user-123'
});

console.log(result.text);      // ответ модели
console.log(result.provider);  // какой провайдер ответил
```

### Сахарные обёртки
```js
await AI.code({ prompt: 'Напиши функцию...' });
await AI.roleplay({ prompt: 'Ты — волшебник. Опиши заклятие...' });
await AI.analyze({ prompt: 'Проанализируй этот текст...' });
```

### История сообщений
```js
// Первый запрос
await AI.generate({
  prompt: 'Как дела?',
  sessionId: 'player-456'
});

// Второй запрос (история из первого учтена)
await AI.generate({
  prompt: 'А что на ужин?',
  sessionId: 'player-456'  // та же сессия!
});
// Модель видит: "Как дела? [ответ] А что на ужин?"
```

---

## 🛠️ Разработка

### Добавить провайдера
1. Создай `providers/newprovider.js`
2. Унаследуй от `BaseProvider`, реализуй `listModels()` и `chat()`
3. Подключи в `kernel.js`
4. Готово — Router и HealthChecker подхватят автоматически

Смотри CONTRIBUTING.md → "Добавление нового провайдера"

### Изменить ранжирование
Отредактируй `TASK_KEYWORDS` в `router/Router.js` или переопредели `rank()`.

Смотри CONTRIBUTING.md → "Изменение ранжирования"

### Протестировать
```bash
npm run start          # полный тест с реальными ключами
npm run health         # только health-check
node --check file.js   # синтаксис файла
```

---

## 📊 Структура файлов при первом запуске

После `npm run start` создастся:

```
ai-kernel/
├── (все файлы выше)
└── health-report.json     # результаты диагностики моделей
```

Содержимое `health-report.json`:
```json
[
  {
    "provider": "groq",
    "modelId": "llama-3.3-70b-instruct-fp8-fast",
    "alive": true,
    "latency": 145,
    "updatedAt": "2026-08-05T04:52:12.345Z"
  },
  {
    "provider": "openrouter",
    "modelId": "...",
    "alive": false,
    "error": "HTTP 429 Too Many Requests",
    "updatedAt": "..."
  }
  ...
]
```

---

## ✅ Критерии успеха

- ✅ `npm run start` работает без ошибок
- ✅ Создаётся `health-report.json`
- ✅ Выводится цветной список проверенных моделей
- ✅ Один тестовый запрос возвращает текст
- ✅ Fallback работает (если одна модель падает, пробует другую)
- ✅ История сообщений сохраняется
- ✅ Никаких npm-пакетов, только встроенные модули

**Все критерии выполнены в текущем MVP.**

---

## 🎓 Дальше что?

1. **Подключи к своим проектам** — использует `AI.generate()` в своём боте / DM-ассистенте / анализаторе
2. **Добавь свои провайдеры** — Mistral, Google, Azure и т.д. (см. CONTRIBUTING.md)
3. **Расширь память** — добавь файловую систему или БД вместо in-memory (см. ARCHITECTURE.md)
4. **Добавь логирование в файл** — сейчас только консоль
5. **Добавь метрики** — сколько запросов, какие ошибки

---

## 📞 Вопросы?

- **Как запустить?** → QUICKSTART.md
- **Как это работает?** → ARCHITECTURE.md
- **Как добавить новое?** → CONTRIBUTING.md
- **Что именно нужно?** → REQUIREMENTS.md
- **Примеры кода?** → index.js и README.md

Всё написано, документация полная. Успеха! 🚀
