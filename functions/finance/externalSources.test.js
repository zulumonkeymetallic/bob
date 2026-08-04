const {
  normalizeExternalSource,
  resolveSourceConfig,
  buildTermMatcher,
  classifyStatementRow,
  fileIsUnsigned,
  EXTERNAL_SOURCE_PRESETS,
} = require('./externalSources');

describe('normalizeExternalSource', () => {
  test('keeps the historical aliases working', () => {
    expect(normalizeExternalSource('Barclaycard')).toBe('barclays');
    expect(normalizeExternalSource('barclay')).toBe('barclays');
    expect(normalizeExternalSource('pay_pal')).toBe('paypal');
    expect(normalizeExternalSource('Halifax Credit Card')).toBe('halifax');
  });

  test('accepts an unknown provider instead of collapsing it to "other"', () => {
    // The old three-value enum sent every unregistered provider to 'other', which is why
    // Halifax had nowhere to live and two cards shared one bucket.
    expect(normalizeExternalSource('Amex Gold')).toBe('amex_gold');
    expect(normalizeExternalSource('  M&S Bank ')).toBe('m_s_bank');
  });

  test('falls back to "other" only when there is nothing to slugify', () => {
    expect(normalizeExternalSource('')).toBe('other');
    expect(normalizeExternalSource(null)).toBe('other');
    expect(normalizeExternalSource('!!!')).toBe('other');
  });
});

describe('resolveSourceConfig', () => {
  test('halifax is a first-class preset', () => {
    const config = resolveSourceConfig({ source: 'halifax' });
    expect(config.source).toBe('halifax');
    expect(config.monzoPaymentTerms).toContain('halifax');
    expect(EXTERNAL_SOURCE_PRESETS.halifax).toBeDefined();
  });

  test('a registered account supplies its own repayment terms', () => {
    const config = resolveSourceConfig({
      account: {
        accountId: 'acc-1',
        name: 'Halifax Clarity',
        provider: 'Halifax',
        externalSource: 'halifax',
        paymentMatchTerms: ['hfx clarity', 'CLARITY CARD'],
      },
    });
    expect(config.accountId).toBe('acc-1');
    expect(config.label).toBe('Halifax Clarity');
    // User terms, then the account's own identity, then the preset.
    expect(config.monzoPaymentTerms).toEqual(
      expect.arrayContaining(['hfx clarity', 'clarity card', 'halifax clarity', 'halifax']),
    );
  });

  test('an account name alone is enough to match without extra configuration', () => {
    const config = resolveSourceConfig({
      source: 'amex',
      account: { accountId: 'acc-2', name: 'Amex Platinum' },
    });
    expect(buildTermMatcher(config.monzoPaymentTerms)('CARD PAYMENT TO AMEX PLATINUM')).toBe(true);
  });

  test('paypal keeps its settlement-lag shift; card providers do not', () => {
    expect(resolveSourceConfig({ source: 'paypal' }).dateShiftDays).toBe(1);
    expect(resolveSourceConfig({ source: 'barclays' }).dateShiftDays).toBe(0);
    expect(resolveSourceConfig({ source: 'halifax' }).dateShiftDays).toBe(0);
  });

  test('an account can override the settlement lag', () => {
    const config = resolveSourceConfig({
      source: 'halifax',
      account: { accountId: 'acc-3', matchDateShiftDays: 3 },
    });
    expect(config.dateShiftDays).toBe(3);
  });
});

describe('buildTermMatcher', () => {
  test('never matches when there are no terms', () => {
    const match = buildTermMatcher([]);
    expect(match('BARCLAYCARD PAYMENT')).toBe(false);
  });

  test('treats regex metacharacters in user terms as literals', () => {
    const match = buildTermMatcher(['m&s bank (card)']);
    expect(match('PAYMENT M&S BANK (CARD)')).toBe(true);
    expect(() => buildTermMatcher(['unclosed ('])).not.toThrow();
  });

  test('ignores one-character noise terms', () => {
    const match = buildTermMatcher(['a', 'halifax']);
    expect(match('TESCO')).toBe(false);
    expect(match('HALIFAX CC')).toBe(true);
  });
});

describe('classifyStatementRow', () => {
  const config = resolveSourceConfig({ source: 'barclays' });

  test('an interest charge is interest and NOT spend', () => {
    // The original bug: three independent `if`s meant interest was added to the interest
    // total AND the spend total, inflating statement spend.
    expect(classifyStatementRow({
      amountMinor: -1250,
      description: 'INTEREST ON PURCHASES',
      config,
    })).toBe('interest');
  });

  test('a card payment is a payment, not spend', () => {
    expect(classifyStatementRow({
      amountMinor: 50000,
      description: 'PAYMENT RECEIVED - THANK YOU',
      config,
    })).toBe('payment');
  });

  test('the bare word "credit" no longer makes a purchase look like a refund', () => {
    // /credit/ used to match this and silently remove real spend from the totals.
    expect(classifyStatementRow({
      amountMinor: -4200,
      description: 'CREDIT UNION CAFE LONDON',
      config,
    })).toBe('spend');
  });

  test('a genuine refund is still a refund', () => {
    expect(classifyStatementRow({
      amountMinor: 4200,
      description: 'REFUND ASOS.COM',
      config,
    })).toBe('refund');
  });

  test('an unexplained credit is treated as money back on the card', () => {
    expect(classifyStatementRow({ amountMinor: 999, description: 'ADJUSTMENT', config })).toBe('refund');
  });

  test('an ordinary purchase is spend', () => {
    expect(classifyStatementRow({ amountMinor: -1899, description: 'TESCO STORES 3421', config })).toBe('spend');
  });

  test('every row lands in exactly one bucket', () => {
    const rows = [
      { amountMinor: -1250, description: 'INTEREST' },
      { amountMinor: 50000, description: 'PAYMENT RECEIVED' },
      { amountMinor: 4200, description: 'REFUND ASOS' },
      { amountMinor: -1899, description: 'TESCO' },
    ];
    const buckets = rows.map((row) => classifyStatementRow({ ...row, config }));
    expect(new Set(buckets).size).toBe(4);
  });
});

describe('fileIsUnsigned', () => {
  test('a signed statement is left alone', () => {
    expect(fileIsUnsigned([-1899, -4200, 50000])).toBe(false);
  });

  test('an all-positive file is treated as unsigned', () => {
    expect(fileIsUnsigned([1899, 4200, 50000])).toBe(true);
  });

  test('an empty file is not unsigned', () => {
    expect(fileIsUnsigned([])).toBe(false);
  });
});
