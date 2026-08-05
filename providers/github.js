import { BaseProvider } from './BaseProvider.js';

/**
 * ⚠️ ВАЖНО, прочитай перед использованием.
 *
 * GitHub Models — сервис, который был указан в исходном тех. задании
 * (эндпоинт models.inference.ai.azure.com) — полностью закрыт компанией
 * GitHub 30 июля 2026 года. Отключены playground, каталог моделей,
 * inference API и BYOK — для ВСЕХ пользователей, включая тех, кто уже
 * им пользовался. GitHub направляет на Microsoft Foundry или GitHub Copilot.
 * Поэтому реальной реализации chat()/listModels() здесь нет — только
 * заготовка на будущее.
 *
 * Класс оставлен в проекте по двум причинам:
 * 1. Как шаблон адаптера "OpenAI-совместимый эндпоинт + Bearer токен" —
 *    пригодится, если решишь подключить похожий сервис (Azure AI Foundry,
 *    Mistral La Plateforme, Google AI Studio и т.д.) — паттерн тот же.
 * 2. Чтобы явно показать в реестре провайдеров, что этот пункт из ТЗ
 *    закрыт не багом, а решением стороннего сервиса.
 *
 * enabled всегда false — HealthChecker и Router его игнорируют.
 */
export class GitHubModelsProvider extends BaseProvider {
  constructor() {
    super({ name: 'github', apiKey: null, baseUrl: null, enabled: false });
  }

  async listModels() {
    return [];
  }

  async chat() {
    throw new Error('GitHub Models отключён — сервис закрыт GitHub 30.07.2026, провайдер не активен');
  }
}
