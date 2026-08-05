import fs from 'node:fs';
import path from 'node:path';
import { log } from '../utils/logger.js';

/**
 * .git/hooks/ не версионируется git-ом — сам хук лежит в scripts/checkSecrets.js
 * (в репозитории, виден в истории), а эта команда один раз ставит на него
 * тонкую обёртку в .git/hooks/pre-commit. Запускать после каждого свежего
 * `git clone` этого репозитория: `npm run hooks:install`.
 */
function main() {
  const gitDir = path.resolve('.git');
  if (!fs.existsSync(gitDir)) {
    log.error('.git не найден — запусти из корня репозитория после git init/clone');
    process.exitCode = 1;
    return;
  }

  const hooksDir = path.join(gitDir, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  const hookPath = path.join(hooksDir, 'pre-commit');
  const hookScript = '#!/bin/sh\nnode scripts/checkSecrets.js\n';
  fs.writeFileSync(hookPath, hookScript, { mode: 0o755 });

  log.success(`pre-commit хук установлен: ${hookPath}`);
}

main();
