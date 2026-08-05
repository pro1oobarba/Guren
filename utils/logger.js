import fs from 'node:fs';

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

// Опционально: LOG_FILE=./kernel.log в .env — полезно, когда ядро дёргают
// удалённо (телефон, remote-control) и консоли перед глазами может не
// быть. По умолчанию (LOG_FILE не задан) поведение не меняется — только
// консоль, как раньше.
const LOG_FILE = process.env.LOG_FILE || null;

function stamp() {
  return new Date().toISOString().slice(11, 19);
}

function writeToFile(level, msg) {
  if (!LOG_FILE) return;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase().padEnd(7)} ${msg}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
  } catch {
    // Сбой записи в файл не должен ронять сам вызов лога — это побочный канал.
  }
}

function make(level, prefix, color) {
  return (msg) => {
    console.log(`${color}[${stamp()}] ${prefix}${COLORS.reset} ${msg}`);
    writeToFile(level, msg);
  };
}

export const log = {
  info: make('info', 'ℹ', COLORS.cyan),
  success: make('success', '✓', COLORS.green),
  warn: make('warn', '⚠', COLORS.yellow),
  error: make('error', '✗', COLORS.red),
  title: (msg) => {
    console.log(`\n${COLORS.bold}${COLORS.cyan}=== ${msg} ===${COLORS.reset}`);
    writeToFile('title', `=== ${msg} ===`);
  },
  gray: (msg) => console.log(`${COLORS.gray}${msg}${COLORS.reset}`), // служебный вывод, в файл не дублируем
};
