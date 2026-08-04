const { resolveTransactionCategory, buildCategoryIndex } = require('./bucketResolver');
const { DEFAULT_FINANCE_CATEGORIES } = require('./categories');

const categoryIndex = buildCategoryIndex(DEFAULT_FINANCE_CATEGORIES);
const resolve = (tx) => resolveTransactionCategory(tx, { categoryIndex });

describe('merchant-rule category keys', () => {
  test('a merchant rule key resolves the transaction', () => {
    // merchant_mappings has always carried categoryKey; the sync writer applied only the
    // coarse categoryType, so 1,006 transactions read as uncategorised despite having a
    // perfectly good category on file for their merchant.
    const resolved = resolve({ mappedCategoryKey: 'groceries', amountMinor: -4200 });
    expect(resolved.categoryKey).toBe('groceries');
    expect(resolved.bucketSource).toBe('mapped_key');
    expect(resolved.bucket).not.toBe('unknown');
  });

  test('a per-transaction choice still beats the merchant rule', () => {
    // A rule must never overwrite a choice — the whole reason userCategoryKey outranks
    // userCategoryType in the first place.
    const resolved = resolve({
      userCategoryKey: 'coffee',
      mappedCategoryKey: 'groceries',
      amountMinor: -400,
    });
    expect(resolved.categoryKey).toBe('coffee');
    expect(resolved.bucketSource).toBe('user_key');
  });

  test('the rule key beats the coarse rule type from the same mapping', () => {
    const resolved = resolve({
      mappedCategoryKey: 'coffee',
      userCategoryType: 'optional',
      amountMinor: -400,
    });
    expect(resolved.bucketSource).toBe('mapped_key');
  });

  test('a stored AI key is still used when there is no rule', () => {
    const resolved = resolve({ aiCategoryKey: 'groceries', amountMinor: -4200 });
    expect(resolved.bucketSource).toBe('ai_key');
  });

  test('the rule key outranks a stored AI key', () => {
    const resolved = resolve({
      mappedCategoryKey: 'coffee',
      aiCategoryKey: 'groceries',
      amountMinor: -400,
    });
    expect(resolved.categoryKey).toBe('coffee');
  });

  test('an unrecognised rule key does not fabricate a bucket', () => {
    const resolved = resolve({ mappedCategoryKey: 'not_a_real_category', amountMinor: -400 });
    expect(resolved.bucket).toBe('unknown');
  });
});
