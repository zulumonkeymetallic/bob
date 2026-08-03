// seedAndRollForward is the part of the rollup most likely to go subtly wrong:
// it must never clobber a hand-entered figure, and it must keep the net-worth
// series continuous across months that were never filled in.
//
// Uses a hand-rolled Firestore double rather than the emulator — the emulator is
// not wired into this repo's test setup, and these rules are pure decision logic.

jest.mock('firebase-admin', () => {
    const FieldValue = { serverTimestamp: () => '__ts__', delete: () => '__delete__' };
    return {
        firestore: Object.assign(jest.fn(), { FieldValue }),
    };
});

const { seedAndRollForward } = require('./ledger');
const { monthIndexOf, monthEndISO } = require('./ledgerMath');

const UID = 'u1';

/** Minimal Firestore double: collection().where().get() plus batched writes. */
function makeDb(data) {
    const writes = [];
    const snap = (docs) => ({
        docs: docs.map((d) => ({ id: d.__id || 'id', data: () => d, exists: true })),
        size: docs.length,
    });

    const collection = (name) => {
        const rows = data[name] || [];
        const query = {
            where: () => query,
            get: async () => snap(rows),
        };
        return {
            ...query,
            doc: (id) => ({ id, __collection: name }),
        };
    };

    return {
        __writes: writes,
        collection,
        batch: () => ({
            set: (ref, payload) => writes.push({ collection: ref.__collection, id: ref.id, payload }),
            commit: async () => {},
        }),
    };
}

const account = (over) => ({
    ownerUid: UID,
    name: over.accountId,
    kind: 'savings',
    side: 'asset',
    currency: 'GBP',
    includeInNetWorth: true,
    includeInFire: true,
    autoSeedFromMonzo: false,
    ...over,
});

const position = (over) => ({
    ownerUid: UID,
    monthIndex: monthIndexOf(over.monthKey),
    monthEndISO: monthEndISO(over.monthKey),
    valuePence: 0,
    contributedPence: 0,
    gainPence: 0,
    returnPct: null,
    source: 'manual',
    confidence: 'actual',
    isEstimate: false,
    enteredBy: 'user',
    ...over,
});

const writeFor = (db, accountId) =>
    db.__writes.find((w) => w.collection === 'finance_positions' && w.id.includes(accountId));

describe('seedAndRollForward', () => {
    it('seeds a linked current account from the Monzo balance', async () => {
        const db = makeDb({
            finance_ledger_accounts: [account({
                accountId: 'a_cur', kind: 'current', autoSeedFromMonzo: true, monzoAccountId: 'acc_123',
            })],
            finance_positions: [],
            monzo_accounts: [{ ownerUid: UID, accountId: 'acc_123', balanceMinor: 248315, closed: false }],
            monzo_pots: [],
        });

        const result = await seedAndRollForward(db, UID, '2026-07');

        expect(result.seeded).toEqual(['a_cur']);
        const write = writeFor(db, 'a_cur');
        expect(write.payload.valuePence).toBe(248315);
        expect(write.payload.source).toBe('monzo_account');
        expect(write.payload.isEstimate).toBe(false);
    });

    it('seeds a pot-linked account from the pot balance, preferring the pot', async () => {
        const db = makeDb({
            finance_ledger_accounts: [account({
                accountId: 'a_pot', autoSeedFromMonzo: true, monzoPotId: 'pot_9', monzoAccountId: 'acc_123',
            })],
            finance_positions: [],
            monzo_accounts: [{ ownerUid: UID, accountId: 'acc_123', balanceMinor: 999999, closed: false }],
            monzo_pots: [{ ownerUid: UID, potId: 'pot_9', balance: 150000 }],
        });

        await seedAndRollForward(db, UID, '2026-07');
        expect(writeFor(db, 'a_pot').payload.valuePence).toBe(150000);
        expect(writeFor(db, 'a_pot').payload.source).toBe('monzo_pot');
    });

    it('never overwrites a hand-entered figure', async () => {
        const db = makeDb({
            finance_ledger_accounts: [account({
                accountId: 'a_cur', autoSeedFromMonzo: true, monzoAccountId: 'acc_123',
            })],
            finance_positions: [position({
                accountId: 'a_cur', monthKey: '2026-07', valuePence: 111111, source: 'manual',
            })],
            monzo_accounts: [{ ownerUid: UID, accountId: 'acc_123', balanceMinor: 248315, closed: false }],
            monzo_pots: [],
        });

        const result = await seedAndRollForward(db, UID, '2026-07');

        expect(result.seeded).toEqual([]);
        expect(result.rolled).toEqual([]);
        expect(db.__writes).toHaveLength(0);
    });

    it('re-seeds over a previous rollforward estimate', async () => {
        // An estimate is a placeholder; a real Monzo balance should replace it.
        const db = makeDb({
            finance_ledger_accounts: [account({
                accountId: 'a_cur', autoSeedFromMonzo: true, monzoAccountId: 'acc_123',
            })],
            finance_positions: [position({
                accountId: 'a_cur', monthKey: '2026-07', valuePence: 5, source: 'rollforward', isEstimate: true,
            })],
            monzo_accounts: [{ ownerUid: UID, accountId: 'acc_123', balanceMinor: 248315, closed: false }],
            monzo_pots: [],
        });

        await seedAndRollForward(db, UID, '2026-07');
        expect(writeFor(db, 'a_cur').payload.valuePence).toBe(248315);
        expect(writeFor(db, 'a_cur').payload.isEstimate).toBe(false);
    });

    it('carries the last known balance forward for an unfilled month', async () => {
        const db = makeDb({
            finance_ledger_accounts: [account({ accountId: 'a_isa', kind: 'isa' })],
            finance_positions: [
                position({ accountId: 'a_isa', monthKey: '2026-05', valuePence: 100000, contributedPence: 90000 }),
                position({ accountId: 'a_isa', monthKey: '2026-06', valuePence: 110000, contributedPence: 95000 }),
            ],
            monzo_accounts: [],
            monzo_pots: [],
        });

        const result = await seedAndRollForward(db, UID, '2026-07');

        expect(result.rolled).toEqual(['a_isa']);
        const write = writeFor(db, 'a_isa');
        expect(write.payload.valuePence).toBe(110000);
        expect(write.payload.contributedPence).toBe(95000);
        expect(write.payload.gainPence).toBe(15000);
        expect(write.payload.isEstimate).toBe(true);
        expect(write.payload.source).toBe('rollforward');
    });

    it('does nothing for an account with no history at all', async () => {
        const db = makeDb({
            finance_ledger_accounts: [account({ accountId: 'a_new' })],
            finance_positions: [],
            monzo_accounts: [],
            monzo_pots: [],
        });

        const result = await seedAndRollForward(db, UID, '2026-07');
        expect(result.seeded).toEqual([]);
        expect(result.rolled).toEqual([]);
    });

    it('skips archived accounts', async () => {
        const db = makeDb({
            finance_ledger_accounts: [account({ accountId: 'a_old', archived: true })],
            finance_positions: [position({ accountId: 'a_old', monthKey: '2026-06', valuePence: 500 })],
            monzo_accounts: [],
            monzo_pots: [],
        });

        const result = await seedAndRollForward(db, UID, '2026-07');
        expect(result.rolled).toEqual([]);
    });

    it('ignores a Monzo account with no balance yet synced', async () => {
        // balanceMinor is absent on accounts synced before /balance was wired in.
        const db = makeDb({
            finance_ledger_accounts: [account({
                accountId: 'a_cur', autoSeedFromMonzo: true, monzoAccountId: 'acc_123',
            })],
            finance_positions: [position({ accountId: 'a_cur', monthKey: '2026-06', valuePence: 7000 })],
            monzo_accounts: [{ ownerUid: UID, accountId: 'acc_123', closed: false }],
            monzo_pots: [],
        });

        const result = await seedAndRollForward(db, UID, '2026-07');

        // Falls back to carrying June forward rather than seeding a zero.
        expect(result.seeded).toEqual([]);
        expect(result.rolled).toEqual(['a_cur']);
        expect(writeFor(db, 'a_cur').payload.valuePence).toBe(7000);
    });

    it('ignores a closed Monzo account and a deleted pot', async () => {
        const db = makeDb({
            finance_ledger_accounts: [
                account({ accountId: 'a_closed', autoSeedFromMonzo: true, monzoAccountId: 'acc_shut' }),
                account({ accountId: 'a_gone', autoSeedFromMonzo: true, monzoPotId: 'pot_gone' }),
            ],
            finance_positions: [],
            monzo_accounts: [{ ownerUid: UID, accountId: 'acc_shut', balanceMinor: 500, closed: true }],
            monzo_pots: [{ ownerUid: UID, potId: 'pot_gone', balance: 500, deleted: true }],
        });

        const result = await seedAndRollForward(db, UID, '2026-07');
        expect(result.seeded).toEqual([]);
    });

    it('does not seed an account that has not opted in', async () => {
        const db = makeDb({
            finance_ledger_accounts: [account({
                accountId: 'a_manual', autoSeedFromMonzo: false, monzoAccountId: 'acc_123',
            })],
            finance_positions: [],
            monzo_accounts: [{ ownerUid: UID, accountId: 'acc_123', balanceMinor: 248315, closed: false }],
            monzo_pots: [],
        });

        const result = await seedAndRollForward(db, UID, '2026-07');
        expect(result.seeded).toEqual([]);
    });
});
