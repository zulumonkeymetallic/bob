import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import reportWebVitals from './reportWebVitals';
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles/themeConsistency.css';
import './styles/responsive-density.css';
import { installGlobalErrorHandlers } from './utils/globalErrorHandlers';
import logger from './utils/logger';
import { startLagMonitor } from './utils/lagMonitor';
import { clearStaleFirestoreCache } from './utils/staleCacheGuard';

// Install global error handlers and log startup
installGlobalErrorHandlers();
logger.info('global', 'BOB app booting...');

// Keep deployment behavior deterministic: remove any stale service workers
// so clients do not keep serving outdated bundles after hosting deploys.
try {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .catch(() => {});
  }
} catch {}

try {
  const params = new URLSearchParams(window.location.search);
  if (params.get('perf') === '1' || params.get('log') === '1') {
    startLagMonitor(1000, 200);
  }
} catch {}

/**
 * Boot order matters here. `clearStaleFirestoreCache` deletes Firestore's IndexedDB
 * databases when the build hash has changed, and that can only be done *before* Firestore
 * opens them — once `initializeFirestore` has run, the delete is blocked by the open
 * connection and the device stays on its stale cache. Static imports are hoisted, so
 * `./App` (which pulls in firebase.ts) has to be loaded dynamically, after the sweep.
 *
 * Confirmed live 2026-07-28: a phone was serving deleted tasks and an empty sprint list
 * across repeated refreshes because nothing ever invalidated that cache. A deploy now does.
 */
async function boot() {
  try {
    const cleared = await clearStaleFirestoreCache();
    if (cleared) logger.info('global', 'New build detected — dropped stale Firestore cache');
  } catch {
    // Never block boot on the cache sweep.
  }

  const [{ default: App }, { ThemeProvider }, { AuthProvider }] = await Promise.all([
    import('./App'),
    import('./contexts/ThemeContext'),
    import('./contexts/AuthContext'),
  ]);

  const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement
  );
  root.render(
    // StrictMode stays off for react-beautiful-dnd compatibility
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  );

  reportWebVitals();
}

void boot();
