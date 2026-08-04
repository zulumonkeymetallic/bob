import React, { useEffect, useState } from 'react';
import { Alert, Button, Col, Form, Modal, Row } from 'react-bootstrap';

import type { AccountKind, LedgerAccount } from '../../types/finance';
import { ACCOUNT_KIND_LABELS, sideForKind, tracksReturn } from '../../types/finance';
import { parsePenceInput } from '../../utils/financeLedger';

/** The register form. Debt terms only appear for debts; that is the point of `kind`. */

export interface LedgerAccountDraft {
    accountId?: string;
    name: string;
    provider: string | null;
    kind: AccountKind;
    apr: number | null;
    creditLimitPence: number | null;
    minPaymentPence: number | null;
    statementDay: number | null;
    monthlyContributionPence: number | null;
    employerContributionPence: number | null;
    includeInNetWorth: boolean;
    includeInFire: boolean;
    autoSeedFromMonzo: boolean;
    /**
     * Words that identify this account in a Monzo description ("fundment", "hlam ltd").
     * Transfers matching one stop counting as spend and are tracked in/out against this
     * account instead. Provider behaviour is data, not code — this is the field that makes
     * a new bank or platform work without a release.
     */
    paymentMatchTerms: string[];
    notes: string | null;
}

interface Props {
    show: boolean;
    account: LedgerAccount | null;
    saving?: boolean;
    onClose: () => void;
    onSave: (draft: LedgerAccountDraft) => Promise<void> | void;
    onDelete?: (account: LedgerAccount) => Promise<void> | void;
}

const KIND_OPTIONS = Object.keys(ACCOUNT_KIND_LABELS) as AccountKind[];

const emptyDraft = (): LedgerAccountDraft => ({
    name: '',
    provider: null,
    kind: 'savings',
    apr: null,
    creditLimitPence: null,
    minPaymentPence: null,
    statementDay: null,
    monthlyContributionPence: null,
    employerContributionPence: null,
    includeInNetWorth: true,
    includeInFire: true,
    autoSeedFromMonzo: false,
    paymentMatchTerms: [],
    notes: null,
});

const penceToInput = (pence: number | null | undefined): string =>
    (pence === null || pence === undefined ? '' : String(pence / 100));

const LedgerAccountForm: React.FC<Props> = ({ show, account, saving = false, onClose, onSave, onDelete }) => {
    const [draft, setDraft] = useState<LedgerAccountDraft>(emptyDraft);
    const [aprText, setAprText] = useState('');
    const [creditLimitText, setCreditLimitText] = useState('');
    const [minPaymentText, setMinPaymentText] = useState('');
    const [contributionText, setContributionText] = useState('');
    const [employerText, setEmployerText] = useState('');
    const [matchTermsText, setMatchTermsText] = useState('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!show) return;
        if (account) {
            setDraft({
                accountId: account.accountId,
                name: account.name,
                provider: account.provider ?? null,
                kind: account.kind,
                apr: account.apr ?? null,
                creditLimitPence: account.creditLimitPence ?? null,
                minPaymentPence: account.minPaymentPence ?? null,
                statementDay: account.statementDay ?? null,
                monthlyContributionPence: account.monthlyContributionPence ?? null,
                employerContributionPence: account.employerContributionPence ?? null,
                includeInNetWorth: account.includeInNetWorth !== false,
                includeInFire: account.includeInFire !== false,
                autoSeedFromMonzo: account.autoSeedFromMonzo === true,
                paymentMatchTerms: Array.isArray(account.paymentMatchTerms) ? account.paymentMatchTerms : [],
                notes: account.notes ?? null,
            });
            setMatchTermsText((account.paymentMatchTerms || []).join(', '));
            setAprText(account.apr === null || account.apr === undefined ? '' : String(account.apr));
            setCreditLimitText(penceToInput(account.creditLimitPence));
            setMinPaymentText(penceToInput(account.minPaymentPence));
            setContributionText(penceToInput(account.monthlyContributionPence));
            setEmployerText(penceToInput(account.employerContributionPence));
        } else {
            setDraft(emptyDraft());
            setMatchTermsText('');
            setAprText('');
            setCreditLimitText('');
            setMinPaymentText('');
            setContributionText('');
            setEmployerText('');
        }
        setError(null);
    }, [show, account]);

    const isDebt = sideForKind(draft.kind) === 'debt';
    const isInvestment = tracksReturn(draft.kind);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!draft.name.trim()) {
            setError('Give the account a name.');
            return;
        }

        const aprValue = aprText.trim() === '' ? null : Number(aprText);
        if (aprValue !== null && (!Number.isFinite(aprValue) || aprValue < 0)) {
            setError('APR must be a positive number, e.g. 22.9');
            return;
        }

        try {
            await onSave({
                ...draft,
                name: draft.name.trim(),
                apr: aprValue,
                creditLimitPence: parsePenceInput(creditLimitText),
                minPaymentPence: parsePenceInput(minPaymentText),
                monthlyContributionPence: parsePenceInput(contributionText),
                employerContributionPence: parsePenceInput(employerText),
                paymentMatchTerms: matchTermsText
                    .split(',')
                    .map((term) => term.trim())
                    .filter((term) => term.length >= 2),
            });
        } catch (err) {
            setError((err as Error)?.message || 'Could not save the account.');
        }
    };

    return (
        <Modal show={show} onHide={onClose} size="lg" centered>
            <Form onSubmit={submit}>
                <Modal.Header closeButton>
                    <Modal.Title>{account ? 'Edit account' : 'Add account'}</Modal.Title>
                </Modal.Header>

                <Modal.Body>
                    {error && <Alert variant="danger" className="py-2 small">{error}</Alert>}

                    <Row className="g-3">
                        <Col md={6}>
                            <Form.Label>Name</Form.Label>
                            <Form.Control
                                value={draft.name}
                                placeholder="e.g. Plum ISA"
                                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                            />
                        </Col>
                        <Col md={6}>
                            <Form.Label>Provider</Form.Label>
                            <Form.Control
                                value={draft.provider ?? ''}
                                placeholder="e.g. Hargreaves Lansdown"
                                onChange={(e) => setDraft({ ...draft, provider: e.target.value || null })}
                            />
                        </Col>
                        <Col md={6}>
                            <Form.Label>Type</Form.Label>
                            <Form.Select
                                value={draft.kind}
                                onChange={(e) => {
                                    const kind = e.target.value as AccountKind;
                                    setDraft({
                                        ...draft,
                                        kind,
                                        // Property is not drawable at 4% a year, so it defaults out of FIRE.
                                        includeInFire: kind === 'property' ? false : draft.includeInFire,
                                    });
                                }}
                            >
                                {KIND_OPTIONS.map((kind) => (
                                    <option key={kind} value={kind}>{ACCOUNT_KIND_LABELS[kind]}</option>
                                ))}
                            </Form.Select>
                            <Form.Text muted>
                                {isDebt ? 'Counts against net worth.' : 'Counts towards net worth.'}
                            </Form.Text>
                        </Col>

                        {isDebt && (
                            <>
                                <Col md={3}>
                                    <Form.Label>APR %</Form.Label>
                                    <Form.Control
                                        inputMode="decimal"
                                        value={aprText}
                                        placeholder="22.9"
                                        onChange={(e) => setAprText(e.target.value)}
                                    />
                                </Col>
                                <Col md={3}>
                                    <Form.Label>Statement day</Form.Label>
                                    <Form.Control
                                        type="number"
                                        min={1}
                                        max={28}
                                        value={draft.statementDay ?? ''}
                                        onChange={(e) => setDraft({
                                            ...draft,
                                            statementDay: e.target.value === '' ? null : Number(e.target.value),
                                        })}
                                    />
                                </Col>
                                <Col md={3}>
                                    <Form.Label>Credit limit (£)</Form.Label>
                                    <Form.Control
                                        inputMode="decimal"
                                        value={creditLimitText}
                                        onChange={(e) => setCreditLimitText(e.target.value)}
                                    />
                                </Col>
                                <Col md={3}>
                                    <Form.Label>Minimum payment (£)</Form.Label>
                                    <Form.Control
                                        inputMode="decimal"
                                        value={minPaymentText}
                                        onChange={(e) => setMinPaymentText(e.target.value)}
                                    />
                                </Col>
                            </>
                        )}

                        {isInvestment && (
                            <>
                                <Col md={3}>
                                    <Form.Label>Your monthly contribution (£)</Form.Label>
                                    <Form.Control
                                        inputMode="decimal"
                                        value={contributionText}
                                        onChange={(e) => setContributionText(e.target.value)}
                                    />
                                </Col>
                                <Col md={3}>
                                    <Form.Label>Employer monthly (£)</Form.Label>
                                    <Form.Control
                                        inputMode="decimal"
                                        value={employerText}
                                        onChange={(e) => setEmployerText(e.target.value)}
                                    />
                                </Col>
                            </>
                        )}

                        <Col md={12}>
                            <Form.Label>Matches in Monzo</Form.Label>
                            <Form.Control
                                type="text"
                                value={matchTermsText}
                                placeholder={isDebt ? 'e.g. barclaycard, barclays' : 'e.g. fundment, hlam ltd'}
                                onChange={(e) => setMatchTermsText(e.target.value)}
                            />
                            <Form.Text className="text-muted">
                                {isDebt
                                    ? 'Words that identify this card’s repayment in Monzo. Used to separate interest from principal.'
                                    : 'Words that identify transfers to this account in Monzo. Matching transfers stop counting as spend and are tracked in and out here instead.'}
                                {' '}The account name and provider are always matched too — only add terms when Monzo names it differently.
                            </Form.Text>
                        </Col>

                        <Col md={12}>
                            <Form.Label>Notes</Form.Label>
                            <Form.Control
                                as="textarea"
                                rows={2}
                                value={draft.notes ?? ''}
                                onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })}
                            />
                        </Col>

                        <Col md={12} className="d-flex flex-wrap gap-4">
                            <Form.Check
                                type="switch"
                                id="ledger-include-networth"
                                label="Include in net worth"
                                checked={draft.includeInNetWorth}
                                onChange={(e) => setDraft({ ...draft, includeInNetWorth: e.target.checked })}
                            />
                            <Form.Check
                                type="switch"
                                id="ledger-include-fire"
                                label="Include in FIRE"
                                checked={draft.includeInFire}
                                onChange={(e) => setDraft({ ...draft, includeInFire: e.target.checked })}
                            />
                            <Form.Check
                                type="switch"
                                id="ledger-autoseed"
                                label="Fill monthly from Monzo"
                                checked={draft.autoSeedFromMonzo}
                                onChange={(e) => setDraft({ ...draft, autoSeedFromMonzo: e.target.checked })}
                            />
                        </Col>
                    </Row>
                </Modal.Body>

                <Modal.Footer className="d-flex justify-content-between">
                    <div>
                        {account && onDelete && (
                            <Button variant="outline-danger" onClick={() => onDelete(account)} disabled={saving}>
                                Archive
                            </Button>
                        )}
                    </div>
                    <div className="d-flex gap-2">
                        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
                        <Button type="submit" variant="primary" disabled={saving}>
                            {saving ? 'Saving…' : 'Save'}
                        </Button>
                    </div>
                </Modal.Footer>
            </Form>
        </Modal>
    );
};

export default LedgerAccountForm;
