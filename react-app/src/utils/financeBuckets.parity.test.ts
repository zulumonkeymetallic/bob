// The bucket resolver and the category catalogue each exist twice — once in
// functions/ (CommonJS, what the LLM prompt and all analytics read) and once here
// (TypeScript, what the UI reads). CRA's ModuleScopePlugin blocks importing across
// that boundary, and a build step for two modules is not worth it in a repo whose
// build is a bash script.
//
// So: the functions/ copies are the source of truth, and these tests fail loudly
// the moment the two drift. Read with fs rather than require() — CRA's jest sets
// roots to <rootDir>/src, and reading the text has no module-resolution surprises.

import fs from 'fs';
import path from 'path';

import { DEFAULT_CATEGORIES } from './financeCategories';
import { WIDEN_V4_TO_V10, NARROW_V10_TO_V4, V10_BUCKETS, V4_BUCKETS } from './financeBuckets';

const FUNCTIONS_DIR = path.join(__dirname, '..', '..', '..', 'functions', 'finance');
const CATEGORIES_JS = path.join(FUNCTIONS_DIR, 'categories.js');
const RESOLVER_JS = path.join(FUNCTIONS_DIR, 'bucketResolver.js');

const readSource = (file: string): string => {
    expect(fs.existsSync(file)).toBe(true);
    return fs.readFileSync(file, 'utf8');
};

/** Pull `{ key: 'x', label: '...', bucket: 'y' }` pairs out of either file. */
const extractKeyBucketPairs = (source: string): Record<string, string> => {
    const pairs: Record<string, string> = {};
    const entry = /key:\s*'([a-z0-9_]+)'[^}]*?bucket:\s*'([a-z_]+)'/g;
    let match = entry.exec(source);
    while (match !== null) {
        pairs[match[1]] = match[2];
        match = entry.exec(source);
    }
    return pairs;
};

/** Pull a `const NAME = { a: 'b', ... }` object literal out of the CommonJS source. */
const extractStringMap = (source: string, constName: string): Record<string, string> => {
    const block = new RegExp(`const ${constName} = \\{([\\s\\S]*?)\\n\\};`).exec(source);
    expect(block).not.toBeNull();
    const map: Record<string, string> = {};
    const entry = /^\s*([a-z_]+):\s*'([a-z_]+)',/gm;
    let match = entry.exec(block![1]);
    while (match !== null) {
        map[match[1]] = match[2];
        match = entry.exec(block![1]);
    }
    return map;
};

/** Pull a `const NAME = [ 'a', 'b' ];` array literal out of the CommonJS source. */
const extractStringArray = (source: string, constName: string): string[] => {
    const block = new RegExp(`const ${constName} = \\[([\\s\\S]*?)\\];`).exec(source);
    expect(block).not.toBeNull();
    return Array.from(block![1].matchAll(/'([a-z_0-9]+)'/g)).map((m) => m[1]);
};

describe('finance category catalogue parity', () => {
    const backendPairs = extractKeyBucketPairs(readSource(CATEGORIES_JS));

    const frontendPairs = DEFAULT_CATEGORIES.reduce<Record<string, string>>((acc, category) => {
        acc[category.key] = category.bucket;
        return acc;
    }, {});

    it('parses a plausible number of backend categories', () => {
        // Guards the regex itself: a silent parse failure would make every
        // assertion below vacuously pass.
        expect(Object.keys(backendPairs).length).toBeGreaterThan(50);
    });

    it('has identical key sets in functions/finance/categories.js and financeCategories.ts', () => {
        const backendKeys = Object.keys(backendPairs).sort();
        const frontendKeys = Object.keys(frontendPairs).sort();

        expect(frontendKeys.filter((k) => !backendKeys.includes(k))).toEqual([]);
        expect(backendKeys.filter((k) => !frontendKeys.includes(k))).toEqual([]);
    });

    it('assigns every key to the same bucket on both sides', () => {
        const mismatches = Object.keys(backendPairs)
            .filter((key) => key in frontendPairs && backendPairs[key] !== frontendPairs[key])
            .map((key) => `${key}: functions=${backendPairs[key]} react-app=${frontendPairs[key]}`);

        expect(mismatches).toEqual([]);
    });

    it('only ever uses buckets from the V10 vocabulary', () => {
        const unknownBuckets = Array.from(new Set(Object.values(backendPairs)))
            .filter((bucket) => !(V10_BUCKETS as string[]).includes(bucket));

        expect(unknownBuckets).toEqual([]);
    });
});

describe('bucket resolver parity', () => {
    const source = readSource(RESOLVER_JS);

    it('agrees on the V10 vocabulary', () => {
        expect(extractStringArray(source, 'V10_BUCKETS')).toEqual(V10_BUCKETS);
    });

    it('agrees on the V4 vocabulary', () => {
        expect(extractStringArray(source, 'V4_BUCKETS')).toEqual(V4_BUCKETS);
    });

    it('agrees on the V4 -> V10 widening', () => {
        expect(extractStringMap(source, 'WIDEN_V4_TO_V10')).toEqual(WIDEN_V4_TO_V10);
    });

    it('agrees on the V10 -> V4 narrowing', () => {
        expect(extractStringMap(source, 'NARROW_V10_TO_V4')).toEqual(NARROW_V10_TO_V4);
    });
});
