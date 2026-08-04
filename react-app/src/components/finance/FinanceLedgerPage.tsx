import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, ButtonGroup, Card, Spinner } from 'react-bootstrap';
import { useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import type { FinanceLedgerPayload, LedgerAccount } from '../../types/finance';
import { formatPence, monthKeyFromDate, monthIndexOf, monthKeyFromIndex } from '../../utils/financeLedger';
import FinanceLedgerSheet, { PositionEdit } from './FinanceLedgerSheet';
import LedgerAccountForm, { LedgerAccountDraft } from './LedgerAccountForm';
import { DEMO_LEDGER } from './ledgerFixture';

/**
 * Owns the data for /finance/ledger. The sheet itself takes pure props, which is
 * what lets it be unit-tested and rendered via ?demo=1 without a Firebase session.
 */

type LedgerTab = 'sheet' | 'networth';

const TABS: Array<{ key: LedgerTab; label: string }> = [
    { key: 'sheet', label: 'Monthly sheet' },
    { key: 'networth', label: 'Net worth' },
];

const MONTH_WINDOW = 12;

const FinanceLedgerPage: React.FC = () => {
    const { currentUser } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();

    const isDemo = searchParams.get('demo') === '1';
    const tab = (TABS.find((t) => t.key === searchParams.get('tab'))?.key || 'sheet') as LedgerTab;

    const [ledger, setLedger] = useState<FinanceLedgerPayload | null>(isDemo ? DEMO_LEDGER : null);
    const [loading, setLoading] = useState(!isDemo);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [formAccount, setFormAccount] = useState<LedgerAccount | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    /**
     * Counterparties that look like the user's own accounts. Advisory only — nothing changes
     * until one is saved as an account, because a wrong one would delete real spend from the
     * totals rather than merely mislabel it.
     */
    const [suggestions, setSuggestions] = useState<any[]>([]);
    const [suggestBusy, setSuggestBusy] = useState(false);
    const [suggestRun, setSuggestRun] = useState(false);

    const toMonth = monthKeyFromDate(new Date());
    const fromMonth = monthKeyFromIndex(monthIndexOf(toMonth) - (MONTH_WINDOW - 1));

    const loadSuggestions = useCallback(async () => {
        if (isDemo) return;
        setSuggestBusy(true);
        try {
            const fn = httpsCallable(functions, 'suggestFinanceTransferAccounts');
            const res: any = await fn({});
            setSuggestions(res?.data?.suggestions || []);
        } catch {
            setSuggestions([]);
        } finally {
            setSuggestBusy(false);
            setSuggestRun(true);
        }
    }, [isDemo]);

    const dismissSuggestion = useCallback(async (key: string) => {
        setSuggestions((prev) => prev.filter((item) => item.key !== key));
        try {
            await httpsCallable(functions, 'dismissFinanceTransferSuggestion')({ key });
        } catch {
            // A failed tombstone only means it reappears next load; do not block the UI.
        }
    }, []);

    const load = useCallback(async () => {
        if (isDemo) {
            setLedger(DEMO_LEDGER);
            setLoading(false);
            return;
        }
        if (!currentUser) return;

        setLoading(true);
        setError(null);
        try {
            const call = httpsCallable(functions, 'fetchFinanceLedger');
            const result: any = await call({ fromMonth, toMonth });
            setLedger(result?.data as FinanceLedgerPayload);
        } catch (err) {
            setError((err as Error)?.message || 'Could not load the ledger.');
        } finally {
            setLoading(false);
        }
    }, [currentUser, fromMonth, toMonth, isDemo]);

    useEffect(() => { load(); }, [load]);

    const setTab = (next: LedgerTab) => {
        const params = new URLSearchParams(searchParams);
        params.set('tab', next);
        setSearchParams(params, { replace: true });
    };

    const commitEdits = useCallback(async (edits: PositionEdit[]) => {
        if (isDemo) {
            // Keep the demo interactive without writing anything.
            setLedger((current) => {
                if (!current) return current;
                const positions = [...current.positions];
                edits.forEach((edit) => {
                    const i = positions.findIndex(
                        (p) => p.accountId === edit.accountId && p.monthKey === edit.monthKey,
                    );
                    if (i >= 0) positions[i] = { ...positions[i], [edit.field]: edit.valuePence, isEstimate: false };
                });
                return { ...current, positions };
            });
            return;
        }

        const call = httpsCallable(functions, 'upsertFinancePositions');
        await call({
            rows: edits.map((edit) => ({
                accountId: edit.accountId,
                monthKey: edit.monthKey,
                [edit.field]: edit.valuePence,
                source: 'manual',
            })),
        });
        await load();
    }, [isDemo, load]);

    const saveAccount = async (draft: LedgerAccountDraft) => {
        setSaving(true);
        try {
            const call = httpsCallable(functions, 'upsertFinanceLedgerAccount');
            await call(draft);
            setShowForm(false);
            setFormAccount(null);
            await load();
        } finally {
            setSaving(false);
        }
    };

    const archiveAccount = async (account: LedgerAccount) => {
        setSaving(true);
        try {
            const call = httpsCallable(functions, 'deleteFinanceLedgerAccount');
            await call({ accountId: account.accountId });
            setShowForm(false);
            setFormAccount(null);
            await load();
        } finally {
            setSaving(false);
        }
    };

    const runMigration = async () => {
        setSaving(true);
        setNotice(null);
        try {
            const call = httpsCallable(functions, 'migrateManualAccountsToLedger');
            const result: any = await call({});
            const created = result?.data?.created?.length || 0;
            const skipped = result?.data?.skipped?.length || 0;
            setNotice(`Imported ${created} account${created === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} already imported` : ''}.`);
            await load();
        } catch (err) {
            setError((err as Error)?.message || 'Migration failed.');
        } finally {
            setSaving(false);
        }
    };

    const latestNetWorth = useMemo(() => {
        if (!ledger?.netWorthHistory?.length) return null;
        return ledger.netWorthHistory[ledger.netWorthHistory.length - 1];
    }, [ledger]);

    const legacyPending = (ledger?.legacyManualAccountCount || 0) + (ledger?.legacyDebtCount || 0);

    if (!currentUser && !isDemo) {
        return (
            <div className="container py-4">
                <Alert variant="info">Sign in to see your ledger.</Alert>
            </div>
        );
    }

    return (
        <div className="container-fluid py-4">
            <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
                <div>
                    <h2 className="fw-bold mb-1">Ledger</h2>
                    <div className="text-muted">
                        Balances month by month — debts with APR, investments with what you put in versus what it is worth.
                        {isDemo && <Badge bg="warning" text="dark" className="ms-2">Demo data</Badge>}
                    </div>
                </div>

                <div className="d-flex flex-wrap gap-2 align-items-center">
                    <ButtonGroup>
                        {TABS.map((t) => (
                            <Button
                                key={t.key}
                                variant={tab === t.key ? 'primary' : 'outline-secondary'}
                                onClick={() => setTab(t.key)}
                            >
                                {t.label}
                            </Button>
                        ))}
                    </ButtonGroup>
                    <Button
                        variant="primary"
                        onClick={() => { setFormAccount(null); setShowForm(true); }}
                        disabled={isDemo}
                    >
                        Add account
                    </Button>
                </div>
            </div>

            {error && <Alert variant="danger" onClose={() => setError(null)} dismissible>{error}</Alert>}
            {notice && <Alert variant="success" onClose={() => setNotice(null)} dismissible>{notice}</Alert>}

            {!isDemo && legacyPending > 0 && (
                <Alert variant="info" className="d-flex flex-wrap justify-content-between align-items-center gap-2">
                    <span>
                        {legacyPending} account{legacyPending === 1 ? '' : 's'} from the old assets register and budget
                        settings can be imported. Your existing records are left untouched.
                    </span>
                    <Button size="sm" variant="outline-primary" onClick={runMigration} disabled={saving}>
                        Import them
                    </Button>
                </Alert>
            )}

            {!suggestRun && (
                <div className="mb-3 d-flex align-items-center gap-2 flex-wrap">
                    <Button size="sm" variant="outline-primary" onClick={loadSuggestions} disabled={suggestBusy}>
                        {suggestBusy ? 'Scanning…' : 'Find accounts of mine in my transactions'}
                    </Button>
                    <span className="small text-muted">
                        Reads your full transaction history, so it is on request rather than on every visit.
                    </span>
                </div>
            )}

            {suggestRun && suggestions.length === 0 && (
                <Alert variant="secondary" className="py-2 small">
                    No unregistered accounts of yours found in your transactions.
                </Alert>
            )}

            {suggestions.length > 0 && (
                <Card className="mb-3 border-primary-subtle">
                    <Card.Body>
                        <div className="d-flex justify-content-between align-items-start mb-2 gap-2 flex-wrap">
                            <div>
                                <div className="fw-semibold">Possible accounts of yours</div>
                                <div className="small text-muted">
                                    Money regularly leaving for these looks like a transfer, not spending.
                                    Adding one stops it counting as spend and tracks it in and out instead.
                                    Nothing changes until you add it.
                                </div>
                            </div>
                            {suggestBusy && <Spinner animation="border" size="sm" />}
                        </div>

                        {suggestions.map((item) => (
                            <div key={item.key} className="d-flex justify-content-between align-items-start gap-3 border-top py-2 flex-wrap">
                                <div className="flex-grow-1">
                                    <div className="fw-semibold">
                                        {item.name}{' '}
                                        <Badge bg="light" text="dark" className="border fw-normal">
                                            {Math.round(Number(item.confidence || 0) * 100)}% confident
                                        </Badge>
                                    </div>
                                    <div className="small text-muted">
                                        {formatPence(item.outPence)} out over {item.outCount} payment{item.outCount === 1 ? '' : 's'}
                                        {item.inCount > 0 && <> · {formatPence(item.inPence)} back in</>}
                                    </div>
                                    <ul className="small text-muted mb-0 mt-1 ps-3">
                                        {(item.reasons || []).map((reason: string) => (
                                            <li key={reason}>{reason}</li>
                                        ))}
                                    </ul>
                                </div>
                                <div className="d-flex gap-2">
                                    <Button
                                        size="sm"
                                        variant="primary"
                                        onClick={() => {
                                            // Pre-fill the register form rather than writing directly: the
                                            // kind and the match terms are the user's call, not a guess.
                                            setFormAccount({
                                                name: item.name,
                                                kind: item.suggestedKind,
                                                paymentMatchTerms: item.suggestedTerms || [item.key],
                                            } as any);
                                            setShowForm(true);
                                        }}
                                    >
                                        Add as account
                                    </Button>
                                    <Button size="sm" variant="outline-secondary" onClick={() => dismissSuggestion(item.key)}>
                                        Not mine
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </Card.Body>
                </Card>
            )}

            {loading ? (
                <div className="text-center py-5"><Spinner animation="border" /></div>
            ) : tab === 'sheet' ? (
                <FinanceLedgerSheet
                    accounts={ledger?.accounts || []}
                    positions={ledger?.positions || []}
                    months={ledger?.months || []}
                    onCommit={commitEdits}
                    onEditAccount={(account) => { setFormAccount(account); setShowForm(true); }}
                    readOnly={false}
                />
            ) : (
                <Card>
                    <Card.Body>
                        {latestNetWorth ? (
                            <div className="d-flex flex-wrap gap-4">
                                <div>
                                    <div className="text-muted small">Net worth ({latestNetWorth.monthKey})</div>
                                    <div className="fs-3 fw-bold">{formatPence(latestNetWorth.netWorthPence)}</div>
                                </div>
                                <div>
                                    <div className="text-muted small">Assets</div>
                                    <div className="fs-5">{formatPence(latestNetWorth.totalAssetPence)}</div>
                                </div>
                                <div>
                                    <div className="text-muted small">Debts</div>
                                    <div className="fs-5 text-danger">{formatPence(latestNetWorth.totalDebtPence)}</div>
                                </div>
                                {latestNetWorth.fireNumberPence ? (
                                    <div>
                                        <div className="text-muted small">FIRE progress</div>
                                        <div className="fs-5">
                                            {(latestNetWorth.fireProgressPct || 0).toFixed(1)}% of {formatPence(latestNetWorth.fireNumberPence)}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        ) : (
                            <div className="text-muted">
                                No net-worth history yet. It is written by the monthly rollup once the sheet has balances in it.
                            </div>
                        )}
                    </Card.Body>
                </Card>
            )}

            <LedgerAccountForm
                show={showForm}
                account={formAccount}
                saving={saving}
                onClose={() => { setShowForm(false); setFormAccount(null); }}
                onSave={saveAccount}
                onDelete={archiveAccount}
            />
        </div>
    );
};

export default FinanceLedgerPage;
