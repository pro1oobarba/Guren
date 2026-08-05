import { log } from '../utils/logger.js';

/**
 * HealthChecker — пингует модели всех активных провайдеров коротким
 * запросом "ping", пишет результат в ModelRegistry и красиво логирует.
 * Для OpenRouter специально просит только бесплатные модели (freeOnly: true),
 * чтобы не улететь в rate limit, проверяя сотни платных моделей.
 */
// Верхний предел моделей на провайдера при health-check. У платных по
// токену провайдеров (DeepInfra, HuggingFace-router и т.д.) каталог может
// быть в сотни моделей — пинговать их все означало бы реальные расходы и
// долгий старт. Ограничиваем, а не проверяем поштучно всё подряд.
const MAX_MODELS_PER_PROVIDER = 8;

export class HealthChecker {
  constructor({ providers, registry }) {
    this.providers = providers;
    this.registry = registry;
  }

  async run({ openrouterFreeOnly = true } = {}) {
    log.title('Проверка доступности моделей');
    const jobs = [];

    for (const provider of Object.values(this.providers)) {
      if (!provider.enabled) {
        log.warn(`${provider.name}: пропущен (нет ключей в .env)`);
        continue;
      }

      let models = [];
      try {
        models =
          provider.name === 'openrouter'
            ? await provider.listModels({ freeOnly: openrouterFreeOnly })
            : await provider.listModels();
      } catch (err) {
        log.error(`${provider.name}: не удалось получить список моделей — ${err.message}`);
        continue;
      }

      if (models.length > MAX_MODELS_PER_PROVIDER) {
        models = models.slice(0, MAX_MODELS_PER_PROVIDER);
      }

      log.info(`${provider.name}: ${models.length} моделей к проверке`);
      for (const model of models) {
        jobs.push(this.pingOne(provider, model.id));
      }
    }

    await Promise.all(jobs);
    this.printSummary();
    return this.registry.toJSON();
  }

  async pingOne(provider, modelId) {
    const result = await provider.ping(modelId);
    this.registry.upsert(provider.name, modelId, result);
    if (result.alive) {
      log.success(`  ${provider.name}/${modelId} — ${result.latency}ms`);
    } else {
      log.error(`  ${provider.name}/${modelId} — ${result.error}`);
    }
  }

  printSummary() {
    const all = this.registry.all();
    const alive = all.filter((e) => e.alive);
    log.title(`Итог: ${alive.length} живых из ${all.length} проверенных`);
  }
}
