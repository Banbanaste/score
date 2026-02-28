// Structured server logger with ANSI colors and elapsed time tracking

const COLORS: Record<string, string> = {
  SERVER: '\x1b[36m',   // cyan
  SOCKET: '\x1b[34m',   // blue
  ROOM:   '\x1b[33m',   // yellow
  GAME:   '\x1b[32m',   // green
  INFER:  '\x1b[35m',   // magenta
  CLEAN:  '\x1b[90m',   // gray
  ERROR:  '\x1b[31m',   // red
};
const RESET = '\x1b[0m';
const DIM   = '\x1b[2m';
const BOLD  = '\x1b[1m';

function ts(): string {
  return new Date().toISOString().split('T')[1].replace('Z', '');
}

function formatVal(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return '—';
  if (typeof v === 'object' && Array.isArray(v)) return `[${v.join(',')}]`;
  return String(v);
}

export function log(
  module: string,
  event: string,
  data?: Record<string, unknown>
): void {
  const color = COLORS[module] || '';
  const fields = data
    ? ' ' + Object.entries(data).map(([k, v]) => `${DIM}${k}=${RESET}${formatVal(v)}`).join(' ')
    : '';
  console.log(
    `${DIM}${ts()}${RESET} ${color}${BOLD}[${module.padEnd(6)}]${RESET} ${event.padEnd(24)}${fields}`
  );
}

export function logError(
  module: string,
  event: string,
  error: unknown,
  data?: Record<string, unknown>
): void {
  const msg = error instanceof Error ? error.message : String(error);
  log('ERROR', `${module}:${event}`, { ...data, error: msg });
}

export function timer(): () => number {
  const start = performance.now();
  return () => Math.round(performance.now() - start);
}

export function formatBoard(board: (string | null)[]): string {
  return board.map(c => c ?? '·').join('');
}
