import {
    resolveTransactionCategory,
    buildCategoryIndex,
    widenToV10,
    narrowToV4,
    isCoarseWidening,
    amountOf,
    V10_BUCKETS,
    V4_BUCKETS,
} from './financeBuckets';

const categoryIndex = buildCategoryIndex([
    { key: 'groceries', label: 'Groceries', bucket: 'mandatory' },
    { key: 'coffee', label: 'Coffee', bucket: 'discretionary' },
    { key: 'retirement', label: 'Retirement', bucket: 'investment' },
    { key: 'snowball', label: 'Debt Snowball Budget', bucket: 'debt_repayment' },
]);

describe('widenToV10 / narrowToV4', () => {
    it('widens every V4 value', () => {
        expect(widenToV10('mandatory')).toBe('mandatory');
        expect(widenToV10('optional')).toBe('discretionary');
        expect(widenToV10('savings')).toBe('short_saving');
        expect(widenToV10('income')).toBe('net_salary');
    });

    it('passes V10 values through unchanged', () => {
        V10_BUCKETS.forEach((bucket) => expect(widenToV10(bucket)).toBe(bucket));
    });

    it('narrows every V10 value except the two with no V4 home', () => {
        expect(narrowToV4('mandatory')).toBe('mandatory');
        // The gap that dashboard.js never closed: debt_repayment must roll into mandatory.
        expect(narrowToV4('debt_repayment')).toBe('mandatory');
        expect(narrowToV4('discretionary')).toBe('optional');
        expect(narrowToV4('short_saving')).toBe('savings');
        expect(narrowToV4('long_saving')).toBe('savings');
        expect(narrowToV4('investment')).toBe('savings');
        // The other gap: net_salary and irregular_income were reported as separate buckets.
        expect(narrowToV4('net_salary')).toBe('income');
        expect(narrowToV4('irregular_income')).toBe('income');
        expect(narrowToV4('bank_transfer')).toBeNull();
        expect(narrowToV4('unknown')).toBeNull();
    });

    it('round-trips V4 -> V10 -> V4 stably', () => {
        V4_BUCKETS.forEach((v4) => {
            expect(narrowToV4(widenToV10(v4))).toBe(v4);
        });
    });

    it('returns null rather than throwing on junk', () => {
        expect(widenToV10('nonsense')).toBeNull();
        expect(widenToV10('')).toBeNull();
        expect(widenToV10(null)).toBeNull();
        expect(widenToV10(undefined)).toBeNull();
        expect(narrowToV4('nonsense')).toBeNull();
    });

    it('is case and whitespace insensitive', () => {
        expect(widenToV10('  Optional ')).toBe('discretionary');
        expect(narrowToV4('DEBT_REPAYMENT')).toBe('mandatory');
    });

    it('flags the two lossy widenings', () => {
        expect(isCoarseWidening('savings')).toBe(true);
        expect(isCoarseWidening('income')).toBe(true);
        expect(isCoarseWidening('mandatory')).toBe(false);
        expect(isCoarseWidening('optional')).toBe(false);
    });
});

describe('resolveTransactionCategory precedence', () => {
    it('1. pot transfer beats everything', () => {
        const potIndex = new Map([['pot_abc', { name: 'Holiday' }]]);
        const result = resolveTransactionCategory({
            metadata: { destination_pot_id: 'pot_abc' },
            userCategoryKey: 'groceries',
            userCategoryType: 'mandatory',
            aiBucket: 'discretionary',
            amount: -50,
        }, { categoryIndex, potIndex });

        expect(result.bucket).toBe('bank_transfer');
        expect(result.bucketSource).toBe('pot');
        expect(result.isPotTransfer).toBe(true);
        expect(result.categoryLabel).toBe('Transfer to Holiday');
    });

    it('2. userCategoryKey beats userCategoryType, aiBucket and default', () => {
        const result = resolveTransactionCategory({
            userCategoryKey: 'coffee',
            userCategoryType: 'mandatory',
            aiBucket: 'investment',
            defaultCategoryType: 'income',
        }, { categoryIndex });

        expect(result.bucket).toBe('discretionary');
        expect(result.bucketSource).toBe('user_key');
    });

    it('3. userCategoryType beats aiBucket — the inversion this module exists to fix', () => {
        const result = resolveTransactionCategory({
            userCategoryType: 'mandatory',
            aiBucket: 'discretionary',
            aiCategoryKey: 'coffee',
        }, { categoryIndex });

        expect(result.bucket).toBe('mandatory');
        expect(result.bucketSource).toBe('user_type');
    });

    it('4. aiBucket applies when the user has expressed no preference', () => {
        const result = resolveTransactionCategory({
            aiBucket: 'discretionary',
            defaultCategoryType: 'mandatory',
        }, { categoryIndex });

        expect(result.bucket).toBe('discretionary');
        expect(result.bucketSource).toBe('ai_bucket');
    });

    it('5. aiCategoryKey applies when aiBucket is absent', () => {
        const result = resolveTransactionCategory({
            aiCategoryKey: 'retirement',
            defaultCategoryType: 'optional',
        }, { categoryIndex });

        expect(result.bucket).toBe('investment');
        expect(result.bucketSource).toBe('ai_key');
    });

    it('6. defaultCategoryType is the last real signal', () => {
        const result = resolveTransactionCategory({ defaultCategoryType: 'optional' }, { categoryIndex });
        expect(result.bucket).toBe('discretionary');
        expect(result.bucketSource).toBe('default');
    });

    it('7. falls through to unknown rather than guessing', () => {
        const result = resolveTransactionCategory({}, { categoryIndex });
        expect(result.bucket).toBe('unknown');
        expect(result.bucketSource).toBe('none');
        expect(result.categoryKey).toBe('uncategorized');
        expect(result.categoryLabel).toBe('Uncategorised');
    });

    it('marks a coarse widening so callers do not pretend to know short vs long saving', () => {
        const exact = resolveTransactionCategory({ userCategoryKey: 'retirement' }, { categoryIndex });
        expect(exact.bucketPrecision).toBe('exact');

        const coarse = resolveTransactionCategory({ userCategoryType: 'savings' }, { categoryIndex });
        expect(coarse.bucket).toBe('short_saving');
        expect(coarse.bucketPrecision).toBe('coarse');
    });

    it('ignores an unrecognised userCategoryKey and falls to the next signal', () => {
        const result = resolveTransactionCategory({
            userCategoryKey: 'no_such_category',
            aiBucket: 'discretionary',
        }, { categoryIndex });

        expect(result.bucket).toBe('discretionary');
        expect(result.bucketSource).toBe('ai_bucket');
        // The key still surfaces for display even though it resolved no bucket.
        expect(result.categoryKey).toBe('no_such_category');
    });

    it('resolves the label independently of the bucket', () => {
        const result = resolveTransactionCategory({
            userCategoryKey: 'groceries',
            userCategoryType: 'savings',
        }, { categoryIndex });

        expect(result.bucket).toBe('mandatory');
        expect(result.categoryLabel).toBe('Groceries');
    });

    it('always exposes the V4 projection alongside the V10 bucket', () => {
        const result = resolveTransactionCategory({ userCategoryKey: 'snowball' }, { categoryIndex });
        expect(result.bucket).toBe('debt_repayment');
        expect(result.bucketV4).toBe('mandatory');
    });
});

describe('amountOf', () => {
    it('prefers amount, then amountMinor, then raw.amount', () => {
        expect(amountOf({ amount: -12.5 })).toBe(-12.5);
        expect(amountOf({ amountMinor: -1250 })).toBe(-12.5);
        expect(amountOf({ raw: { amount: -1250 } })).toBe(-12.5);
        expect(amountOf({})).toBe(0);
        expect(amountOf(null)).toBe(0);
    });
});
