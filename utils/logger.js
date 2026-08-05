const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

function stamp() {
  return new Date().toISOString().slice(11, 19);
}

export const log = {
  info: (msg) => console.log(`${COLORS.cyan}[${stamp()}] ℹ${COLORS.reset} ${msg}`),
  success: (msg) => console.log(`${COLORS.green}[${stamp()}] ✓${COLORS.reset} ${msg}`),
  warn: (msg) => console.log(`${COLORS.yellow}[${stamp()}] ⚠${COLORS.reset} ${msg}`),
  error: (msg) => console.log(`${COLORS.red}[${stamp()}] ✗${COLORS.reset} ${msg}`),
  title: (msg) => console.log(`\n${COLORS.bold}${COLORS.cyan}=== ${msg} ===${COLORS.reset}`),
  gray: (msg) => console.log(`${COLORS.gray}${msg}${COLORS.reset}`),
};
