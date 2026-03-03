type MerchantLike = {
  merchantKey?: string | null;
  merchant?: string | null;
  merchantName?: string | null;
};

type CadenceSourceRow = MerchantLike & {
  createdISO?: string | null;
  createdAt?: any;
  amount?: number | null;
  amountMinor?: number | null;
  isSubscription?: boolean;
};

export type FinanceActionInsight = {
  id: string;
  type?: string;
  title?: string;
  reason?: string;
  merchantKey?: string;
  merchantName?: string;
  estimatedMonthlySavings?: number;
  confidence?: number;
  status?: string;
  storyId?: string | null;
  generatedAt?: string;
};

export type MerchantCadenceSummary = {
  frequencyKey: 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly' | 'one_off' | 'irregular';
  frequencyLabel: string;
  likelySubscription: boolean;
  confidence: number;
  txCount: number;
  avgIntervalDays: number | null;
  nextPredictedDateISO: string | null;
};

const toText = (value: any, fallback = ''): string => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const candidate = value.name || value.label || value.title || value.displayName || value.merchantName || value.id || '';
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (typeof candidate === 'number' || typeof candidate === 'boolean') return String(candidate);
  }
  return fallback;
};

export const normalizeMerchantKey = (input: string): string => {
  const base = String(input || '').trim().toLowerCase();
  if (!base) return '';
  return base
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
};

export const resolveMerchantKey = (row: MerchantLike): string => {
  const direct = normalizeMerchantKey(toText(row?.merchantKey, ''));
  if (direct) return direct;
  const fromName = normalizeMerchantKey(
    toText(row?.merchantName, '') || toText(row?.merchant, '')
  );
  return fromName;
};

const toDate = (row: CadenceSourceRow): Date | null => {
  if (row.createdISO) {
    const d = new Date(row.createdISO);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const createdAt = row.createdAt;
  if (createdAt?.toDate) {
    const d = createdAt.toDate();
    if (d instanceof Date && !Number.isNaN(d.getTime())) return d;
  }
  if (createdAt?._seconds) {
    const d = new Date(createdAt._seconds * 1000);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (typeof createdAt === 'string' || typeof createdAt === 'number') {
    const d = new Date(createdAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
};

const mean = (values: number[]): number => {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const stdDev = (values: number[]): number => {
  if (!values.length) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / values.length;
  return Math.sqrt(variance);
};

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
};

const frequencyFromInterval = (intervalDays: number): MerchantCadenceSummary['frequencyKey'] => {
  if (!Number.isFinite(intervalDays) || intervalDays <= 0) return 'irregular';
  if (intervalDays <= 10) return 'weekly';
  if (intervalDays <= 40) return 'monthly';
  if (intervalDays <= 110) return 'quarterly';
  if (intervalDays <= 220) return 'semiannual';
  if (intervalDays <= 430) return 'yearly';
  return 'irregular';
};

const frequencyLabel = (frequency: MerchantCadenceSummary['frequencyKey']): string => {
  if (frequency === 'weekly') return 'Weekly';
  if (frequency === 'monthly') return 'Monthly';
  if (frequency === 'quarterly') return 'Quarterly';
  if (frequency === 'semiannual') return 'Every 6 months';
  if (frequency === 'yearly') return 'Yearly';
  if (frequency === 'one_off') return 'One-off';
  return 'Irregular';
};

const toAmount = (row: CadenceSourceRow): number => {
  if (Number.isFinite(Number(row.amountMinor))) return Math.abs(Number(row.amountMinor) / 100);
  return Math.abs(Number(row.amount || 0));
};

export const inferMerchantCadence = (rows: CadenceSourceRow[]): MerchantCadenceSummary => {
  const dates = rows
    .map((row) => toDate(row))
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime());
  const txCount = dates.length;
  if (txCount <= 1) {
    return {
      frequencyKey: txCount === 1 ? 'one_off' : 'irregular',
      frequencyLabel: txCount === 1 ? 'One-off' : 'Irregular',
      likelySubscription: rows.some((row) => !!row.isSubscription),
      confidence: txCount === 1 ? 0.3 : 0,
      txCount,
      avgIntervalDays: null,
      nextPredictedDateISO: null,
    };
  }

  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i += 1) {
    const days = (dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24);
    if (days > 0) intervals.push(days);
  }
  const avgIntervalDays = intervals.length ? mean(intervals) : null;
  const dominantInterval = intervals.length ? median(intervals) : 0;
  const frequencyKey = frequencyFromInterval(dominantInterval);

  const amounts = rows.map(toAmount).filter((value) => value > 0);
  const amountMean = mean(amounts);
  const cv = amountMean > 0 ? stdDev(amounts) / amountMean : 1;
  const explicitSubscription = rows.some((row) => !!row.isSubscription);
  const recurringFrequency = ['monthly', 'quarterly', 'semiannual', 'yearly'].includes(frequencyKey);
  const likelySubscription = explicitSubscription || (recurringFrequency && txCount >= 2 && cv <= 0.45);

  const patternScore = Math.max(0, Math.min(1, 1 - cv));
  const countScore = Math.max(0, Math.min(1, txCount / 8));
  const confidence = Number((0.55 * patternScore + 0.45 * countScore).toFixed(2));
  const predictableFrequency = ['weekly', 'monthly', 'quarterly', 'semiannual', 'yearly'].includes(frequencyKey);
  const nextPredictedDateISO = (() => {
    if (!predictableFrequency || !Number.isFinite(dominantInterval) || dominantInterval <= 0) return null;
    const lastDate = dates[dates.length - 1];
    if (!lastDate) return null;
    const nextDate = new Date(lastDate.getTime() + (dominantInterval * 24 * 60 * 60 * 1000));
    if (Number.isNaN(nextDate.getTime())) return null;
    return nextDate.toISOString();
  })();

  return {
    frequencyKey,
    frequencyLabel: frequencyLabel(frequencyKey),
    likelySubscription,
    confidence,
    txCount,
    avgIntervalDays,
    nextPredictedDateISO,
  };
};

export const buildCadenceByMerchant = (rows: CadenceSourceRow[]): Map<string, MerchantCadenceSummary> => {
  const grouped = new Map<string, CadenceSourceRow[]>();
  rows.forEach((row) => {
    const key = resolveMerchantKey(row);
    if (!key) return;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  });
  const result = new Map<string, MerchantCadenceSummary>();
  grouped.forEach((groupRows, key) => {
    result.set(key, inferMerchantCadence(groupRows));
  });
  return result;
};

export const buildActionLookup = (actions: any[]): Map<string, FinanceActionInsight> => {
  const map = new Map<string, FinanceActionInsight>();
  (Array.isArray(actions) ? actions : []).forEach((raw) => {
    if (!raw || (raw.status || 'open') === 'converted') return;
    const action: FinanceActionInsight = {
      id: String(raw.id || ''),
      type: raw.type ? String(raw.type) : undefined,
      title: raw.title ? String(raw.title) : undefined,
      reason: raw.reason ? String(raw.reason) : undefined,
      merchantKey: raw.merchantKey ? String(raw.merchantKey) : undefined,
      merchantName: raw.merchantName ? String(raw.merchantName) : undefined,
      estimatedMonthlySavings: Number(raw.estimatedMonthlySavings || 0) || 0,
      confidence: Number(raw.confidence || 0) || 0,
      status: raw.status ? String(raw.status) : undefined,
      storyId: raw.storyId || null,
      generatedAt: raw.generatedAt ? String(raw.generatedAt) : undefined,
    };
    if (!action.id) return;
    const keyFromMerchant = normalizeMerchantKey(action.merchantKey || '');
    const keyFromName = normalizeMerchantKey(action.merchantName || '');
    if (keyFromMerchant && !map.has(keyFromMerchant)) map.set(keyFromMerchant, action);
    if (keyFromName && !map.has(keyFromName)) map.set(keyFromName, action);
  });
  return map;
};

export const getActionForMerchant = (
  lookup: Map<string, FinanceActionInsight>,
  merchantLike: MerchantLike
): FinanceActionInsight | null => {
  const key = resolveMerchantKey(merchantLike);
  if (!key) return null;
  return lookup.get(key) || null;
};

export const isWithinLastYear = (createdISO?: string | null): boolean => {
  if (!createdISO) return false;
  const created = new Date(createdISO);
  if (Number.isNaN(created.getTime())) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 365);
  return created >= cutoff;
};
