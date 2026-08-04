import React from 'react';
import { render, screen } from '@testing-library/react';

import IncomeFlowSankey, { FinanceFlow } from './IncomeFlowSankey';
import { BUCKET_COLORS } from '../../utils/financeCategories';

// ECharts does not render in jsdom; mock it and assert on the serialised option.
jest.mock('echarts-for-react', () => ({
    __esModule: true,
    default: (props: any) => <div data-testid="echart" data-option={JSON.stringify(props.option)} />,
}));

const readSeries = () => JSON.parse(screen.getByTestId('echart').getAttribute('data-option') || '{}').series[0];
const linkNames = () => readSeries().links.map((l: any) => `${l.source}>${l.target}`);

const flow: FinanceFlow = {
    income: [
        { key: 'net_salary', label: 'Net Salary', pence: 508400 },
        { key: 'side_gig', label: 'Side Gig', pence: 120000 },
        { key: 'interest', label: 'Interest', pence: 2500 },
    ],
    outflow: [
        { bucket: 'mandatory', categoryKey: 'mortgage', categoryLabel: 'Mortgage', pence: 110000 },
        { bucket: 'mandatory', categoryKey: 'groceries', categoryLabel: 'Groceries', pence: 40000 },
        { bucket: 'discretionary', categoryKey: 'eating_out', categoryLabel: 'Eating Out', pence: 25000 },
        { bucket: 'discretionary', categoryKey: 'coffee', categoryLabel: 'Coffee', pence: 200 },
    ],
    pots: [
        { name: 'Tax Pot', pence: 200000 },
        { name: 'Emergency Fund', pence: 50000 },
    ],
    totals: {
        incomePence: 630900,
        outflowPence: 175200,
        potTransferPence: 250000,
        unallocatedPence: 205700,
    },
};

describe('IncomeFlowSankey', () => {
    it('flows every income source into the take-home hub', () => {
        render(<IncomeFlowSankey flow={flow} />);
        const links = linkNames();
        expect(links).toContain('Net Salary>Take-home');
        expect(links).toContain('Side Gig>Take-home');
        expect(links).toContain('Interest>Take-home');
    });

    it('flows the hub out to buckets, then buckets to categories', () => {
        render(<IncomeFlowSankey flow={flow} />);
        const links = linkNames();
        // Bucket nodes carry a trailing space to stay distinct from categories.
        expect(links).toContain('Take-home>Mandatory Expenses ');
        expect(links).toContain('Mandatory Expenses >Mortgage');
        expect(links).toContain('Discretionary Expenses >Eating Out');
    });

    it('shows pot transfers as a destination rather than dropping them', () => {
        // The old diagram excluded bank_transfer entirely, so saving was invisible.
        render(<IncomeFlowSankey flow={flow} />);
        const links = linkNames();
        expect(links).toContain('Take-home>Savings & pots');
        expect(links).toContain('Savings & pots>Tax Pot');
        expect(links).toContain('Savings & pots>Emergency Fund');
    });

    it('shows what is left over as unallocated', () => {
        render(<IncomeFlowSankey flow={flow} />);
        expect(linkNames()).toContain('Take-home>Unallocated');
    });

    it('rolls a long tail of small categories into an Other node', () => {
        render(<IncomeFlowSankey flow={flow} />);
        const links = linkNames();
        // Coffee is £2 against £1,752 of outflow — below the 1.5% threshold.
        expect(links).not.toContain('Discretionary Expenses >Coffee');
        expect(links).toContain('Discretionary Expenses >Other discretionary expenses');
    });

    it('converts pence to pounds for the chart values', () => {
        render(<IncomeFlowSankey flow={flow} />);
        const link = readSeries().links.find((l: any) => l.source === 'Net Salary');
        expect(link.value).toBe(5084);
    });

    it('produces an acyclic graph — a cycle crashes the ECharts sankey', () => {
        render(<IncomeFlowSankey flow={flow} />);
        const links = readSeries().links;
        const seen = new Set(links.map((l: any) => `${l.source}>${l.target}`));
        links.forEach((l: any) => {
            expect(seen.has(`${l.target}>${l.source}`)).toBe(false);
        });
    });

    it('uses the shared bucket palette', () => {
        render(<IncomeFlowSankey flow={flow} />);
        const nodes = readSeries().data;
        const mandatory = nodes.find((n: any) => n.name === 'Mandatory Expenses ');
        expect(mandatory.itemStyle.color).toBe(BUCKET_COLORS.mandatory);
    });

    it('labels a deficit as funded from savings rather than negative unallocated', () => {
        render(<IncomeFlowSankey flow={{
            ...flow,
            totals: { ...flow.totals, unallocatedPence: -50000 },
        }} />);
        expect(screen.getByText(/Funded from savings/)).toBeInTheDocument();
        // A negative residual must not become a Sankey link.
        expect(linkNames()).not.toContain('Take-home>Unallocated');
    });

    it('renders a placeholder when there is nothing to show', () => {
        render(<IncomeFlowSankey flow={null} />);
        expect(screen.getByText('No income or spending in this period yet.')).toBeInTheDocument();
        expect(screen.queryByTestId('echart')).not.toBeInTheDocument();
    });

    it('handles income with no spending without throwing', () => {
        render(<IncomeFlowSankey flow={{
            income: [{ key: 'net_salary', label: 'Net Salary', pence: 100000 }],
            outflow: [],
            pots: [],
            totals: { incomePence: 100000, outflowPence: 0, potTransferPence: 0, unallocatedPence: 100000 },
        }} />);
        expect(linkNames()).toEqual(['Net Salary>Take-home', 'Take-home>Unallocated']);
    });
});
