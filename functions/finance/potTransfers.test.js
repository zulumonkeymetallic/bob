const {
  buildPotIndex,
  normalisePotName,
  resolvePotTransfer,
  resolveTransactionCategory,
  buildCategoryIndex,
} = require('./bucketResolver');
const { buildPotFlows } = require('./dashboard');

const POTS = [
  { potId: 'pot_live_holiday', name: 'Holiday', balance: 35171, deleted: false },
  { potId: 'pot_dead_holiday', name: 'Holiday', balance: 0, deleted: true },
  { potId: 'pot_mandatory', name: 'Mandatory Expenses', balance: 102587, deleted: false },
];
const potIndex = buildPotIndex(POTS);
const categoryIndex = buildCategoryIndex([]);

describe('buildPotIndex', () => {
  test('indexes by id and by normalised name', () => {
    expect(potIndex.get('pot_live_holiday').name).toBe('Holiday');
    expect(potIndex.get('holiday').potId).toBe('pot_live_holiday');
  });

  test('a live pot beats a deleted pot of the same name', () => {
    // "Holiday" exists four times on the real account, three of them closed. Naming a
    // transfer after a dead pot loses the link to the balance that is still there.
    expect(potIndex.get('holiday').deleted).toBe(false);
  });

  test('normalisePotName strips the trailing "Pot" the CSV export appends', () => {
    expect(normalisePotName('Mandatory Expenses Pot')).toBe('mandatory expenses');
    expect(normalisePotName('  Holiday   Pot ')).toBe('holiday');
  });
});

describe('resolvePotTransfer', () => {
  test('API transfers keep working via metadata.pot_id', () => {
    const result = resolvePotTransfer(
      { metadata: { pot_id: 'pot_live_holiday' }, amountMinor: -5000 },
      potIndex,
    );
    expect(result).toMatchObject({ potId: 'pot_live_holiday', potName: 'Holiday', direction: 'to' });
  });

  test('CSV-imported transfers are detected — they carry no pot id at all', () => {
    // This is the population that was being counted as SPEND: 2,915 of 3,477 rows.
    const result = resolvePotTransfer({
      description: 'Mandatory Expenses Pot',
      metadata: { source: 'monzo_csv', csvType: 'Pot transfer' },
      amountMinor: -6000,
    }, potIndex);
    expect(result).not.toBeNull();
    expect(result.potName).toBe('Mandatory Expenses');
    expect(result.potId).toBe('pot_mandatory');
  });

  test('a raw pot id is never used as a display name when the pot is known', () => {
    const result = resolvePotTransfer({ metadata: { pot_id: 'pot_live_holiday' }, amountMinor: -100 }, potIndex);
    expect(result.potName).not.toMatch(/^pot_/);
  });

  test('an unknown pot falls back to the description, not the opaque id', () => {
    const result = resolvePotTransfer({
      description: 'Rainy Day Pot',
      metadata: { csvType: 'Pot transfer' },
      amountMinor: -2500,
    }, potIndex);
    expect(result.potName).toBe('Rainy Day');
  });

  test('direction follows the money: out of the account is INTO the pot', () => {
    const into = resolvePotTransfer({ description: 'Holiday Pot', metadata: { csvType: 'Pot transfer' }, amountMinor: -5000 }, potIndex);
    const outOf = resolvePotTransfer({ description: 'Holiday Pot', metadata: { csvType: 'Pot transfer' }, amountMinor: 5000 }, potIndex);
    expect(into.direction).toBe('to');
    expect(outOf.direction).toBe('from');
  });

  test('ordinary spend is not mistaken for a pot transfer', () => {
    expect(resolvePotTransfer({ description: 'TESCO STORES', amountMinor: -1899 }, potIndex)).toBeNull();
    expect(resolvePotTransfer({ description: 'PIZZA POT LUCK LTD', amountMinor: -2200 }, potIndex)).toBeNull();
  });

  test('works without a pot index, naming the pot from the description', () => {
    const result = resolvePotTransfer({ description: 'Holiday Pot', metadata: { csvType: 'Pot transfer' }, amountMinor: -100 }, null);
    expect(result.potName).toBe('Holiday');
  });
});

describe('resolveTransactionCategory', () => {
  test('a CSV pot transfer resolves to bank_transfer, so it is excluded from spend', () => {
    const resolved = resolveTransactionCategory({
      description: 'Holiday Pot',
      metadata: { csvType: 'Pot transfer' },
      amountMinor: -5000,
      // Left over from the sync writer; it is what used to drag these into `short_saving`.
      defaultCategoryType: 'savings',
    }, { categoryIndex, potIndex });

    expect(resolved.bucket).toBe('bank_transfer');
    expect(resolved.isPotTransfer).toBe(true);
    expect(resolved.categoryLabel).toBe('Transfer to Holiday');
  });
});

describe('buildPotFlows', () => {
  const txs = [
    { description: 'Holiday Pot', metadata: { csvType: 'Pot transfer' }, amountMinor: -10000 },
    { description: 'Holiday Pot', metadata: { csvType: 'Pot transfer' }, amountMinor: -5000 },
    { description: 'Holiday Pot', metadata: { csvType: 'Pot transfer' }, amountMinor: 2000 },
    { description: 'TESCO', amountMinor: -1899 },
  ];

  test('separates money in from money out and nets them', () => {
    const { pots } = buildPotFlows(txs, POTS, potIndex, categoryIndex);
    const holiday = pots.find((p) => p.name === 'Holiday');
    expect(holiday.inPence).toBe(15000);
    expect(holiday.outPence).toBe(2000);
    expect(holiday.netPence).toBe(13000);
    expect(holiday.transactions).toBe(3);
  });

  test('joins the live balance without rescaling it', () => {
    // monzo_pots.balance is already minor units — the classic bug is multiplying by 100.
    const { pots } = buildPotFlows(txs, POTS, potIndex, categoryIndex);
    expect(pots.find((p) => p.name === 'Holiday').balancePence).toBe(35171);
  });

  test('a pot with a balance but no movement in range still appears', () => {
    const { pots } = buildPotFlows(txs, POTS, potIndex, categoryIndex);
    const mandatory = pots.find((p) => p.name === 'Mandatory Expenses');
    expect(mandatory).toBeDefined();
    expect(mandatory.balancePence).toBe(102587);
    expect(mandatory.transactions).toBe(0);
  });

  test('closed, empty pots are left out', () => {
    const { pots } = buildPotFlows([], POTS, potIndex, categoryIndex);
    expect(pots.some((p) => p.deleted && (p.balancePence || 0) === 0)).toBe(false);
  });

  test('ordinary spend never reaches the pot rollup', () => {
    const { totals } = buildPotFlows(txs, POTS, potIndex, categoryIndex);
    expect(totals.inPence).toBe(15000);
    expect(totals.outPence).toBe(2000);
  });
});

describe('account transfers (the generic replacement for hardcoding merchants)', () => {
  const {
    buildTransferAccountIndex,
    resolveAccountTransfer,
    TRANSFER_ACCOUNT_KINDS,
  } = require('./bucketResolver');

  const ACCOUNTS = [
    { accountId: 'gia1', name: 'Fundment', kind: 'gia' },
    { accountId: 'isa1', name: 'Seccl ISA', provider: 'Seccl', kind: 'isa' },
    { accountId: 'cur1', name: 'James Donnelly', kind: 'current' },
    { accountId: 'card1', name: 'Barclaycard', kind: 'credit_card' },
    { accountId: 'gone', name: 'Old Vanguard', kind: 'gia', archived: true },
  ];
  const accountIndex = buildTransferAccountIndex(ACCOUNTS);

  test('only asset-side accounts are indexed', () => {
    expect(accountIndex.has('fundment')).toBe(true);
    expect(accountIndex.has('james donnelly')).toBe(true);
    // Paying a card down is debt servicing, not a neutral transfer.
    expect(accountIndex.has('barclaycard')).toBe(false);
    expect(TRANSFER_ACCOUNT_KINDS).not.toContain('credit_card');
  });

  test('archived accounts drop out', () => {
    expect(accountIndex.has('old vanguard')).toBe(false);
  });

  test('a contribution is excluded from spend and named', () => {
    const resolved = resolveTransactionCategory(
      { description: 'FUNDMENT LTD', amountMinor: -40000, defaultCategoryType: 'savings' },
      { categoryIndex, transferAccountIndex: accountIndex },
    );
    expect(resolved.bucket).toBe('bank_transfer');
    expect(resolved.categoryKey).toBe('account_transfer');
    expect(resolved.categoryLabel).toBe('Transfer to Fundment');
  });

  test('money coming back out is direction "from", so it nets off', () => {
    const back = resolveAccountTransfer({ description: 'FUNDMENT LTD', amountMinor: 25000 }, accountIndex);
    expect(back.direction).toBe('from');
  });

  test('the longest matching term wins', () => {
    const index = buildTransferAccountIndex([
      { accountId: 'a', name: 'Halifax', kind: 'current' },
      { accountId: 'b', name: 'Halifax Savings', kind: 'savings' },
    ]);
    expect(resolveAccountTransfer({ description: 'TFR HALIFAX SAVINGS' }, index).accountId).toBe('b');
  });

  test('a user with no registered accounts is completely unaffected', () => {
    const empty = buildTransferAccountIndex([]);
    expect(resolveAccountTransfer({ description: 'FUNDMENT LTD', amountMinor: -40000 }, empty)).toBeNull();
    const resolved = resolveTransactionCategory(
      { description: 'FUNDMENT LTD', amountMinor: -40000, defaultCategoryType: 'savings' },
      { categoryIndex, transferAccountIndex: empty },
    );
    expect(resolved.bucket).not.toBe('bank_transfer');
  });

  test('buildPotFlows nets withdrawals off contributions per platform', () => {
    const txs = [
      { description: 'FUNDMENT LTD', amountMinor: -40000 },
      { description: 'FUNDMENT LTD', amountMinor: -20000 },
      { description: 'FUNDMENT LTD', amountMinor: 15000 },
    ];
    const { accounts, accountTotals } = buildPotFlows(txs, [], potIndex, categoryIndex, accountIndex);
    const fundment = accounts.find((a) => a.name === 'Fundment');
    expect(fundment.inPence).toBe(60000);
    expect(fundment.outPence).toBe(15000);
    expect(fundment.netPence).toBe(45000);
    expect(accountTotals.netPence).toBe(45000);
  });
});

describe('saving is not spending', () => {
  const { aggregateTransactions } = require('./dashboard');
  const { DEFAULT_FINANCE_CATEGORIES } = require('./categories');

  // The real catalogue, not the empty index the pot tests use: these assertions are about
  // category KEYS resolving to buckets, which needs the catalogue present.
  const fullIndex = buildCategoryIndex(DEFAULT_FINANCE_CATEGORIES);
  const agg = (txs) => aggregateTransactions(txs, null, null, fullIndex, potIndex);

  test('investment and savings outflows leave totalSpend and land in totalSaved', () => {
    // These arrive already hand-categorised, so the classification was never wrong —
    // only totalSpend, which excluded income buckets but not saving ones.
    const result = agg([
      { userCategoryKey: 'investment_traditional', amountMinor: -100000, createdISO: '2026-07-01T00:00:00Z' },
      { description: 'TESCO', amountMinor: -1899, createdISO: '2026-07-02T00:00:00Z' },
    ]);
    expect(Math.abs(result.totalSpend)).toBe(1899);
    expect(Math.abs(result.totalSaved)).toBe(100000);
  });

  test('income is still excluded from both', () => {
    const result = agg([
      { userCategoryKey: 'salary', amountMinor: 500000, createdISO: '2026-07-01T00:00:00Z' },
    ]);
    expect(result.totalSpend).toBe(0);
    expect(result.totalSaved).toBe(0);
  });

  test('saved money is broken down by bucket', () => {
    const result = agg([
      { userCategoryKey: 'investment_traditional', amountMinor: -50000, createdISO: '2026-07-01T00:00:00Z' },
    ]);
    expect(Object.keys(result.savedByBucket)).toContain('investment');
  });
});
