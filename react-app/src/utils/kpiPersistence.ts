import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { Goal } from '../types';
import type { Kpi } from '../types/KpiTypes';
import { persistResolvedGoalKpis } from './kpiResolver';

const readGoalKpiArray = (goalData: any): Kpi[] => (
  Array.isArray(goalData?.kpisV2) ? goalData.kpisV2 : []
) as Kpi[];

const projectLegacyKpi = (kpi: Kpi) => ({
  id: kpi.id,
  name: kpi.name,
  description: kpi.description || '',
  target: Number(kpi.target || 0),
  unit: kpi.unit || '',
  type: kpi.type,
  timeframe: kpi.timeframe,
  current: kpi.current ?? null,
  progress: kpi.progress ?? null,
  status: kpi.status ?? null,
  sourceId: kpi.sourceId || null,
  metricId: kpi.metricId || null,
  visualizationType: kpi.visualizationType || null,
  displayOnDashboard: kpi.displayOnDashboard === true,
  targetDirection: kpi.targetDirection || null,
  aggregation: kpi.aggregation || null,
});

export async function appendGoalKpi(options: {
  goalId: string;
  ownerUid: string;
  kpi: Kpi;
}) {
  const { goalId, ownerUid, kpi } = options;
  const goalRef = doc(db, 'goals', goalId);
  const goalSnap = await getDoc(goalRef);

  if (!goalSnap.exists()) {
    throw new Error('Goal not found.');
  }

  const goalData = goalSnap.data() as Goal & Record<string, any>;
  if (String(goalData.ownerUid || '') !== String(ownerUid || '')) {
    throw new Error('You can only edit your own goals.');
  }

  const existingKpis = readGoalKpiArray(goalData).filter((entry) => String(entry?.id || '') !== String(kpi.id || ''));
  const nextKpis = [...existingKpis, kpi];
  const legacyExisting = Array.isArray(goalData?.kpis) ? goalData.kpis : [];
  const nextLegacy = [
    ...legacyExisting.filter((entry: any) => String(entry?.id || '') !== String(kpi.id || '')),
    projectLegacyKpi(kpi),
  ];

  await updateDoc(goalRef, {
    kpisV2: nextKpis,
    kpis: nextLegacy,
    kpiNames: nextKpis.map((entry) => String(entry?.name || '').trim()).filter(Boolean),
    updatedAt: serverTimestamp(),
  });

  await persistResolvedGoalKpis({
    ownerUid,
    goal: {
      ...(goalData as Goal),
      id: goalId,
      kpisV2: nextKpis,
    } as Goal,
  });
}
