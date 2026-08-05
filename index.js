import { AI } from './kernel.js';
import { log } from './utils/logger.js';

async function main() {
  log.title('AI Kernel — запуск');
  await AI.init();

  const demoPrompt = process.argv[2] ?? 'Напиши одно короткое предложение о том, зачем нужен AI Kernel.';

  log.title('Тестовый запрос через AI.generate()');
  try {
    const result = await AI.generate({ task: 'general', prompt: demoPrompt, sessionId: 'cli-demo' });
    log.success(`Ответила модель ${result.provider}/${result.modelId}:`);
    console.log(result.text);
  } catch (err) {
    log.error(`Не удалось получить ответ: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
