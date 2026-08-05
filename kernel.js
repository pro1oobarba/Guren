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
import { log } from './utils/logger.js';

/**
 * @typedef {'general' | 'code' | 'roleplay' | 'analysis'} TaskType
 * @typedef {{ text: string, toolCalls: object[] | null, provider: string, modelId: string }} GenerateResult
 * @typedef {object} GenerateArgs
 * @property {TaskType} [task] влияет только на выбор модели, не на формат ответа; не передан — определяется эвристикой по prompt (см. router/classifyTask.js)
 * @property {string} prompt обязателен
 * @property {string} [sessionId] история сообщений накапливается по этому ключу; без него — разовый запрос без памяти
 * @property {string} [systemPrompt]
 * @property {number} [timeoutMs] дефолт — DEFAULT_TIMEOUT_MS в router/Router.js (45с)
 * @property {object[]} [tools] формат OpenAI tools API, пробрасывается как есть — поддержку со стороны конкретной модели/провайдера ядро не проверяет
 * @property {string | object} [toolChoice] см. OpenAI tool_choice
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

  async saveReport(path = './health-report.json') {
    await fs.writeFile(path, JSON.stringify(this.registry.toJSON(), null, 2), 'utf-8');
    log.info(`Отчёт диагностики сохранён: ${path}`);
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
  async generate({ task, prompt, sessionId, systemPrompt, timeoutMs, tools, toolChoice }) {
    if (!prompt) throw new Error('generate(): параметр prompt обязателен');

    // task не передан явно — эвристика по тексту промпта вместо жёсткого
    // 'general' по умолчанию (см. router/classifyTask.js). Явный task,
    // включая явное 'general', всегда имеет приоритет над эвристикой.
    const resolvedTask = task ?? classifyTask(prompt);

    const messages = this.memory.buildMessages(sessionId, { systemPrompt, prompt });
    const result = await this.router.execute({
      task: resolvedTask,
      messages,
      ...(timeoutMs && { timeoutMs }),
      ...(tools && { tools }),
      ...(toolChoice && { toolChoice }),
    });

    this.memory.append(sessionId, 'user', prompt);
    // Ответ на вызов инструмента может не содержать текста вообще (только
    // toolCalls) — писать в память пустую строку бессмысленно, но и терять
    // сам факт хода ассистента в истории не хочется. Пишем как есть: пустая
    // строка допустима, вызывающий код видит toolCalls в возвращаемом result.
    this.memory.append(sessionId, 'assistant', result.text);

    return result;
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
