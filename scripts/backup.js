#!/usr/bin/env node
/**
 * Бэкап истории проектов в Google Drive (диск G:, папка "Мой диск").
 *
 * Формат — `git bundle`: один файл на репозиторий, внутри вся история
 * коммитов и веток. Из него репозиторий восстанавливается полностью:
 *   git clone guren.bundle Guren
 *
 * Почему бандл, а не копия папки: копия тянет за собой node_modules
 * (сотни мегабайт мусора, который ставится обратно одной командой) и,
 * что важнее, .env с боевыми ключами — а в облако их класть не надо.
 * Бандл содержит ровно то, что закоммичено в git, то есть .gitignore
 * автоматически работает как фильтр от секретов.
 *
 * ВАЖНО: .env в бэкап НЕ попадает (и не должен). При восстановлении на
 * новой машине ключи прописываются заново по .env.example.
 *
 * Запуск: npm run backup
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BACKUP_DIR = 'G:\\Мой диск\\project-backups';

const PROJECTS = [
  { name: 'guren', repoPath: 'D:\\Guren' },
  { name: 'ai-dungeon-master', repoPath: 'C:\\Users\\Turni\\ai-dungeon-master' },
];

function git(repoPath, args) {
  // stderr гасим: git bundle create/verify пишут туда прогресс и "is okay",
  // а мы печатаем свой итог. При ошибке execFileSync всё равно бросит
  // исключение с текстом — диагностика не теряется.
  return execFileSync('git', ['-C', repoPath, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function main() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log(`Создана папка бэкапов: ${BACKUP_DIR}`);
  }

  let failed = 0;

  for (const { name, repoPath } of PROJECTS) {
    if (!fs.existsSync(repoPath)) {
      console.error(`✗ ${name}: папка не найдена (${repoPath}) — пропущен`);
      failed++;
      continue;
    }

    // Незакоммиченные правки в бандл не попадут — предупреждаем явно,
    // чтобы бэкап не создавал ложного ощущения сохранности.
    const dirty = git(repoPath, ['status', '--porcelain']);
    if (dirty) {
      const count = dirty.split('\n').length;
      console.warn(`⚠ ${name}: ${count} незакоммиченных файлов — они НЕ попадут в бэкап (сначала git commit)`);
    }

    const bundlePath = path.join(BACKUP_DIR, `${name}.bundle`);
    try {
      git(repoPath, ['bundle', 'create', bundlePath, '--all']);
      git(repoPath, ['bundle', 'verify', bundlePath]);
      const sizeKb = Math.round(fs.statSync(bundlePath).size / 1024);
      const lastCommit = git(repoPath, ['log', '-1', '--format=%h %s']);
      console.log(`✓ ${name}: ${sizeKb} KB — ${lastCommit}`);
    } catch (err) {
      console.error(`✗ ${name}: не удалось сделать бэкап — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nБэкапы: ${BACKUP_DIR}`);
  console.log('Восстановление: git clone <файл>.bundle <папка>');

  if (failed) process.exitCode = 1;
}

main();
