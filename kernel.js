import fs from 'node:fs/promises';

import { GroqProvider } from './providers/groq.js';
import { OpenRouterProvider } from './providers/openrouter.js';
import { CloudflareProvider } from './providers/cloudflare.js';
import { GitHubModelsProvider } from './providers/github.js';
import { CerebrasProvider } from './providers/cerebras.js';
import { SambaNovaProvider } from './providers/sambanova.js';
import { DeepInfraProvider } from './providers/deepinfra.js';
import { HyperbolicProvider } from './providers/hyperbolic.js';
import { GeminiProvider } from './providers/gemini.js';
import { HuggingFaceProvider } from './providers/huggingface.js';
import { ModelRegistry } from './registry/ModelRegistry.js';
import { Router } from './router/Router.js';
import { getModelTier } from './router/modelTiers.js';
import { classifyTask } from './router/classifyTask.js';
import { HealthChecker } from './benchmark/HealthChecker.js';
import { MemoryManager } from './memory/MemoryManager.js';
import { UsageTracker } from './utils/usageTracker.js';
import { log } from './utils/logger.js';

/**
 * @typedef {'general' | 'code' | 'roleplay' | 'analysis'} TaskType
 * @typedef {{ text: string, toolCalls: object[] | null, usage: { promptTokens: number, completionTokens: number } | null, provider: string, modelId: string }} GenerateResult
 * @typedef {object} GenerateArgs
 * @property {TaskType} [task] влияет только на выбор модели, не на формат ответа; не передан — определяется эвристикой по prompt (см. router/classifyTask.js)
 * @property {string} prompt обязателен
 * @property {string} [sessionId] история сообщений накапливается по этому ключу; без него — разовый запрос без памяти
 * @property {string} [systemPrompt]
 * @property {string} [ephemeralSystem] правило на один ответ: ставится вплотную к prompt и не сохраняется в память сессии
 * @property {number} [timeoutMs] дефолт — DEFAULT_TIMEOUT_MS в router/Router.js (45с)
 * @property {object[]} [tools] формат OpenAI tools API, пробрасывается как есть — поддержку со стороны конкретной модели/провайдера ядро не проверяет
 * @property {string | object} [toolChoice] см. OpenAI tool_choice
 * @property {object} [responseFormat] формат OpenAI response_format (например { type: 'json_object' }), пробрасывается как есть — поддержку со стороны конкретной модели/провайдера ядро не проверяет
 * @property {number} [maxTokens] лимит токенов ответа, дефолт — 1024 в BaseProvider._openAIChat. У reasoning-моделей (например gemma-*-thinking-варианты) рассуждение само по себе занимает часть этого бюджета — если модель обрывается до содержательного ответа, увеличь maxTokens, а не только responseFormat
 * @property {number} [temperature] дефолт — 0.7 в BaseProvider._openAIChat. Понижай, когда важнее точное следование инструкции, чем разнообразие текста (например структурированный ответ по согласованным с пользователем данным)
 * @property {boolean} [stream] потоковый ответ (SSE), см. providers/BaseProvider.js _openAIChatStream. Не собирает tool_calls — для tools без стрима
 * @property {(delta: string) => void} [onToken] вызывается на каждый кусок текста при stream: true; если поток оборвался ПОСЛЕ первого токена, generate() бросает ошибку с полем partialContent вместо тихого fallback на другую модель
 * @typedef {'alive' | 'cooldown' | 'retryable'} ModelState
 * @typedef {object} ModelStatus
 * @property {string} provider
 * @property {string} modelId
 * @property {1 | 2 | 3} tier см. router/modelTiers.js
 * @property {ModelState} state
 * @property {number | null} latency мс, последний известный
 * @property {string | null} error последняя ошибка, если есть
 * @property {number} cooldownRemainingMs 0, если не в кулдауне
 */

/**
 * AIKernel — единая точка входа для внешних проектов (боты, DM-ассистент,
 * анализ документов и т.д.). Они дергают только AI.generate()/AI.code()/...
 * и не знают, какой именно провайдер и модель ответили.
 */
export class AIKernel {
  /**
   * @param {Record<string, string | undefined>} [env] источник ключей.
   * По умолчанию process.env, но можно передать свой объект — например
   * чтобы поднять отдельный экземпляр под ключ конкретного пользователя
   * (BYOK), не подмешивая ему общие ключи сервера. Достаточно указать
   * только нужные переменные: провайдеры без ключа сами станут disabled.
   */
  constructor(env = process.env) {
    this.providers = {
      groq: new GroqProvider({ apiKey: env.GROQ_API_KEY }),
      openrouter: new OpenRouterProvider({
        apiKey: env.OPENROUTER_API_KEY,
        siteUrl: env.APP_SITE_URL,
        appName: env.APP_NAME,
      }),
      cloudflare: new CloudflareProvider({
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
        apiToken: env.CLOUDFLARE_API_TOKEN,
      }),
      // GitHub Models закрыт GitHub 30.07.2026 — провайдер всегда disabled,
      // см. подробности в providers/github.js
      github: new GitHubModelsProvider(),
      cerebras: new CerebrasProvider({ apiKey: env.CEREBRAS_API_KEY }),
      sambanova: new SambaNovaProvider({ apiKey: env.SAMBANOVA_API_KEY }),
      deepinfra: new DeepInfraProvider({ apiKey: env.DEEPINFRA_API_KEY }),
      hyperbolic: new HyperbolicProvider({ apiKey: env.HYPERBOLIC_API_KEY }),
      gemini: new GeminiProvider({ apiKey: env.GEMINI_API_KEY }),
      huggingface: new HuggingFaceProvider({ apiKey: env.HF_TOKEN }),
    };

    // Провайдер может иметь ключ, но быть намеренно выключен (например,
    // на балансе $0 и HealthChecker будет только спамить 402-ошибками).
    // PROVIDERS_DISABLED=deepinfra,hyperbolic в .env — без правки кода.
    const disabled = (env.PROVIDERS_DISABLED ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    for (const name of disabled) {
      if (this.providers[name]) this.providers[name].enabled = false;
    }

    this.registry = new ModelRegistry();
    this.router = new Router({ providers: this.providers, registry: this.registry });
    this.memory = new MemoryManager();
    this.health = new HealthChecker({ providers: this.providers, registry: this.registry });
    this.usage = new UsageTracker();
  }

  /** Запускает health-check всех провайдеров и сохраняет отчёт в JSON */
  async init({ saveReport = true, reportPath = './health-report.json' } = {}) {
    const enabled = Object.values(this.providers)
      .filter((p) => p.enabled)
      .map((p) => p.name);

    if (!enabled.length) {
      log.error('Нет ни одного активного провайдера — заполни .env (см. .env.example)');
    } else {
      log.info(`Активные провайдеры: ${enabled.join(', ')}`);
    }

    await this.health.run();
    if (saveReport) await this.saveReport(reportPath);
    return this.registry.toJSON();
  }

  /**
   * Отчёт диагностики — удобство для разработчика, а не часть работы ядра.
   * Каталог запуска сплошь и рядом доступен только для чтения (serverless,
   * контейнер, глобальная установка), и падать из-за невозможности записать
   * справочный файл ядро не имеет права: диагностика уже проведена, её
   * результат лежит в реестре в памяти.
   */
  async saveReport(path = './health-report.json') {
    try {
      await fs.writeFile(path, JSON.stringify(this.registry.toJSON(), null, 2), 'utf-8');
      log.info(`Отчёт диагностики сохранён: ${path}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log.info(`Отчёт диагностики не сохранён (${reason}) — продолжаю без него.`);
    }
  }

  /**
   * Программный снимок реестра моделей — для встраивания в свой
   * бот/дашборд без парсинга консольных логов HealthChecker.
   * @returns {ModelStatus[]}
   */
  status() {
    const now = Date.now();
    return this.registry.all().map((entry) => {
      const { tier } = getModelTier(entry.modelId.toLowerCase());
      const inCooldown = entry.alive === false && entry.retryAfter && entry.retryAfter > now;
      const state = entry.alive ? 'alive' : inCooldown ? 'cooldown' : 'retryable';
      return {
        provider: entry.provider,
        modelId: entry.modelId,
        tier,
        state,
        latency: entry.latency ?? null,
        error: entry.error ?? null,
        cooldownRemainingMs: inCooldown ? entry.retryAfter - now : 0,
      };
    });
  }

  /**
   * Базовый генератор.
   * @param {GenerateArgs} args
   * @returns {Promise<GenerateResult>}
   */
  async generate({ task, prompt, sessionId, systemPrompt, ephemeralSystem, timeoutMs, tools, toolChoice, responseFormat, maxTokens, temperature, stream, onToken }) {
    if (!prompt) throw new Error('generate(): параметр prompt обязателен');

    // task не передан явно — эвристика по тексту промпта вместо жёсткого
    // 'general' по умолчанию (см. router/classifyTask.js). Явный task,
    // включая явное 'general', всегда имеет приоритет над эвристикой.
    const resolvedTask = task ?? classifyTask(prompt);

    const messages = this.memory.buildMessages(sessionId, { systemPrompt, prompt, ephemeralSystem });

    let result;
    try {
      result = await this.router.execute({
        task: resolvedTask,
        messages,
        ...(timeoutMs && { timeoutMs }),
        ...(tools && { tools }),
        ...(toolChoice && { toolChoice }),
        ...(responseFormat && { responseFormat }),
        ...(maxTokens && { maxTokens }),
        // Явная проверка на undefined, а не truthy: temperature: 0 —
        // валидное и осмысленное значение (максимально детерминированный
        // ответ), которое обычная проверка молча бы отбросила.
        ...(temperature !== undefined && { temperature }),
        ...(stream && { stream }),
        ...(onToken && { onToken }),
      });
    } catch (err) {
      // Стрим оборвался, но вызывающий код уже что-то получил через onToken —
      // сохраняем частичный ответ в память, а не теряем ход разговора молча.
      if (err.partialContent !== undefined) {
        this.memory.append(sessionId, 'user', prompt);
        this.memory.append(sessionId, 'assistant', err.partialContent);
      }
      throw err;
    }

    // Reasoning-модели (поймано вживую: Cloudflare deepseek-r1-distill)
    // заворачивают рассуждение в <think>...</think> прямо в основном тексте
    // ответа, не только в vision-пути (там уже был обработан отдельный
    // случай <thought> для Gemini-thinking-вариантов). Раньше это било
    // JSON.parse и обрезалось попутно при извлечении {...} из ответа — но
    // без JSON-режима (tool calling, обычный чат) утечка идёт прямо
    // пользователю как есть. Строгий тег с закрытием — вырезаем целиком;
    // необорванный в конце (модель обрубилась на рассуждении) — тоже
    // отбрасываем как есть, чем показывать пользователю сырые мысли модели.
    if (result.text) {
      result.text = result.text
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<think>[\s\S]*$/i, '')
        .trim();
    }

    this.memory.append(sessionId, 'user', prompt);
    // Ответ на вызов инструмента может не содержать текста вообще (только
    // toolCalls) — писать в память пустую строку бессмысленно, но и терять
    // сам факт хода ассистента в истории не хочется. Пишем как есть: пустая
    // строка допустима, вызывающий код видит toolCalls в возвращаемом result.
    this.memory.append(sessionId, 'assistant', result.text);
    this.usage.record(result.provider, result.modelId, result.usage);

    return result;
  }

  /**
   * Vision-запрос (фото + текст) — сейчас только через Gemini: единственный
   * провайдер в стеке с надёжной поддержкой image_url в OpenAI-совместимом
   * формате. Не через общий Router (там модели не размечены по vision-
   * способности) — перебирает живые модели Gemini из реестра вручную,
   * с простым fallback на следующую при ошибке.
   * @param {{ prompt: string, sessionId?: string, systemPrompt?: string, images: { mimeType: string, base64: string }[], responseFormat?: object }} args
   * @returns {Promise<GenerateResult>}
   */
  async generateVision({ prompt, sessionId, systemPrompt, images, responseFormat }) {
    if (!prompt) throw new Error('generateVision(): параметр prompt обязателен');
    if (!images?.length) throw new Error('generateVision(): нужен хотя бы один image в images');

    const gemini = this.providers.gemini;
    if (!gemini?.enabled) throw new Error('generateVision(): провайдер gemini недоступен (нет ключа)');

    const messages = this.memory.buildMessages(sessionId, { systemPrompt, prompt: '' });
    messages[messages.length - 1] = {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...images.map((img) => ({
          type: 'image_url',
          image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
        })),
      ],
    };

    // thinking-варианты (напр. gemma-*-thinking) заворачивают ответ в
    // <thought>...</thought> даже при responseFormat: json_object —
    // ломает JSON.parse() у вызывающего кода. Исключаем их из vision.
    // Ограничиваем до 2 кандидатов: без этого перебор всех живых моделей
    // без таймаута на попытку может растянуться дольше, чем ждёт вызывающая
    // сторона (у Prime Bot вебхук отваливается по таймауту) — поймали
    // вживую (запрос "завис" на ~25с и бот промолчал вместо ответа).
    const candidates = this.registry
      .all()
      .filter((e) => e.provider === 'gemini' && e.alive && !/thinking/i.test(e.modelId))
      .map((e) => e.modelId)
      .slice(0, 2);
    if (!candidates.length) throw new Error('generateVision(): нет живых моделей Gemini — запусти AI.init()');

    const VISION_ATTEMPT_TIMEOUT_MS = 12000;
    let lastError;
    for (const modelId of candidates) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), VISION_ATTEMPT_TIMEOUT_MS);
      try {
        const result = await gemini.chat(modelId, messages, { responseFormat, signal: controller.signal });
        // Некоторые Gemini/Gemma-модели заворачивают ответ в
        // <thought>...</thought> даже при responseFormat: json_object,
        // независимо от того, помечены ли они "-thinking" в названии —
        // ломает JSON.parse() у вызывающего кода. Срезаем безусловно.
        const text = result.content.replace(/^<thought>[\s\S]*?<\/thought>/i, '').trim();
        this.memory.append(sessionId, 'user', `[фото] ${prompt}`);
        this.memory.append(sessionId, 'assistant', text);
        this.usage.record('gemini', modelId, result.usage);
        return { text, toolCalls: null, usage: result.usage ?? null, provider: 'gemini', modelId };
      } catch (err) {
        lastError = err;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new Error('generateVision(): все модели Gemini недоступны');
  }

  /** Расход за сегодня по провайдеру/модели — см. utils/usageTracker.js. */
  usageToday() {
    return this.usage.today();
  }

  /** Сахарная обёртка над generate() с task: 'code'. @param {Omit<GenerateArgs, 'task'>} args @returns {Promise<GenerateResult>} */
  code(args) {
    return this.generate({ ...args, task: 'code' });
  }

  /** Сахарная обёртка над generate() с task: 'roleplay'. @param {Omit<GenerateArgs, 'task'>} args @returns {Promise<GenerateResult>} */
  roleplay(args) {
    return this.generate({ ...args, task: 'roleplay' });
  }

  /** Сахарная обёртка над generate() с task: 'analysis'. @param {Omit<GenerateArgs, 'task'>} args @returns {Promise<GenerateResult>} */
  analyze(args) {
    return this.generate({ ...args, task: 'analysis' });
  }
}

export const AI = new AIKernel();
