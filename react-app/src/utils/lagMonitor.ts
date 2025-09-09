import logger from './logger';

let timer: number | null = null;

export function startLagMonitor(intervalMs = 1000, warnThresholdMs = 200) {
  if (timer != null) return;
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    const drift = now - last - intervalMs;
    last = now;
    if (drift > warnThresholdMs) {
      logger.warn('perf', 'Event loop lag detected', { driftMs: Math.round(drift), intervalMs });
    } else {
      logger.debug('perf', 'Event loop check', { driftMs: Math.round(drift) });
    }
    // @ts-ignore
    timer = window.setTimeout(tick, intervalMs);
  };
  // @ts-ignore
  timer = window.setTimeout(tick, intervalMs);
  logger.info('perf', 'Lag monitor started', { intervalMs, warnThresholdMs });
}

export function stopLagMonitor() {
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
    logger.info('perf', 'Lag monitor stopped');
  }
}

