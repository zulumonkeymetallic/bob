/**
 * Firestore's IndexedDB cache can strand a device on data that no longer exists.
 *
 * db is created with `persistentLocalCache({ tabManager: persistentMultipleTabManager() })`,
 * so onSnapshot emits from IndexedDB first and reconciles against the server afterwards. On
 * iOS Safari that reconcile step is not guaranteed: if the tab never wins the multi-tab
 * primary lease, or IndexedDB is evicted mid-write and the local mutation log is left
 * inconsistent, listeners keep replaying the cached documents and never surface the server
 * state. Refreshing does not help, because the cache survives a refresh — that is its
 * entire purpose.
 *
 * Observed live 2026-07-28: Jim's phone showed 24 "Program 100 bicep curls" rows on the
 * Daily Checklist and an empty sprint picker, across repeated refreshes, while the same
 * queries run against Firestore returned one chore row and eight sprints. Deleted documents
 * and a query that had never resolved, both served from a cache that would not let go.
 *
 * The guard: stamp the build hash. When it changes — i.e. a deploy has landed — drop the
 * Firestore IndexedDB databases once, before Firestore opens them, then continue booting.
 * The next listener fetch is forced to go to the server. A deploy therefore becomes the
 * escape hatch it was always assumed to be.
 *
 * Must run before `initializeFirestore`, hence the direct call from firebase.ts rather than
 * a React effect.
 */

const BUILD_STAMP_KEY = 'bob_cache_build_stamp';

/** Firestore's IndexedDB databases are named `firestore/[DEFAULT]/<projectId>/main`. */
const isFirestoreDb = (name: string | null | undefined): boolean =>
    typeof name === 'string' && name.startsWith('firestore/');

const currentBuildStamp = (): string => {
    // Injected by the build (see public/index.html's window.BOB_BUILD). Falls back to the
    // bundle's own hash so a dev build still gets a stable, changing value.
    const injected = (window as any)?.BOB_BUILD?.build || (window as any)?.BOB_BUILD?.version;
    if (injected) return String(injected);
    return String(process.env.REACT_APP_BUILD_HASH || process.env.NODE_ENV || 'dev');
};

/**
 * Returns true when the cache was dropped, so callers can log it. Never throws: a browser
 * that refuses `indexedDB.databases()` (Safari < 14, Firefox) simply skips the sweep and
 * keeps the old behaviour rather than blocking boot.
 */
export async function clearStaleFirestoreCache(): Promise<boolean> {
    if (typeof window === 'undefined' || !('indexedDB' in window)) return false;

    let previous: string | null = null;
    const stamp = currentBuildStamp();
    try {
        previous = localStorage.getItem(BUILD_STAMP_KEY);
        localStorage.setItem(BUILD_STAMP_KEY, stamp);
    } catch {
        return false; // no storage, nothing reliable to compare against
    }

    // First run on a device: record the stamp but leave a healthy cache alone.
    if (previous === null || previous === stamp) return false;

    try {
        const anyIdb = indexedDB as any;
        if (typeof anyIdb.databases !== 'function') return false;
        const dbs: Array<{ name?: string }> = await anyIdb.databases();
        const targets = dbs.map((d) => d?.name).filter(isFirestoreDb) as string[];
        if (targets.length === 0) return false;

        await Promise.all(targets.map((name) => new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(name);
            // `blocked` fires when another tab still holds the database open. Resolving
            // rather than hanging means a second tab can never wedge the boot sequence —
            // the delete completes once that tab closes.
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
        })));
        return true;
    } catch {
        return false;
    }
}

/**
 * Manual escape hatch for a device that is already stuck: drops the build stamp and every
 * Firestore database, then reloads. Wired to "Force refresh" in the mobile menu.
 */
export async function forceCacheReset(): Promise<void> {
    try { localStorage.removeItem(BUILD_STAMP_KEY); } catch { /* noop */ }
    try {
        const anyIdb = indexedDB as any;
        if (typeof anyIdb.databases === 'function') {
            const dbs: Array<{ name?: string }> = await anyIdb.databases();
            await Promise.all(
                dbs.map((d) => d?.name).filter(isFirestoreDb).map((name) => new Promise<void>((resolve) => {
                    const req = indexedDB.deleteDatabase(name as string);
                    req.onsuccess = () => resolve();
                    req.onerror = () => resolve();
                    req.onblocked = () => resolve();
                })),
            );
        }
    } catch { /* noop */ }
    try {
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map((r) => r.unregister()));
        }
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
        }
    } catch { /* noop */ }
    window.location.reload();
}
