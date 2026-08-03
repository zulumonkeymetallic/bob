import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import FinanceLedgerSheet from './FinanceLedgerSheet';
import { DEMO_ACCOUNTS, DEMO_MONTHS, DEMO_POSITIONS } from './ledgerFixture';

// The sheet takes pure props, so it needs none of the usual firebase/router/context
// mock stack that SprintTriageTable.test.tsx has to set up. That is the payoff of
// keeping the fetch in FinanceLedgerPage.

const renderSheet = (props: Partial<React.ComponentProps<typeof FinanceLedgerSheet>> = {}) => {
    const onCommit = jest.fn().mockResolvedValue(undefined);
    const utils = render(
        <FinanceLedgerSheet
            accounts={DEMO_ACCOUNTS}
            positions={DEMO_POSITIONS}
            months={DEMO_MONTHS}
            onCommit={onCommit}
            {...props}
        />,
    );
    return { ...utils, onCommit };
};

describe('FinanceLedgerSheet', () => {
    it('renders every month as a column, in ascending order', () => {
        renderSheet();
        const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);

        // First column is the account label; the rest are months.
        expect(headers[0]).toBe('Account');
        expect(headers[1]).toContain('Mar');
        expect(headers[1]).toContain('2026');
        expect(headers[headers.length - 1]).toContain('Aug');
    });

    it('renders one row per account, plus a contributions row for investments', () => {
        renderSheet();

        // Plum ISA tracks return, so it gets both a Value and an Invested row.
        expect(screen.getByTestId('cell-acc_isa-2026-03-valuePence')).toBeInTheDocument();
        expect(screen.getByTestId('cell-acc_isa-2026-03-contributedPence')).toBeInTheDocument();

        // A current account has no contributions concept.
        expect(screen.getByTestId('cell-acc_current-2026-03-valuePence')).toBeInTheDocument();
        expect(screen.queryByTestId('cell-acc_current-2026-03-contributedPence')).not.toBeInTheDocument();
    });

    it('formats cell values as currency', () => {
        renderSheet();
        expect(screen.getByTestId('cell-acc_current-2026-03-valuePence')).toHaveTextContent('£2,400');
    });

    it('subtracts debts from assets in the net worth footer', () => {
        const accounts = DEMO_ACCOUNTS.filter((a) => ['acc_current', 'acc_card'].includes(a.accountId));
        const positions = DEMO_POSITIONS.filter(
            (p) => ['acc_current', 'acc_card'].includes(p.accountId) && p.monthKey === '2026-03',
        );

        renderSheet({ accounts, positions, months: ['2026-03'] });

        // Current £2,400 − Barclaycard £4,120 = −£1,720.
        expect(screen.getByTestId('net-2026-03')).toHaveTextContent('-£1,720');
    });

    it('marks a carried-forward month as an estimate', () => {
        renderSheet();
        // The pension has no entered balance for the last two months.
        const estimated = screen.getByTestId('cell-acc_pension-2026-08-valuePence');
        expect(estimated).toHaveClass('ledger-cell-estimate');
        expect(estimated).toHaveAttribute(
            'title',
            'Estimated — carried forward from an earlier month',
        );
    });

    it('commits an edited cell with the parsed pence value', async () => {
        const { onCommit } = renderSheet();

        fireEvent.click(screen.getByTestId('cell-acc_current-2026-03-valuePence'));
        const input = screen.getByLabelText('Monzo Current 2026-03 Value');
        fireEvent.change(input, { target: { value: '£3,250.50' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
        expect(onCommit).toHaveBeenCalledWith([{
            accountId: 'acc_current',
            monthKey: '2026-03',
            field: 'valuePence',
            valuePence: 325050,
        }]);
    });

    it('does not commit when the value is unchanged', async () => {
        const { onCommit } = renderSheet();

        fireEvent.click(screen.getByTestId('cell-acc_current-2026-03-valuePence'));
        const input = screen.getByLabelText('Monzo Current 2026-03 Value');
        fireEvent.blur(input);

        await waitFor(() => expect(screen.queryByLabelText('Monzo Current 2026-03 Value')).not.toBeInTheDocument());
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('does not write 0 when the cell is cleared', async () => {
        // Zero is a real balance, so a blank must cancel rather than zero the cell.
        const { onCommit } = renderSheet();

        fireEvent.click(screen.getByTestId('cell-acc_current-2026-03-valuePence'));
        const input = screen.getByLabelText('Monzo Current 2026-03 Value');
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        await waitFor(() => expect(screen.queryByLabelText('Monzo Current 2026-03 Value')).not.toBeInTheDocument());
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('abandons the edit on Escape', async () => {
        const { onCommit } = renderSheet();

        fireEvent.click(screen.getByTestId('cell-acc_current-2026-03-valuePence'));
        const input = screen.getByLabelText('Monzo Current 2026-03 Value');
        fireEvent.change(input, { target: { value: '9999' } });
        fireEvent.keyDown(input, { key: 'Escape' });

        await waitFor(() => expect(screen.queryByLabelText('Monzo Current 2026-03 Value')).not.toBeInTheDocument());
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('surfaces a save failure instead of silently dropping the edit', async () => {
        const onCommit = jest.fn().mockRejectedValue(new Error('Permission denied'));
        renderSheet({ onCommit });

        fireEvent.click(screen.getByTestId('cell-acc_current-2026-03-valuePence'));
        const input = screen.getByLabelText('Monzo Current 2026-03 Value');
        fireEvent.change(input, { target: { value: '5000' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    });

    it('does not open an editor when read only', () => {
        renderSheet({ readOnly: true });

        fireEvent.click(screen.getByTestId('cell-acc_current-2026-03-valuePence'));
        expect(screen.queryByLabelText('Monzo Current 2026-03 Value')).not.toBeInTheDocument();
    });

    it('shows the APR on a debt account', () => {
        renderSheet();
        expect(screen.getByText('22.9% APR')).toBeInTheDocument();
    });

    it('hides archived and soft-deleted accounts', () => {
        const accounts = [
            ...DEMO_ACCOUNTS.filter((a) => a.accountId === 'acc_current'),
            { ...DEMO_ACCOUNTS[1], accountId: 'acc_gone', name: 'Closed ISA', deleted: true },
            { ...DEMO_ACCOUNTS[2], accountId: 'acc_old', name: 'Old GIA', archived: true },
        ];
        renderSheet({ accounts });

        expect(screen.getByText('Monzo Current')).toBeInTheDocument();
        expect(screen.queryByText('Closed ISA')).not.toBeInTheDocument();
        expect(screen.queryByText('Old GIA')).not.toBeInTheDocument();
    });

    it('prompts to add accounts when the register is empty', () => {
        renderSheet({ accounts: [], positions: [] });
        expect(screen.getByText('No accounts yet.')).toBeInTheDocument();
    });
});
