import fs from 'node:fs';
import { log } from '../utils/logger.js';

/**
 * npm run doctor — статический разбор .env текстом (не через process.env,
 * иначе не поймать секрет, забытый в закомментированной строке). Ловит
 * ровно те баги, что за одну сессию нашлись вручную: строка не в формате
 * KEY=VALUE, пустые обязательные ключи, перепутанные местами
 * Cloudflare Account ID/Token, живой секрет в комментарии.
 */

const ENV_PATH = new URL('../.env', import.meta.url);

const KNOWN_KEYS = [
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'CEREBRAS_API_KEY',
  'SAMBANOVA_API_KEY',
  'DEEPINFRA_API_KEY',
  'HYPERBOLIC_API_KEY',
  'GEMINI_API_KEY',
  'HF_TOKEN',
];

// Секрето-подобная строка: длинный кусок из букв/цифр/-_. без пробелов.
const SECRET_LIKE_RE = /[A-Za-z0-9_\-./]{16,}/;

function main() {
  let raw;
  try {
    raw = fs.readFileSync(ENV_PATH, 'utf-8');
  } catch {
    log.error('.env не найден — скопируй .env.example в .env и заполни ключи');
    process.exitCode = 1;
    return;
  }

  const lines = raw.split(/\r?\n/);
  const issues = [];
  const seenKeys = new Set();
  const values = {};

  lines.forEach((line, idx) => {
    const n = idx + 1;
    const trimmed = line.trim();
    if (trimmed === '') return;

    if (trimmed.startsWith('#')) {
      const body = trimmed.slice(1).trim();
      // KEY=VALUE внутри комментария, где VALUE выглядит как секрет —
      // забытый живой ключ, а не просто описательный текст в комментарии.
      const m = body.match(/^([A-Z0-9_]+)\s*=\s*(.+)$/);
      if (m && SECRET_LIKE_RE.test(m[2])) {
        issues.push(`строка ${n}: похоже на живой секрет внутри комментария (${m[1]}) — удали значение, оставь только "# ${m[1]}="`);
      }
      return;
    }

    const m = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) {
      issues.push(`строка ${n}: не в формате KEY=VALUE — "${trimmed.slice(0, 60)}"`);
      return;
    }

    const [, key, rawValue] = m;
    if (seenKeys.has(key)) issues.push(`строка ${n}: дублирующийся ключ ${key}`);
    seenKeys.add(key);

    if (rawValue !== rawValue.trim()) {
      issues.push(`строка ${n}: у ${key} лишние пробелы вокруг значения`);
    }

    values[key] = rawValue.trim();
  });

  for (const key of KNOWN_KEYS) {
    if (!(key in values) || values[key] === '') {
      issues.push(`${key} пуст или отсутствует — провайдер будет молча выключен`);
    }
  }

  if (values.CLOUDFLARE_ACCOUNT_ID && !/^[a-f0-9]{32}$/i.test(values.CLOUDFLARE_ACCOUNT_ID)) {
    issues.push(
      'CLOUDFLARE_ACCOUNT_ID не похож на 32-символьный hex — реальный Account ID именно такой. ' +
        'Проверь, не перепутан ли он местами с CLOUDFLARE_API_TOKEN (у нас так уже было один раз)',
    );
  }

  if (!issues.length) {
    log.success('.env выглядит чисто — проблем не найдено');
    return;
  }

  log.title(`Найдено проблем: ${issues.length}`);
  for (const issue of issues) log.warn(issue);
  process.exitCode = 1;
}

main();
