/* Lightweight, toggleable logger for BOB app diagnostics.
   Enable via:
   - URL: ?log=1 or ?logLevel=debug or ?channels=gantt,global
   - localStorage: BOB_LOG=1, BOB_LOG_LEVEL=debug, BOB_LOG_CHANNELS=gantt,global
*/

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

const levelOrder: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

function parseSearch(): URLSearchParams {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams('');
  }
}

function getInitialLevel(): LogLevel {
  const params = parseSearch();
  const urlLevel = (params.get('logLevel') || params.get('level') || '').toLowerCase();
  const lsLevel = (localStorage.getItem('BOB_LOG_LEVEL') || '').toLowerCase();
  const enabled = params.get('log') === '1' || localStorage.getItem('BOB_LOG') === '1';

  const asLevel = (v: string): LogLevel | null => (['error','warn','info','debug','trace'] as LogLevel[]).includes(v as LogLevel) ? (v as LogLevel) : null;
  return asLevel(urlLevel) || asLevel(lsLevel) || (enabled ? 'debug' : 'warn');
}

function getInitialChannels(): Set<string> {
  const params = parseSearch();
  const q = params.get('channels') || '';
  const ls = localStorage.getItem('BOB_LOG_CHANNELS') || '';
  const merged = [q, ls].filter(Boolean).join(',');
  const parts = merged.split(',').map(s => s.trim()).filter(Boolean);
  return new Set(parts);
}

let currentLevel: LogLevel = getInitialLevel();
let channels: Set<string> = getInitialChannels();

function enabledFor(level: LogLevel, channel?: string): boolean {
  // If channels set is non-empty, only allow those channels
  const channelOk = channels.size === 0 || (channel ? channels.has(channel) : true);
  return channelOk && levelOrder[level] <= levelOrder[currentLevel];
}

function prefix(channel?: string) {
  const ts = new Date().toISOString().substring(11, 23); // HH:MM:SS.mmm
  return channel ? `[${ts}] [${channel}]` : `[${ts}]`;
}

export const logger = {
  setLevel(level: LogLevel) {
    currentLevel = level;
    try { localStorage.setItem('BOB_LOG_LEVEL', level); } catch {}
  },
  setChannels(list: string[]) {
    channels = new Set(list);
    try { localStorage.setItem('BOB_LOG_CHANNELS', list.join(',')); } catch {}
  },
  isEnabled(level: LogLevel, channel?: string) {
    return enabledFor(level, channel);
  },
  error(channel: string, ...args: any[]) {
    if (!enabledFor('error', channel)) return;
    // eslint-disable-next-line no-console
    console.error(prefix(channel), ...args);
  },
  warn(channel: string, ...args: any[]) {
    if (!enabledFor('warn', channel)) return;
    // eslint-disable-next-line no-console
    console.warn(prefix(channel), ...args);
  },
  info(channel: string, ...args: any[]) {
    if (!enabledFor('info', channel)) return;
    // eslint-disable-next-line no-console
    console.info(prefix(channel), ...args);
  },
  debug(channel: string, ...args: any[]) {
    if (!enabledFor('debug', channel)) return;
    // eslint-disable-next-line no-console
    console.debug(prefix(channel), ...args);
  },
  trace(channel: string, ...args: any[]) {
    if (!enabledFor('trace', channel)) return;
    // eslint-disable-next-line no-console
    console.log(prefix(channel), ...args);
  },
  groupCollapsed(channel: string, label: string, cb: () => void) {
    if (!enabledFor('debug', channel)) return cb();
    // eslint-disable-next-line no-console
    console.groupCollapsed(prefix(channel), label);
    try { cb(); } finally {
      // eslint-disable-next-line no-console
      console.groupEnd();
    }
  },
  time(channel: string, label: string) {
    if (!enabledFor('debug', channel)) return { end: () => {} };
    const key = `${channel}:${label}:${Math.random().toString(36).slice(2,7)}`;
    // eslint-disable-next-line no-console
    console.time(key);
    return { end: () => { try { /* eslint-disable-next-line no-console */ console.timeEnd(key); } catch {} } };
  },
  perfMark(name: string) {
    try { performance.mark(name); } catch {}
  },
  perfMeasure(name: string, startMark: string, endMark: string) {
    try { performance.measure(name, startMark, endMark); } catch {}
  }
};

// Expose a quick toggle helper in dev console
// window.BOB_LOG=('1' to enable) and window.BOB_SET_LEVEL('debug')
declare global {
  interface Window { BOB_LOG?: string; BOB_SET_LEVEL?: (lvl: LogLevel) => void; }
}
try {
  window.BOB_SET_LEVEL = (lvl: LogLevel) => logger.setLevel(lvl);
  if (parseSearch().get('log') === '1') localStorage.setItem('BOB_LOG','1');
} catch {}

export default logger;

