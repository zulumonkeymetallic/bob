import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

import { BUCKET_COLORS, BUCKET_LABELS } from '../../utils/financeCategories';
import type { CategoryBucket } from '../../utils/financeCategories';

/**
 * Whole-picture money flow: income sources in, everything they fund out.
 *
 * The existing Sankey in FinanceFlowDiagram roots at a node literally called
 * 'Total Spend' and only ever showed Buckets -> Categories -> Merchants. It
 * cannot answer "where did it all go", because it starts after the money has
 * already left and it excludes pot transfers entirely.
 *
 * This one is shaped like a household cashflow diagram:
 *
 *   Salary ─┐
 *   Side gig├─> Take-home ─┬─> Mandatory ─> Rent, Groceries, ...
 *   Interest┘              ├─> Discretionary ─> Eating out, ...
 *                          ├─> Savings pots ─> Emergency Fund, Tax Pot, ...
 *                          └─> Unallocated
 *
 * Saving is a destination, not an omission — money into a pot is not spend, but
 * it is very much part of the picture.
 */

export interface FlowIncome { key: string; label: string; pence: number }
export interface FlowOutflow { bucket: string; categoryKey: string; categoryLabel: string; pence: number }
export interface FlowPot { name: string; pence: number }

export interface FinanceFlow {
    income: FlowIncome[];
    outflow: FlowOutflow[];
    pots: FlowPot[];
    totals: {
        incomePence: number;
        outflowPence: number;
        potTransferPence: number;
        unallocatedPence: number;
    };
}

export interface IncomeFlowSankeyProps {
    flow: FinanceFlow | null | undefined;
    height?: number;
    /** Categories below this share of total outflow are grouped into "Other". */
    minCategoryShare?: number;
}

const HUB = 'Take-home';
const POTS_NODE = 'Savings & pots';
const UNALLOCATED = 'Unallocated';

const INCOME_COLOR = BUCKET_COLORS.net_salary;
const POT_COLOR = BUCKET_COLORS.short_saving;
const UNALLOCATED_COLOR = BUCKET_COLORS.unknown;

const fmt = (pence: number) =>
    new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 })
        .format(Math.abs(pence) / 100);

const bucketColour = (bucket: string): string =>
    BUCKET_COLORS[bucket as CategoryBucket] || BUCKET_COLORS.unknown;

const bucketLabel = (bucket: string): string =>
    BUCKET_LABELS[bucket as CategoryBucket] || bucket;

const IncomeFlowSankey: React.FC<IncomeFlowSankeyProps> = ({
    flow,
    height = 520,
    minCategoryShare = 0.015,
}) => {
    const { nodes, links, isEmpty } = useMemo(() => {
        const nodeList: Array<{ name: string; itemStyle?: { color: string } }> = [];
        const linkList: Array<{ source: string; target: string; value: number; lineStyle?: any }> = [];
        const seen = new Set<string>();

        const addNode = (name: string, color: string) => {
            if (seen.has(name)) return name;
            seen.add(name);
            nodeList.push({ name, itemStyle: { color } });
            return name;
        };
        const addLink = (source: string, target: string, pence: number, color: string) => {
            if (!pence || pence <= 0) return;
            linkList.push({
                source,
                target,
                value: Math.round(pence) / 100,
                lineStyle: { color, opacity: 0.42 },
            });
        };

        const income = flow?.income || [];
        const outflow = flow?.outflow || [];
        const pots = flow?.pots || [];
        const totals = flow?.totals;

        if (!totals || (!income.length && !outflow.length && !pots.length)) {
            return { nodes: [], links: [], isEmpty: true };
        }

        addNode(HUB, INCOME_COLOR);

        // Left: every income source flows into the hub.
        income.forEach((src) => {
            const label = src.label || src.key;
            addNode(label, INCOME_COLOR);
            addLink(label, HUB, src.pence, INCOME_COLOR);
        });

        // Right: hub -> bucket -> category.
        const byBucket = new Map<string, FlowOutflow[]>();
        outflow.forEach((row) => {
            if (!byBucket.has(row.bucket)) byBucket.set(row.bucket, []);
            byBucket.get(row.bucket)!.push(row);
        });

        const outflowTotal = outflow.reduce((sum, r) => sum + r.pence, 0);

        Array.from(byBucket.entries())
            .sort((a, b) => b[1].reduce((s, r) => s + r.pence, 0) - a[1].reduce((s, r) => s + r.pence, 0))
            .forEach(([bucket, rows]) => {
                const colour = bucketColour(bucket);
                // Bucket names are prefixed to avoid colliding with a category of
                // the same name, which would make the graph cyclic and crash the
                // ECharts Sankey ("the original data has cycle").
                const bucketNode = `${bucketLabel(bucket)} `;
                const bucketTotal = rows.reduce((s, r) => s + r.pence, 0);
                addNode(bucketNode, colour);
                addLink(HUB, bucketNode, bucketTotal, colour);

                // Long tails make the diagram unreadable; roll the small ones up.
                let otherPence = 0;
                rows.sort((a, b) => b.pence - a.pence).forEach((row) => {
                    if (outflowTotal > 0 && row.pence / outflowTotal < minCategoryShare) {
                        otherPence += row.pence;
                        return;
                    }
                    const label = row.categoryLabel || row.categoryKey;
                    addNode(label, colour);
                    addLink(bucketNode, label, row.pence, colour);
                });
                if (otherPence > 0) {
                    const otherNode = `Other ${bucketLabel(bucket).toLowerCase()}`;
                    addNode(otherNode, colour);
                    addLink(bucketNode, otherNode, otherPence, colour);
                }
            });

        // Saving is a destination, not an exclusion.
        if (totals.potTransferPence > 0) {
            addNode(POTS_NODE, POT_COLOR);
            addLink(HUB, POTS_NODE, totals.potTransferPence, POT_COLOR);
            pots.forEach((pot) => {
                addNode(pot.name, POT_COLOR);
                addLink(POTS_NODE, pot.name, pot.pence, POT_COLOR);
            });
        }

        if (totals.unallocatedPence > 0) {
            addNode(UNALLOCATED, UNALLOCATED_COLOR);
            addLink(HUB, UNALLOCATED, totals.unallocatedPence, UNALLOCATED_COLOR);
        }

        return { nodes: nodeList, links: linkList, isEmpty: linkList.length === 0 };
    }, [flow, minCategoryShare]);

    const option = useMemo(() => ({
        tooltip: {
            trigger: 'item',
            triggerOn: 'mousemove',
            formatter: (params: any) => {
                if (params.dataType === 'edge') {
                    return `${params.data.source} → ${params.data.target}<br/><strong>${fmt(params.data.value * 100)}</strong>`;
                }
                return `${params.name}<br/><strong>${fmt((params.value || 0) * 100)}</strong>`;
            },
        },
        series: [{
            type: 'sankey',
            data: nodes,
            links,
            emphasis: { focus: 'adjacency' },
            nodeGap: 10,
            nodeWidth: 14,
            lineStyle: { curveness: 0.5 },
            label: {
                formatter: '{b}',
                fontSize: 11,
                // Trailing space distinguishes bucket nodes from categories; hide it.
                overflow: 'truncate',
            },
        }],
    }), [nodes, links]);

    if (isEmpty) {
        return (
            <div className="d-flex align-items-center justify-content-center text-muted small" style={{ height }}>
                No income or spending in this period yet.
            </div>
        );
    }

    return (
        <div data-testid="income-flow-sankey">
            <ReactECharts option={option} style={{ height, width: '100%' }} opts={{ renderer: 'svg' }} />
            {flow?.totals && (
                <div className="d-flex flex-wrap gap-4 justify-content-center small text-muted mt-2">
                    <span>In <strong className="text-success">{fmt(flow.totals.incomePence)}</strong></span>
                    <span>Out <strong className="text-danger">{fmt(flow.totals.outflowPence)}</strong></span>
                    <span>To pots <strong>{fmt(flow.totals.potTransferPence)}</strong></span>
                    <span>
                        {flow.totals.unallocatedPence >= 0 ? 'Unallocated ' : 'Funded from savings '}
                        <strong>{fmt(flow.totals.unallocatedPence)}</strong>
                    </span>
                </div>
            )}
        </div>
    );
};

export default IncomeFlowSankey;
