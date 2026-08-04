import { cacheKey, getCached, setCached, withCache, invalidateFinanceCache, __testing } from './financeCache';

describe('financeCache', () => {
    beforeEach(() => __testing.store.clear());

    test('serves a cached value instead of running the loader again', async () => {
        const loader = jest.fn().mockResolvedValue({ total: 1 });
        const key = cacheKey(['uid', '90d']);
        await withCache(key, loader);
        await withCache(key, loader);
        expect(loader).toHaveBeenCalledTimes(1);
    });

    test('force bypasses the cache and refreshes it', async () => {
        // Every post-write refresh uses this: serving a cached figure straight after a
        // sync would show the user the numbers they just changed away from.
        const loader = jest.fn().mockResolvedValueOnce({ total: 1 }).mockResolvedValueOnce({ total: 2 });
        const key = cacheKey(['uid', '90d']);
        await withCache(key, loader);
        const second = await withCache(key, loader, true);
        expect(loader).toHaveBeenCalledTimes(2);
        expect(second).toEqual({ total: 2 });
        expect(getCached(key)).toEqual({ total: 2 });
    });

    test('different ranges do not collide', async () => {
        setCached(cacheKey(['uid', '30d']), { total: 30 });
        setCached(cacheKey(['uid', '90d']), { total: 90 });
        expect(getCached(cacheKey(['uid', '30d']))).toEqual({ total: 30 });
        expect(getCached(cacheKey(['uid', '90d']))).toEqual({ total: 90 });
    });

    test('an expired entry is not served', () => {
        const key = cacheKey(['uid', '90d']);
        setCached(key, { total: 1 }, -1);
        expect(getCached(key)).toBeNull();
    });

    test('invalidating by prefix clears every range for that user', () => {
        setCached(cacheKey(['uid-a', '30d']), { total: 1 });
        setCached(cacheKey(['uid-a', '90d']), { total: 2 });
        setCached(cacheKey(['uid-b', '30d']), { total: 3 });
        invalidateFinanceCache('uid-a');
        expect(getCached(cacheKey(['uid-a', '30d']))).toBeNull();
        expect(getCached(cacheKey(['uid-a', '90d']))).toBeNull();
        expect(getCached(cacheKey(['uid-b', '30d']))).toEqual({ total: 3 });
    });
});
