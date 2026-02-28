"use strict";
// Structured server logger with ANSI colors and elapsed time tracking
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = log;
exports.logError = logError;
exports.timer = timer;
exports.formatBoard = formatBoard;
const COLORS = {
    SERVER: '\x1b[36m', // cyan
    SOCKET: '\x1b[34m', // blue
    ROOM: '\x1b[33m', // yellow
    GAME: '\x1b[32m', // green
    INFER: '\x1b[35m', // magenta
    CLEAN: '\x1b[90m', // gray
    ERROR: '\x1b[31m', // red
};
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
function ts() {
    return new Date().toISOString().split('T')[1].replace('Z', '');
}
function formatVal(v) {
    if (v === null)
        return 'null';
    if (v === undefined)
        return '—';
    if (typeof v === 'object' && Array.isArray(v))
        return `[${v.join(',')}]`;
    return String(v);
}
function log(module, event, data) {
    const color = COLORS[module] || '';
    const fields = data
        ? ' ' + Object.entries(data).map(([k, v]) => `${DIM}${k}=${RESET}${formatVal(v)}`).join(' ')
        : '';
    console.log(`${DIM}${ts()}${RESET} ${color}${BOLD}[${module.padEnd(6)}]${RESET} ${event.padEnd(24)}${fields}`);
}
function logError(module, event, error, data) {
    const msg = error instanceof Error ? error.message : String(error);
    log('ERROR', `${module}:${event}`, { ...data, error: msg });
}
function timer() {
    const start = performance.now();
    return () => Math.round(performance.now() - start);
}
function formatBoard(board) {
    return board.map(c => c ?? '·').join('');
}
