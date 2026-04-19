import { collection, doc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { KpiDataSource, KpiSourceFieldType } from '../types/KpiTypes';

export interface MetricValueRow {
  id: string;
  ownerUid: string;
  metricKey: string;
  source: KpiDataSource;
  sourceId?: string | null;
  observedAt: number;
  periodKey: string;
  value: number;
  unit?: string;
  dataType?: KpiSourceFieldType;
  syncedAt?: any;
  isManual?: boolean;
  staleAfterAt?: number | null;
  meta?: Record<string, any>;
}

export const toPeriodKey = (timeframe: string, date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  if (timeframe === 'daily') return `${year}-${month}-${day}`;
  if (timeframe === 'weekly' || timeframe === 'sprint') {
    const anchor = new Date(date);
    const weekday = (anchor.getDay() + 6) % 7;
    anchor.setDate(anchor.getDate() - weekday);
    return `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}-${String(anchor.getDate()).padStart(2, '0')}`;
  }
  if (timeframe === 'monthly') return `${year}-${month}`;
  if (timeframe === 'quarterly') return `${year}-Q${Math.floor(date.getMonth() / 3) + 1}`;
  return String(year);
};

export async function upsertMetricValue(options: Omit<MetricValueRow, 'id' | 'syncedAt'>) {
  const {
    ownerUid,
    metricKey,
    source,
    sourceId = null,
    observedAt,
    periodKey,
    value,
    unit,
    dataType,
    isManual = false,
    staleAfterAt = null,
    meta = {},
  } = options;
  const id = [ownerUid, metricKey, source, periodKey, sourceId || 'default'].join('__');
  await setDoc(doc(db, 'metric_values', id), {
    ownerUid,
    metricKey,
    source,
    sourceId,
    observedAt,
    periodKey,
    value,
    unit: unit || null,
    dataType: dataType || null,
    isManual,
    staleAfterAt,
    meta,
    syncedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return id;
}

export async function getLatestMetricValue(options: {
  ownerUid: string;
  metricKey: string;
  source?: KpiDataSource;
  periodKey?: string | null;
}) {
  const { ownerUid, metricKey, source, periodKey = null } = options;
  const filters = [
    where('ownerUid', '==', ownerUid),
    where('metricKey', '==', metricKey),
  ];
  if (source) filters.push(where('source', '==', source));
  if (periodKey) filters.push(where('periodKey', '==', periodKey));
  const snap = await getDocs(query(collection(db, 'metric_values'), ...filters, orderBy('observedAt', 'desc'), limit(1)));
  const docSnap = snap.docs[0];
  if (!docSnap) return null;
  return { id: docSnap.id, ...(docSnap.data() as any) } as MetricValueRow;
}
