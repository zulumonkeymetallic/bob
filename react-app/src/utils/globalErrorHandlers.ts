import logger from './logger';

let installed = false;
let offFns: Array<() => void> = [];

export function installGlobalErrorHandlers() {
  if (installed) return;
  installed = true;

  const onError = (event: ErrorEvent) => {
    logger.error('global', 'Window error:', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error?.stack,
    });
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    const reason: any = event.reason;
    logger.error('global', 'Unhandled rejection:', {
      message: reason?.message || String(reason),
      stack: reason?.stack,
    });
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  offFns.push(() => window.removeEventListener('error', onError));
  offFns.push(() => window.removeEventListener('unhandledrejection', onRejection));

  logger.info('global', 'Global error handlers installed');
}

export function uninstallGlobalErrorHandlers() {
  offFns.forEach(off => off());
  offFns = [];
  installed = false;
  logger.info('global', 'Global error handlers removed');
}

