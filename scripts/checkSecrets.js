import { execSync } from 'node:child_process';
import { log } from '../utils/logger.js';

/**
 * Страховка перед пушем в GitHub (запланирован, приватный репозиторий).
 * Сканирует staged файлы на известные форматы реальных ключей, с которыми
 * этот проект уже сталкивался (Groq, OpenRouter, Cerebras, Cloudflare,
 * HuggingFace, GitHub PAT, sk_live_-стиль). Не претендует на все
 * возможные форматы секретов — точечная защита от повторения конкретных
 * утечек, что уже случались в .env за эту сессию, а не универсальный
 * secret-scanner.
 */
const KNOWN_SECRET_PATTERNS = [
  [/gsk_[A-Za-z0-9]{10,}/, 'Groq API key (gsk_...)'],
  [/sk-or-v1-[a-f0-9]{16,}/i, 'OpenRouter API key (sk-or-v1-...)'],
  [/csk-[a-z0-9]{16,}/, 'Cerebras API key (csk-...)'],
  [/cfut_[A-Za-z0-9]{16,}/, 'Cloudflare token (cfut_...)'],
  [/hf_[A-Za-z0-9]{16,}/, 'HuggingFace token (hf_...)'],
  [/github_pat_[A-Za-z0-9_]{16,}/, 'GitHub PAT (github_pat_...)'],
  [/sk_live_[A-Za-z0-9_-]{16,}/, 'live API key (sk_live_...)'],
];

function stagedFiles() {
  return execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf-8' })
    .split('\n')
    .filter(Boolean);
}

function main() {
  let files;
  try {
    files = stagedFiles();
  } catch {
    log.warn('check-secrets: не похоже на git-репозиторий или нет staged файлов — пропускаю');
    return;
  }

  const problems = [];

  for (const file of files) {
    if (file === '.env') {
      problems.push(`${file}: .env не должен коммититься вообще (проверь .gitignore)`);
      continue;
    }

    let content;
    try {
      content = execSync(`git show ":${file}"`, { encoding: 'utf-8' });
    } catch {
      continue; // бинарник или файл вне текущей директории — пропускаем, не наша забота
    }

    content.split('\n').forEach((line, idx) => {
      for (const [pattern, label] of KNOWN_SECRET_PATTERNS) {
        if (pattern.test(line)) problems.push(`${file}:${idx + 1} — похоже на ${label}`);
      }
    });
  }

  if (problems.length) {
    log.error(`check-secrets: найдено ${problems.length} потенциальных утечек — коммит заблокирован`);
    for (const p of problems) log.warn(p);
    log.info('Ложное срабатывание? git commit --no-verify (осознанно, не по умолчанию)');
    process.exit(1);
  }

  log.success('check-secrets: в staged файлах ничего подозрительного не найдено');
}

main();
