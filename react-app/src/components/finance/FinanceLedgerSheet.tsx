import React, { useCallback, useMemo, useState } from 'react';
import { Badge, Button, Form, Table } from 'react-bootstrap';

import type {
    AccountKind,
    LedgerAccount,
    LedgerPosition,
} from '../../types/finance';
import { ACCOUNT_KIND_LABELS, sideForKind, tracksReturn } from '../../types/finance';
import {
    formatPence,
    indexPositions,
    parsePenceInput,
} from '../../utils/financeLedger';
import './FinanceLedgerSheet.css';

/**
 * Accounts down the left, months across the top, two editable numbers per cell.
 *
 * Deliberately takes pure props — the page component owns the fetch. That split is
 * what makes this unit-testable and renderable without a Firebase session, which
 * matters because local dev login renders the shell but never authenticates.
 *
 * Built fresh rather than adapted: ModernPersonalListsTable binds cells to
 * item[column.key] on a flat record (our columns are dynamic months and each cell
 * holds two numbers from a second collection), and RoadmapGrid is a drag-and-drop
 * scheduling grid with no cell editing at all. The inline-edit interaction below is
 * the one thing borrowed, from ModernPersonalListsTable's editingCell pattern.
 */

export type CellField = 'valuePence' | 'contributedPence';

export interface PositionEdit {
    accountId: string;
    monthKey: string;
    field: CellField;
    valuePence: number;
}

export interface FinanceLedgerSheetProps {
    accounts: LedgerAccount[];
    positions: LedgerPosition[];
    months: string[];
    /** Called with only the cells that actually changed. */
    onCommit: (edits: PositionEdit[]) => Promise<void> | void;
    onEditAccount?: (account: LedgerAccount) => void;
    readOnly?: boolean;
    currency?: string;
}

const monthLabel = (monthKey: string): { month: string; year: string } => {
    const [year, month] = monthKey.split('-');
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
    return {
        month: date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }),
        year,
    };
};

const cellKey = (accountId: string, monthKey: string, field: CellField) => `${accountId}|${monthKey}|${field}`;

/** Investment-style accounts get a second row for cumulative contributions. */
const fieldsForKind = (kind: AccountKind): CellField[] =>
    (tracksReturn(kind) ? ['valuePence', 'contributedPence'] : ['valuePence']);

const FIELD_LABELS: Record<CellField, string> = {
    valuePence: 'Value',
    contributedPence: 'Invested',
};

const FinanceLedgerSheet: React.FC<FinanceLedgerSheetProps> = ({
    accounts,
    positions,
    months,
    onCommit,
    onEditAccount,
    readOnly = false,
    currency = 'GBP',
}) => {
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState<string>('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const positionIndex = useMemo(() => indexPositions(positions), [positions]);

    const visibleAccounts = useMemo(
        () => accounts.filter((a) => a.deleted !== true && a.archived !== true),
        [accounts],
    );

    const cellValue = useCallback((accountId: string, monthKey: string, field: CellField): number | null => {
        const position = positionIndex.get(`${accountId}|${monthKey}`);
        if (!position) return null;
        const raw = position[field];
        return Number.isFinite(Number(raw)) ? Number(raw) : null;
    }, [positionIndex]);

    const beginEdit = (accountId: string, monthKey: string, field: CellField) => {
        if (readOnly) return;
        const current = cellValue(accountId, monthKey, field);
        setEditing(cellKey(accountId, monthKey, field));
        setDraft(current === null ? '' : String(current / 100));
        setError(null);
    };

    const cancelEdit = () => {
        setEditing(null);
        setDraft('');
    };

    const commitEdit = async (accountId: string, monthKey: string, field: CellField) => {
        const parsed = parsePenceInput(draft);
        const current = cellValue(accountId, monthKey, field);

        // Blank clears the edit rather than writing 0 — zero is a real balance.
        if (parsed === null || parsed === current) {
            cancelEdit();
            return;
        }

        setSaving(true);
        setError(null);
        try {
            await onCommit([{ accountId, monthKey, field, valuePence: Math.abs(parsed) }]);
            cancelEdit();
        } catch (err) {
            setError((err as Error)?.message || 'Could not save that cell.');
        } finally {
            setSaving(false);
        }
    };

    const renderCell = (account: LedgerAccount, monthKey: string, field: CellField) => {
        const key = cellKey(account.accountId, monthKey, field);
        const position = positionIndex.get(`${account.accountId}|${monthKey}`);
        const value = cellValue(account.accountId, monthKey, field);
        const isEstimate = position?.isEstimate === true;

        if (editing === key) {
            return (
                <td key={key} className="ledger-cell ledger-cell-editing">
                    <Form.Control
                        autoFocus
                        size="sm"
                        type="text"
                        inputMode="decimal"
                        aria-label={`${account.name} ${monthKey} ${FIELD_LABELS[field]}`}
                        value={draft}
                        disabled={saving}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={() => commitEdit(account.accountId, monthKey, field)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                commitEdit(account.accountId, monthKey, field);
                            }
                            if (event.key === 'Escape') {
                                event.preventDefault();
                                cancelEdit();
                            }
                        }}
                    />
                </td>
            );
        }

        return (
            <td
                key={key}
                className={`ledger-cell${isEstimate ? ' ledger-cell-estimate' : ''}${value === null ? ' ledger-cell-empty' : ''}`}
                role={readOnly ? undefined : 'button'}
                tabIndex={readOnly ? undefined : 0}
                title={isEstimate ? 'Estimated — carried forward from an earlier month' : undefined}
                data-testid={`cell-${account.accountId}-${monthKey}-${field}`}
                onClick={() => beginEdit(account.accountId, monthKey, field)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        beginEdit(account.accountId, monthKey, field);
                    }
                }}
            >
                {value === null ? <span className="ledger-cell-placeholder">—</span> : formatPence(value, currency)}
                {isEstimate && <span className="ledger-cell-estimate-marker" aria-label="estimated">~</span>}
            </td>
        );
    };

    /** Net worth per month, so the footer reconciles with the rows above it. */
    const monthTotals = useMemo(() => months.map((monthKey) => {
        let assets = 0;
        let debts = 0;
        visibleAccounts.forEach((account) => {
            if (account.includeInNetWorth === false) return;
            const position = positionIndex.get(`${account.accountId}|${monthKey}`);
            if (!position) return;
            const magnitude = Math.abs(Number(position.valuePence) || 0);
            if (sideForKind(account.kind) === 'debt') debts += magnitude;
            else assets += magnitude;
        });
        return { monthKey, assets, debts, net: assets - debts };
    }), [months, visibleAccounts, positionIndex]);

    if (!visibleAccounts.length) {
        return (
            <div className="ledger-empty text-muted py-5 text-center">
                <p className="mb-1">No accounts yet.</p>
                <p className="mb-0 small">
                    Add your credit cards, ISAs and pensions to start tracking net worth month by month.
                </p>
            </div>
        );
    }

    return (
        <div className="ledger-sheet">
            {error && <div className="alert alert-danger py-2 small mb-2">{error}</div>}

            <div className="ledger-scroll" data-testid="ledger-scroll">
                <Table bordered hover size="sm" className="ledger-table mb-0">
                    <thead>
                        <tr>
                            <th className="ledger-label-col">Account</th>
                            {months.map((monthKey) => {
                                const { month, year } = monthLabel(monthKey);
                                return (
                                    <th key={monthKey} className="ledger-month-col text-end" scope="col">
                                        <div>{month}</div>
                                        <div className="ledger-month-year">{year}</div>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>

                    <tbody>
                        {visibleAccounts.map((account) => {
                            const fields = fieldsForKind(account.kind);
                            return fields.map((field, fieldIndex) => (
                                <tr key={`${account.accountId}-${field}`}>
                                    {fieldIndex === 0 && (
                                        <th
                                            scope="row"
                                            className="ledger-label-col"
                                            rowSpan={fields.length}
                                        >
                                            <div className="d-flex align-items-start justify-content-between gap-2">
                                                <div>
                                                    <div className="fw-semibold">{account.name}</div>
                                                    <div className="ledger-label-meta">
                                                        {ACCOUNT_KIND_LABELS[account.kind]}
                                                        {sideForKind(account.kind) === 'debt' && (
                                                            <Badge bg="danger" className="ms-1">debt</Badge>
                                                        )}
                                                        {account.apr ? (
                                                            <Badge bg="secondary" className="ms-1">{account.apr}% APR</Badge>
                                                        ) : null}
                                                    </div>
                                                </div>
                                                {onEditAccount && !readOnly && (
                                                    <Button
                                                        size="sm"
                                                        variant="link"
                                                        className="p-0 ledger-edit-link"
                                                        onClick={() => onEditAccount(account)}
                                                    >
                                                        Edit
                                                    </Button>
                                                )}
                                            </div>
                                            {fields.length > 1 && (
                                                <div className="ledger-field-legend">
                                                    {fields.map((f) => (
                                                        <div key={f} className="ledger-field-legend-item">{FIELD_LABELS[f]}</div>
                                                    ))}
                                                </div>
                                            )}
                                        </th>
                                    )}
                                    {months.map((monthKey) => renderCell(account, monthKey, field))}
                                </tr>
                            ));
                        })}
                    </tbody>

                    <tfoot>
                        <tr className="ledger-total-row">
                            <th scope="row" className="ledger-label-col">Net worth</th>
                            {monthTotals.map((total) => (
                                <td
                                    key={total.monthKey}
                                    className={`ledger-cell fw-semibold ${total.net < 0 ? 'text-danger' : ''}`}
                                    data-testid={`net-${total.monthKey}`}
                                >
                                    {formatPence(total.net, currency)}
                                </td>
                            ))}
                        </tr>
                    </tfoot>
                </Table>
            </div>

            <div className="ledger-hint text-muted small mt-2">
                Click a cell to edit. Enter saves, Escape cancels. A <span className="ledger-cell-estimate-marker">~</span> marks
                a month carried forward from an earlier balance rather than entered.
            </div>
        </div>
    );
};

export default FinanceLedgerSheet;
