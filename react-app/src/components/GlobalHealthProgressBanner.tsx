/**
 * Health progress section for the NotificationStream popover.
 * Reads profiles/{uid} directly so it works on every page, not just Dashboard.
 * Shares the same localStorage dismiss key so dismissing suppresses it
 * everywhere for 3 days.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const DISMISS_KEY          = 'dashboard-health-banner-dismissed-date';
const DISMISS_DAYS         = 3;

function readNumber(...values: any[]): number | null {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

function adherencePct(actual: number | null, target: number | null): number | null {
  if (actual == null || target == null || target <= 0) return null;
  return clampPct((actual / target) * 100);
}

const GlobalHealthProgressBanner: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any | null>(null);
  const [coachDaily, setCoachDaily] = useState<any | null>(null);
  const [visible, setVisible] = useState(false);

  // Respect 3-day dismiss
  useEffect(() => {
    try {
      const stored = localStorage.getItem(DISMISS_KEY);
      if (stored) {
        const days = (Date.now() - new Date(stored).getTime()) / 86_400_000;
        if (days < DISMISS_DAYS) { setVisible(false); return; }
      }
    } catch { /* ignore */ }
    setVisible(true);
  }, []);

  useEffect(() => {
    if (!currentUser?.uid) { setProfile(null); return; }
    const unsub = onSnapshot(
      doc(db, 'profiles', currentUser.uid),
      (snap) => setProfile(snap.exists() ? snap.data() : null),
      () => setProfile(null),
    );
    return () => unsub();
  }, [currentUser?.uid]);

  // AI coach daily insight — written nightly to coach_daily/{uid}_{date}
  useEffect(() => {
    if (!currentUser?.uid) { setCoachDaily(null); return; }
    const unsub = onSnapshot(
      doc(db, 'coach_daily', `${currentUser.uid}_${todayIso()}`),
      (snap) => setCoachDaily(snap.exists() ? snap.data() : null),
      () => setCoachDaily(null),
    );
    return () => unsub();
  }, [currentUser?.uid]);

  const data = useMemo(() => {
    if (!profile) return null;
    const weightKg        = readNumber(profile.healthkitWeightKg,        profile.manualWeightKg);
    const bodyFatPct      = readNumber(profile.healthkitBodyFatPct,       profile.manualBodyFatPct);
    const targetWeightKg  = readNumber(profile.targetWeightKg,            profile.healthTargetWeightKg);
    const targetBodyFatPct= readNumber(profile.targetBodyFatPct,          profile.healthTargetBodyFatPct, profile.bodyFatTarget);
    const stepsToday      = readNumber(profile.healthkitStepsToday,       profile.manualStepsToday);
    const workoutMins     = readNumber(profile.healthkitWorkoutMinutesToday, profile.manualWorkoutMinutesToday);
    const proteinG        = readNumber(profile.healthkitProteinTodayG,    profile.manualProteinTodayG);
    const fatG            = readNumber(profile.healthkitFatTodayG,        profile.manualFatTodayG);
    const carbsG          = readNumber(profile.healthkitCarbsTodayG,      profile.manualCarbsTodayG);
    const calKcal         = readNumber(profile.healthkitCaloriesTodayKcal,profile.manualCaloriesTodayKcal);
    const targetProtein   = readNumber(profile.targetProteinG,            profile.dailyProteinTargetG,   profile.healthTargetProteinG);
    const targetFat       = readNumber(profile.targetFatG,                profile.dailyFatTargetG,       profile.healthTargetFatG);
    const targetCarbs     = readNumber(profile.targetCarbsG,              profile.dailyCarbsTargetG,     profile.healthTargetCarbsG);
    const targetCal       = readNumber(profile.targetCaloriesKcal,        profile.dailyCaloriesTargetKcal, profile.healthTargetCaloriesKcal);
    const weeksToTarget   = readNumber(profile.weeksToTargetBodyFat);

    const macroComponents = [
      adherencePct(proteinG, targetProtein),
      adherencePct(fatG,     targetFat),
      adherencePct(carbsG,   targetCarbs),
      adherencePct(calKcal,  targetCal),
    ].filter((v): v is number => v != null);
    const macroAdherencePct = macroComponents.length
      ? Math.round(macroComponents.reduce((s, v) => s + v, 0) / macroComponents.length)
      : null;

    const macroTone = macroAdherencePct == null ? 'secondary'
      : macroAdherencePct >= 80 ? 'success'
      : macroAdherencePct >= 60 ? 'warning'
      : 'danger';

    const bodyFatGoalPct   = targetBodyFatPct ?? 15;
    const bodyFatProgress  = bodyFatPct == null ? null : (bodyFatPct <= bodyFatGoalPct ? 100 : 0);
    const primaryPct       = bodyFatProgress ?? macroAdherencePct ?? null;
    const primaryLabel     = bodyFatProgress != null
      ? `Body fat target ${bodyFatGoalPct}%`
      : (macroAdherencePct != null ? 'Macro adherence' : 'Health progress');
    const sourceLabel      = ['authorized', 'synced'].includes(String(profile.healthkitStatus || '').toLowerCase())
      ? 'HealthKit' : 'Manual';

    const ts = profile.updatedAt?.toMillis?.() ?? (typeof profile.updatedAt === 'number' ? profile.updatedAt : null);
    let syncLabel: string | null = null;
    if (ts) {
      const diff = Date.now() - ts;
      const mins = Math.round(diff / 60_000);
      syncLabel = mins < 2 ? 'just now' : mins < 60 ? `${mins}m ago` : diff < 86_400_000 ? `${Math.round(diff / 3_600_000)}h ago` : `${Math.round(diff / 86_400_000)}d ago`;
    }

    return {
      weightKg, bodyFatPct, targetWeightKg, targetBodyFatPct, stepsToday,
      workoutMins, macroAdherencePct, macroTone, primaryPct, primaryLabel,
      sourceLabel, syncLabel, weeksToTarget,
      missingTargets: targetWeightKg == null || targetBodyFatPct == null,
    };
  }, [profile]);

  if (!visible || !data) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, new Date().toISOString()); } catch { /* ignore */ }
    setVisible(false);
  };

  const insight: string | null = coachDaily?.briefingText || coachDaily?.adaptationAction || null;
  const readinessLabel: string | null = coachDaily?.readinessLabel || null;

  const rowStyle: React.CSSProperties = {
    background: 'var(--notion-hover, rgba(0,0,0,0.04))',
    border: '1px solid var(--border, #e5e7eb)', borderRadius: 6,
    padding: '5px 8px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  };

  return (
    <div style={{ minWidth: 260 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>
          Daily Health Progress
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => navigate('/fitness')}
            style={{ background: 'none', border: 'none', padding: 0, fontSize: 10, color: 'var(--brand, #5f77dc)', cursor: 'pointer', textDecoration: 'underline' }}
          >
            View all
          </button>
          <button
            onClick={dismiss}
            title="Dismiss for 3 days"
            aria-label="Dismiss"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, padding: 0, background: 'transparent', border: 'none', borderRadius: 4, color: 'var(--muted)', cursor: 'pointer' }}
          >
            <X size={12} />
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={rowStyle}>
          <span style={{ fontSize: 12 }}>
            {data.weightKg != null ? `${data.weightKg.toFixed(1)} kg` : 'weight missing'}
            {' · '}
            {data.bodyFatPct != null ? `${data.bodyFatPct.toFixed(1)}% BF` : 'BF missing'}
            {data.targetBodyFatPct != null ? ` → ${data.targetBodyFatPct.toFixed(1)}%` : ''}
            {data.weeksToTarget != null ? ` · ${Math.round(data.weeksToTarget)}w ETA` : ''}
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
            {data.primaryPct != null ? `${data.primaryPct}% ` : '— '}{data.primaryLabel}
          </span>
        </div>
        <div style={rowStyle}>
          <span style={{ fontSize: 12 }}>Today</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            {data.stepsToday != null ? `${Math.round(data.stepsToday).toLocaleString()} steps` : 'no steps'}
            {data.workoutMins != null ? ` · ${Math.round(data.workoutMins)}m workout` : ''}
            {data.macroAdherencePct != null ? ` · ${data.macroAdherencePct}% macros` : ''}
            {data.syncLabel ? ` · synced ${data.syncLabel}` : ''}
          </span>
        </div>
        {insight && (
          <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
            <Sparkles size={11} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{readinessLabel && <strong>{readinessLabel} · </strong>}{insight}</span>
          </div>
        )}
        {data.missingTargets && (
          <button
            onClick={() => navigate('/settings?tab=profile')}
            style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, fontSize: 10, color: 'var(--brand, #5f77dc)', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Set targets
          </button>
        )}
      </div>
    </div>
  );
};

export default GlobalHealthProgressBanner;
