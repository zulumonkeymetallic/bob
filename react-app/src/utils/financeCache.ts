/**
 * A tiny TTL cache for the finance callables.
 *
 * Why: fetchDashboardData and fetchFinanceEnhancementData each read the user's whole
 * transaction history, and measured against a real account they take ~9s and ~12s on a cold
 * instance against ~1.6s warm. Most of that is Cloud Functions cold start — index.js is
 * ~22k lines and every function loads the entire module tree before doing any work — so it
 * is paid again every time the page is revisited after the instance scales to zero.
 *
 * This cannot fix the first load of a session; nothing on the client can. What it does fix
 * is the far more common case of moving between finance tabs, going back, or flipping a
 * range and returning: those become instant instead of paying the full round trip again.
 *
 * Deliberately in-memory rather than sessionStorage: the payloads are large, they contain
 * transaction detail, and a hard refresh SHOULD refetch rather than serve something stale
 * from disk.
 */

interface Entry {
    value: unknown;
    expiresAt: number;
}

const store = new Map<string, Entry>();

/** Five minutes: long enough to cover navigation, short enough that a sync shows up. */
export const FINANCE_CACHE_TTL_MS = 5 * 60 * 1000;

export function cacheKey(parts: Array<string | number | null | undefined>): string {
    return parts.map((part) => String(part ?? '')).join('|');
}

export function getCached<T>(key: string): T | null {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
    }
    return entry.value as T;
}

export function setCached(key: string, value: unknown, ttlMs = FINANCE_CACHE_TTL_MS): void {
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Run `loader` unless a fresh result is cached. `force` bypasses the cache and refreshes
 * it — what an explicit Refresh or a post-sync reload needs, so the user is never stuck
 * looking at figures they just changed.
 */
export async function withCache<T>(key: string, loader: () => Promise<T>, force = false): Promise<T> {
    if (!force) {
        const hit = getCached<T>(key);
        if (hit !== null) return hit;
    }
    const value = await loader();
    setCached(key, value);
    return value;
}

/** Drop everything, or everything under a prefix. Call after any write that changes figures. */
export function invalidateFinanceCache(prefix?: string): void {
    if (!prefix) {
        store.clear();
        return;
    }
    Array.from(store.keys())
        .filter((key) => key.startsWith(prefix))
        .forEach((key) => store.delete(key));
}

export const __testing = { store };
