/**
 * Shared ECharts tooltip builders for the finance charts.
 *
 * Every chart used to answer "how much?" and none answered "how much of the total?", so
 * reading a slice or a stack segment meant doing the division in your head. These builders
 * put the share next to the amount, and — importantly — state which total the share is of,
 * because a donut ring and a stacked column are different denominators and silently mixing
 * them is how the dashboard ended up showing 897%.
 */

type CurrencyFormatter = (value: number) => string;

const defaultFormatCurrency: CurrencyFormatter = (value) => `£${Number(value || 0).toLocaleString('en-GB', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

function sharePct(part: number, whole: number): string {
  if (!Number.isFinite(whole) || whole === 0) return '—';
  const pct = (Math.abs(part) / Math.abs(whole)) * 100;
  if (pct > 0 && pct < 0.1) return '<0.1%';
  return `${pct.toFixed(1)}%`;
}

/**
 * Pie/donut tooltip: amount plus the slice's share of the ring.
 *
 * ECharts already computes `params.percent` against the series total, which IS the ring
 * total — use it rather than recomputing, so the number always matches the drawn geometry.
 * `ringLabel` names the denominator; pass a caption when the ring is a subset (a Top 10
 * ring is not the period total, and claiming otherwise overstates every slice).
 */
export function pieShareTooltip(
  formatCurrency: CurrencyFormatter = defaultFormatCurrency,
  ringLabel = 'of shown total',
) {
  return {
    trigger: 'item' as const,
    formatter: (params: any) => {
      const value = Number(params?.value || 0);
      const pct = Number.isFinite(Number(params?.percent)) ? `${Number(params.percent).toFixed(1)}%` : '—';
      return [
        `<strong>${params?.name ?? ''}</strong>`,
        `${formatCurrency(value)}`,
        `<span style="opacity:0.7">${pct} ${ringLabel}</span>`,
      ].join('<br/>');
    },
  };
}

/**
 * Stacked-bar tooltip: every series in the hovered column, each with its share of THAT
 * column's total, and the column total itself as the footer.
 *
 * The denominator is deliberately the column, not the period: on a stacked month chart the
 * question a segment raises is "how much of this month was that?".
 */
export function stackedShareTooltip(
  formatCurrency: CurrencyFormatter = defaultFormatCurrency,
  totalLabel = 'Total',
) {
  return {
    trigger: 'axis' as const,
    axisPointer: { type: 'shadow' as const },
    formatter: (params: any) => {
      const rows: any[] = Array.isArray(params) ? params : [params];
      if (!rows.length) return '';
      const columnTotal = rows.reduce((sum, row) => sum + Math.abs(Number(row?.value) || 0), 0);
      const body = rows
        .filter((row) => Math.abs(Number(row?.value) || 0) > 0)
        .map((row) => {
          const value = Math.abs(Number(row?.value) || 0);
          return `${row.marker ?? ''} ${row.seriesName}: <strong>${formatCurrency(value)}</strong>`
            + ` <span style="opacity:0.7">(${sharePct(value, columnTotal)})</span>`;
        })
        .join('<br/>');
      const header = `<strong>${rows[0]?.axisValueLabel ?? rows[0]?.axisValue ?? ''}</strong>`;
      const footer = `<span style="opacity:0.7">${totalLabel}: ${formatCurrency(columnTotal)}</span>`;
      return `${header}<br/>${body}${body ? '<br/>' : ''}${footer}`;
    },
  };
}

/**
 * Horizontal/simple bar tooltip: share of the chart's own total, which the caller must
 * supply because a single-series bar chart gives ECharts no total to divide by.
 */
export function barShareTooltip(
  chartTotal: number,
  formatCurrency: CurrencyFormatter = defaultFormatCurrency,
  totalLabel = 'of shown total',
) {
  return {
    trigger: 'item' as const,
    formatter: (params: any) => {
      const value = Math.abs(Number(params?.value) || 0);
      return [
        `<strong>${params?.name ?? ''}</strong>`,
        `${formatCurrency(value)}`,
        `<span style="opacity:0.7">${sharePct(value, chartTotal)} ${totalLabel}</span>`,
      ].join('<br/>');
    },
  };
}

export const __testing = { sharePct };
