/**
 * Self-contained health progress banner for SidebarLayout.
 * Reads profiles/{uid} directly so it works on every page, not just Dashboard.
 * Shares the same localStorage dismiss key as Dashboard so dismissing on one
 * suppresses it everywhere for 3 days.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { Button, Card } from 'react-bootstrap';
import { Heart, Sparkles, X } from 'lucide-react';
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

  const bg = data.macroTone === 'success'
    ? 'linear-gradient(135deg, #198754 0%, #0f5132 100%)'
    : data.macroTone === 'warning'
      ? 'linear-gradient(135deg, #fd7e14 0%, #b35c00 100%)'
      : 'linear-gradient(135deg, #0d6efd 0%, #0b5ed7 100%)';

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, new Date().toISOString()); } catch { /* ignore */ }
    setVisible(false);
  };

  const insight: string | null = coachDaily?.briefingText || coachDaily?.adaptationAction || null;
  const readinessLabel: string | null = coachDaily?.readinessLabel || null;

  return (
    <Card className="mb-1 global-health-banner" style={{ background: bg, border: 'none', color: '#fff', boxShadow: '0 3px 10px rgba(13,110,253,0.15)' }}>
      <Card.Body style={{ padding: '6px 10px' }}>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <div style={{ width: 22, height: 22, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Heart size={12} />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Daily Health Progress</div>
            <div style={{ marginTop: 1, fontSize: 10, opacity: 0.9 }}>
              {data.weightKg     != null ? `${data.weightKg.toFixed(1)} kg`          : 'weight missing'}
              {' • '}
              {data.bodyFatPct   != null ? `${data.bodyFatPct.toFixed(1)}% BF`        : 'BF missing'}
              {' • '}
              {data.targetBodyFatPct != null ? `→ ${data.targetBodyFatPct.toFixed(1)}%` : 'set target'}
              {' • '}
              {data.weeksToTarget    != null ? `${Math.round(data.weeksToTarget)}w ETA` : 'ETA n/a'}
            </div>
          </div>
          <div style={{ textAlign: 'right', minWidth: 44 }}>
            <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1 }}>
              {data.primaryPct != null ? `${data.primaryPct}%` : '—'}
            </div>
            <div style={{ fontSize: 10, opacity: 0.85 }}>{data.primaryLabel}</div>
          </div>
          <button onClick={dismiss} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', cursor: 'pointer', padding: 3, borderRadius: 3, display: 'flex', alignItems: 'center', flexShrink: 0 }} title="Dismiss for 3 days">
            <X size={13} />
          </button>
        </div>
        {insight && (
          <div
            className="d-flex align-items-start gap-1"
            style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid rgba(255,255,255,0.2)', fontSize: 10, opacity: 0.95 }}
          >
            <Sparkles size={11} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              {readinessLabel && <strong>{readinessLabel} · </strong>}
              {insight}
            </div>
          </div>
        )}
        <div className="global-health-banner-second-row d-flex align-items-center justify-content-between gap-2 flex-wrap" style={{ marginTop: 3, fontSize: 10, opacity: 0.9 }}>
          <div>
            {data.stepsToday   != null && `${Math.round(data.stepsToday).toLocaleString()} steps`}
            {data.workoutMins  != null && ` • ${Math.round(data.workoutMins)}m workout`}
            {data.macroAdherencePct != null && ` • ${data.macroAdherencePct}% macros`}
            {data.syncLabel && ` • synced ${data.syncLabel}`}
          </div>
          <div className="d-flex align-items-center gap-1">
            {data.missingTargets && (
              <Button variant="light" size="sm" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => navigate('/settings?tab=profile')}>Set targets</Button>
            )}
            <Button variant="outline-light" size="sm" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => navigate('/fitness')}>Health</Button>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
};

export default GlobalHealthProgressBanner;
