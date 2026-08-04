const { suggestOwnAccountTransfers } = require('./transferSuggestions');
const { buildCategoryIndex } = require('./bucketResolver');

const categoryIndex = buildCategoryIndex([]);
const run = (txs, options = {}) => suggestOwnAccountTransfers(txs, {
  categoryIndex,
  ownerNames: ['James Donnelly'],
  ...options,
});

const rep = (n, tx) => Array.from({ length: n }, () => ({ ...tx }));

describe('suggestOwnAccountTransfers', () => {
  test('proposes an investment platform funded by bank transfer', () => {
    const out = run(rep(4, {
      merchantKey: 'fundment ltd', scheme: 'payport_faster_payments', amountMinor: -40000,
    }));
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('fundment ltd');
    expect(out[0].requiresConfirmation).toBe(true);
  });

  test('never proposes a card merchant, however regular', () => {
    // One card purchase proves a merchant; frequency must not overturn that.
    const out = run(rep(40, { merchantKey: 'tesco', scheme: 'mastercard', amountMinor: -2000 }));
    expect(out).toHaveLength(0);
  });

  test('does not propose a payment to a private individual', () => {
    // "steven mcmaster" and "mr stephen carleton" were proposed as savings accounts by a
    // first cut that scored only on "bank transfer" plus "round amounts".
    const out = run([
      ...rep(3, { merchantKey: 'steven mcmaster', scheme: 'payport_faster_payments', amountMinor: -50000 }),
      ...rep(3, { merchantKey: 'mr stephen carleton', scheme: 'payport_faster_payments', amountMinor: -50000 }),
    ]);
    expect(out).toHaveLength(0);
  });

  test('does not propose debt servicing', () => {
    const out = run(rep(6, { merchantKey: 'mortgage', scheme: 'bacs', amountMinor: -118000 }));
    expect(out).toHaveLength(0);
  });

  test('does not propose an income source', () => {
    // £70,575 in against £4,370 out is a salary. Registering it as a savings account
    // would reclassify a year of pay as an internal transfer.
    const out = run([
      ...rep(140, { merchantKey: 'donnelly j', scheme: 'payport_faster_payments', amountMinor: 50000 }),
      ...rep(4, { merchantKey: 'donnelly j', scheme: 'payport_faster_payments', amountMinor: -100000 }),
    ]);
    expect(out).toHaveLength(0);
  });

  test('does not mistake a refund for a two-way account', () => {
    // A single payment out and a single credit back is a cancelled booking.
    const out = run([
      { merchantKey: 'travel booker ltd', amountMinor: -37100 },
      { merchantKey: 'travel booker ltd', amountMinor: 39100 },
      { merchantKey: 'travel booker ltd', amountMinor: -100 },
    ]);
    expect(out).toHaveLength(0);
  });

  test('a transfer to your own name is proposed and says why', () => {
    const out = run(rep(3, {
      merchantKey: 'james donnelly', scheme: 'payport_faster_payments', amountMinor: -50000,
    }));
    expect(out).toHaveLength(1);
    expect(out[0].reasons).toContain('Counterparty is your own name');
  });

  test('skips anything the user already categorised by hand', () => {
    const out = run(rep(5, {
      merchantKey: 'seccl',
      scheme: 'payport_faster_payments',
      amountMinor: -50000,
      userCategoryKey: 'investment_traditional',
    }));
    expect(out).toHaveLength(0);
  });

  test('every candidate carries its reasoning and is flagged for confirmation', () => {
    const out = run(rep(6, {
      merchantKey: 'vanguard asset management', scheme: 'bacs', amountMinor: -25000,
    }));
    expect(out[0].reasons.length).toBeGreaterThan(1);
    expect(out[0].confidence).toBeGreaterThanOrEqual(0.5);
    expect(out.every((c) => c.requiresConfirmation)).toBe(true);
  });
});
