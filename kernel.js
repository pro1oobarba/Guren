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
import { HealthChecker } from './benchmark/HealthChecker.js';
import { MemoryManager } from './memory/MemoryManager.js';
import { log } from './utils/logger.js';

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

  /** Базовый генератор. task влияет только на выбор модели, не на формат ответа. */
  async generate({ task = 'general', prompt, sessionId, systemPrompt, timeoutMs }) {
    if (!prompt) throw new Error('generate(): параметр prompt обязателен');

    const messages = this.memory.buildMessages(sessionId, { systemPrompt, prompt });
    const result = await this.router.execute({ task, messages, ...(timeoutMs && { timeoutMs }) });

    this.memory.append(sessionId, 'user', prompt);
    this.memory.append(sessionId, 'assistant', result.text);

    return result;
  }

  code(args) {
    return this.generate({ ...args, task: 'code' });
  }

  roleplay(args) {
    return this.generate({ ...args, task: 'roleplay' });
  }

  analyze(args) {
    return this.generate({ ...args, task: 'analysis' });
  }
}

export const AI = new AIKernel();
