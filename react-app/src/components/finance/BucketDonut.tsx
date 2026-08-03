import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

import type { CategoryBucket } from '../../utils/financeCategories';
import { BUCKET_COLORS, BUCKET_LABELS } from '../../utils/financeCategories';
import { narrowToV4 } from '../../utils/financeBuckets';

/**
 * Mandatory vs discretionary at a glance.
 *
 * One component for what were three near-identical ad-hoc ECharts option objects
 * (FinanceDashboardAdvanced L851 and L1348, plus a hand-rolled progress bar on the
 * Overview widget and nothing at all on mobile). Colours and labels come from
 * utils/financeCategories so the palette matches every other finance surface.
 */

export interface BucketSlice {
    bucket: CategoryBucket | string;
    pence: number;
}

export interface BucketDonutProps {
    data: BucketSlice[];
    /** sm suits a dashboard widget or a phone; md/lg suit a full dashboard panel. */
    size?: 'sm' | 'md' | 'lg';
    showLegend?: boolean;
    /** Roll the ten buckets into the four headline ones. Default true — the point
     *  of this chart is mandatory vs discretionary, not a ten-way split. */
    coarse?: boolean;
    /** Text rendered in the hole. Defaults to the total. */
    centreLabel?: string;
    centreSubLabel?: string;
    onSliceClick?: (bucket: string) => void;
    className?: string;
}

const SIZES = {
    sm: { height: 150, radius: ['58%', '82%'] },
    md: { height: 240, radius: ['55%', '80%'] },
    lg: { height: 320, radius: ['52%', '78%'] },
} as const;

/** The four headline buckets, in the order they should read. */
const COARSE_ORDER = ['mandatory', 'discretionary', 'savings', 'income'] as const;

const COARSE_LABELS: Record<string, string> = {
    mandatory: 'Mandatory',
    discretionary: 'Discretionary',
    savings: 'Saving & investing',
    income: 'Income',
};

const COARSE_COLORS: Record<string, string> = {
    mandatory: BUCKET_COLORS.mandatory,
    discretionary: BUCKET_COLORS.discretionary,
    savings: BUCKET_COLORS.short_saving,
    income: BUCKET_COLORS.net_salary,
};

const fmt = (pence: number) =>
    new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: 'GBP',
        maximumFractionDigits: 0,
    }).format(Math.abs(pence) / 100);

const BucketDonut: React.FC<BucketDonutProps> = ({
    data,
    size = 'md',
    showLegend = true,
    coarse = true,
    centreLabel,
    centreSubLabel,
    onSliceClick,
    className,
}) => {
    const slices = useMemo(() => {
        const totals = new Map<string, number>();

        data.forEach((slice) => {
            const raw = String(slice.bucket || '').toLowerCase();
            // narrowToV4 folds discretionary->optional, so relabel back: this chart
            // speaks the user-facing vocabulary, not the storage one.
            const v4 = narrowToV4(raw);
            const key = coarse
                ? (v4 === 'optional' ? 'discretionary' : v4)
                : raw;
            // bank_transfer and unknown narrow to null — they are not spend.
            if (!key) return;
            const pence = Math.abs(Math.round(Number(slice.pence) || 0));
            if (!pence) return;
            totals.set(key, (totals.get(key) || 0) + pence);
        });

        const entries = Array.from(totals.entries());
        const ordered = coarse
            ? entries.sort((a, b) => COARSE_ORDER.indexOf(a[0] as any) - COARSE_ORDER.indexOf(b[0] as any))
            : entries.sort((a, b) => b[1] - a[1]);

        return ordered.map(([key, pence]) => ({
            key,
            value: pence,
            name: coarse
                ? (COARSE_LABELS[key] || key)
                : (BUCKET_LABELS[key as CategoryBucket] || key),
            color: coarse
                ? (COARSE_COLORS[key] || BUCKET_COLORS.unknown)
                : (BUCKET_COLORS[key as CategoryBucket] || BUCKET_COLORS.unknown),
        }));
    }, [data, coarse]);

    const total = useMemo(() => slices.reduce((sum, s) => sum + s.value, 0), [slices]);
    const dimensions = SIZES[size];

    const option = useMemo(() => ({
        tooltip: {
            trigger: 'item',
            formatter: (params: any) => `${params.name}<br/>${fmt(params.value)} (${params.percent}%)`,
        },
        legend: showLegend
            ? { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { fontSize: 11 } }
            : { show: false },
        series: [{
            type: 'pie',
            radius: dimensions.radius,
            avoidLabelOverlap: true,
            center: ['50%', showLegend ? '44%' : '50%'],
            label: {
                show: true,
                position: 'center',
                formatter: () => [
                    `{value|${centreLabel ?? fmt(total)}}`,
                    `{label|${centreSubLabel ?? 'total spend'}}`,
                ].join('\n'),
                rich: {
                    value: { fontSize: size === 'sm' ? 15 : 20, fontWeight: 600 },
                    label: { fontSize: 10, opacity: 0.7, padding: [3, 0, 0, 0] },
                },
            },
            // The centre label is permanent, so suppress the per-slice emphasis
            // label that would otherwise overwrite it on hover.
            emphasis: { label: { show: false }, scale: true, scaleSize: 4 },
            labelLine: { show: false },
            data: slices.map((slice) => ({
                name: slice.name,
                value: slice.value,
                itemStyle: { color: slice.color },
            })),
        }],
    }), [slices, total, dimensions, showLegend, centreLabel, centreSubLabel, size]);

    if (!slices.length) {
        return (
            <div
                className={`d-flex align-items-center justify-content-center text-muted small ${className || ''}`}
                style={{ height: dimensions.height }}
            >
                No spend to show yet.
            </div>
        );
    }

    return (
        <div className={className} data-testid="bucket-donut">
            <ReactECharts
                option={option}
                style={{ height: dimensions.height, width: '100%' }}
                opts={{ renderer: 'svg' }}
                onEvents={onSliceClick
                    ? {
                        click: (params: any) => {
                            const hit = slices.find((s) => s.name === params?.name);
                            if (hit) onSliceClick(hit.key);
                        },
                    }
                    : undefined}
            />
        </div>
    );
};

export default BucketDonut;
