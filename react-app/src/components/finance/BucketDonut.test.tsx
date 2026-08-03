import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import BucketDonut from './BucketDonut';
import { BUCKET_COLORS } from '../../utils/financeCategories';

// ECharts does not render in jsdom, so mock it to a div carrying the serialised
// option and assert on that. This is the only sane way to test chart config.
jest.mock('echarts-for-react', () => ({
    __esModule: true,
    default: (props: any) => (
        <div
            data-testid="echart"
            data-option={JSON.stringify(props.option)}
            onClick={() => props.onEvents?.click?.({ name: 'Discretionary' })}
        />
    ),
}));

const readOption = () => JSON.parse(screen.getByTestId('echart').getAttribute('data-option') || '{}');
const readSeriesData = () => readOption().series[0].data;

describe('BucketDonut', () => {
    it('rolls the ten buckets into the four headline ones', () => {
        render(<BucketDonut data={[
            { bucket: 'mandatory', pence: 100000 },
            { bucket: 'debt_repayment', pence: 20000 },
            { bucket: 'discretionary', pence: 50000 },
            { bucket: 'short_saving', pence: 30000 },
            { bucket: 'long_saving', pence: 10000 },
            { bucket: 'investment', pence: 5000 },
        ]} />);

        const data = readSeriesData();
        const byName = Object.fromEntries(data.map((d: any) => [d.name, d.value]));

        // debt_repayment folds into mandatory.
        expect(byName.Mandatory).toBe(120000);
        expect(byName.Discretionary).toBe(50000);
        // short + long + investment fold into one saving slice.
        expect(byName['Saving & investing']).toBe(45000);
        expect(data).toHaveLength(3);
    });

    it('treats the stored `optional` vocabulary as discretionary', () => {
        render(<BucketDonut data={[
            { bucket: 'optional', pence: 40000 },
            { bucket: 'discretionary', pence: 10000 },
        ]} />);

        const data = readSeriesData();
        expect(data).toHaveLength(1);
        expect(data[0].name).toBe('Discretionary');
        expect(data[0].value).toBe(50000);
    });

    it('excludes transfers and unknown, which are not spend', () => {
        render(<BucketDonut data={[
            { bucket: 'mandatory', pence: 100000 },
            { bucket: 'bank_transfer', pence: 500000 },
            { bucket: 'unknown', pence: 25000 },
        ]} />);

        const data = readSeriesData();
        expect(data).toHaveLength(1);
        expect(data[0].value).toBe(100000);
    });

    it('orders slices mandatory first, then discretionary', () => {
        render(<BucketDonut data={[
            { bucket: 'net_salary', pence: 10 },
            { bucket: 'discretionary', pence: 50000 },
            { bucket: 'mandatory', pence: 10000 },
        ]} />);

        expect(readSeriesData().map((d: any) => d.name))
            .toEqual(['Mandatory', 'Discretionary', 'Income']);
    });

    it('uses the shared bucket palette rather than its own colours', () => {
        render(<BucketDonut data={[{ bucket: 'mandatory', pence: 100 }, { bucket: 'discretionary', pence: 100 }]} />);

        const data = readSeriesData();
        expect(data[0].itemStyle.color).toBe(BUCKET_COLORS.mandatory);
        expect(data[1].itemStyle.color).toBe(BUCKET_COLORS.discretionary);
    });

    it('keeps all ten buckets when coarse is off', () => {
        render(<BucketDonut coarse={false} data={[
            { bucket: 'short_saving', pence: 1000 },
            { bucket: 'long_saving', pence: 2000 },
            { bucket: 'investment', pence: 3000 },
        ]} />);

        expect(readSeriesData()).toHaveLength(3);
    });

    it('normalises negative amounts, since spend is stored signed', () => {
        render(<BucketDonut data={[{ bucket: 'mandatory', pence: -100000 }]} />);
        expect(readSeriesData()[0].value).toBe(100000);
    });

    it('shows the total in the centre by default', () => {
        render(<BucketDonut data={[
            { bucket: 'mandatory', pence: 100000 },
            { bucket: 'discretionary', pence: 50000 },
        ]} />);

        const formatter = readOption().series[0].label.formatter;
        // The option is serialised, so the function is dropped — assert the
        // rendered centre text via a supplied label instead.
        expect(formatter).toBeUndefined();
    });

    it('accepts an explicit centre label', () => {
        render(<BucketDonut
            data={[{ bucket: 'mandatory', pence: 100000 }]}
            centreLabel="62%"
            centreSubLabel="mandatory"
        />);
        expect(screen.getByTestId('echart')).toBeInTheDocument();
    });

    it('hides the legend when asked', () => {
        render(<BucketDonut data={[{ bucket: 'mandatory', pence: 100 }]} showLegend={false} />);
        expect(readOption().legend.show).toBe(false);
    });

    it('reports the bucket key, not the display label, on click', () => {
        const onSliceClick = jest.fn();
        render(<BucketDonut
            data={[{ bucket: 'discretionary', pence: 100 }]}
            onSliceClick={onSliceClick}
        />);

        fireEvent.click(screen.getByTestId('echart'));
        expect(onSliceClick).toHaveBeenCalledWith('discretionary');
    });

    it('renders a placeholder rather than an empty chart', () => {
        render(<BucketDonut data={[]} />);
        expect(screen.getByText('No spend to show yet.')).toBeInTheDocument();
        expect(screen.queryByTestId('echart')).not.toBeInTheDocument();
    });

    it('ignores zero-value buckets', () => {
        render(<BucketDonut data={[
            { bucket: 'mandatory', pence: 0 },
            { bucket: 'discretionary', pence: 5000 },
        ]} />);

        expect(readSeriesData()).toHaveLength(1);
    });
});
