/**
 * AiCoachPage — /ai-coach
 *
 * Agentic Ironman Coach. Works on top of the EXISTING goal hierarchy:
 *   Umbrella Goal (goalKind:'umbrella', theme:1)
 *     └─ Phase Goals (goalKind:'milestone', parentGoalId → umbrella)
 *
 * Setup path: if no umbrella goal is found the user is offered two choices:
 *   1. Quick-provision the 4-phase Ironman structure automatically
 *   2. Link an existing umbrella health goal they already created via Goals
 *
 * The coach reads coach_daily (written at 05:00 by CoachOrchestrator) and
 * surfaces what it *did today* — not just numbers, but explicit actions taken.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  limit,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { db, storage, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { saveFocusWizardPrefill } from '../../services/focusGoalsService';
import { CoachVerdictBanner } from './CoachVerdictBanner';
import { AiCoachPhotoGallery } from './AiCoachPhotoGallery';
import FitnessKpiGrid from '../fitness/FitnessKpiGrid';
import type { CoachDaily } from '../../types/CoachTypes';

// ─── Weekly sport helpers (shared with MetricsPage) ────────────────────────────
function getISOWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
function getLast12WeekKeys(): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i * 7);
    keys.push(getISOWeekKey(d));
  }
  return keys;
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// ─── Readiness Gauge ──────────────────────────────────────────────────────────

const ReadinessGauge: React.FC<{
  score: number; label: string; hrv: number | null; sleep: number | null;
  adaptedToday?: string | null;
}> = ({ score, label, hrv, sleep, adaptedToday }) => {
  const pct = Math.round(score * 100);
  const colour =
    label === 'green' ? 'var(--bs-success)' :
    label === 'amber' ? 'var(--bs-warning)' : 'var(--bs-danger)';
  const badgeCls =
    label === 'green' ? 'bg-success' :
    label === 'amber' ? 'bg-warning text-dark' : 'bg-danger';
  const circumference = 2 * Math.PI * 40;
  const dashOffset = circumference - (pct / 100) * circumference;

  return (
    <div className="card border-0 shadow-sm">
      <div className="card-body">
        <div className="d-flex align-items-center justify-content-between mb-3">
          <h6 className="card-subtitle text-muted mb-0">Today's Readiness</h6>
          <span className={`badge ${badgeCls} text-uppercase`} style={{ fontSize: '0.7rem', letterSpacing: '0.05em' }}>
            {label}
          </span>
        </div>
        <div className="d-flex align-items-center gap-4">
          <svg width="90" height="90" viewBox="0 0 100 100" className="flex-shrink-0">
            <circle cx="50" cy="50" r="40" fill="none" stroke="var(--bs-border-color)" strokeWidth="10" />
            <circle
              cx="50" cy="50" r="40"
              fill="none"
              stroke={colour}
              strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
              style={{ transition: 'stroke-dashoffset 0.6s ease' }}
            />
            <text x="50" y="54" textAnchor="middle" fontSize="18" fontWeight="bold" fill={colour}>
              {pct}%
            </text>
          </svg>
          <div className="vstack gap-1 small">
            <div className="d-flex gap-2">
              <span className="text-muted">HRV</span>
              <strong>{hrv !== null ? `${Math.round(hrv)}ms` : '—'}</strong>
            </div>
            <div className="d-flex gap-2">
              <span className="text-muted">Sleep</span>
              <strong>{sleep !== null ? `${sleep.toFixed(1)}h` : '—'}</strong>
            </div>
          </div>
        </div>
        {adaptedToday && (
          <div className="alert alert-warning alert-sm p-2 mb-0 mt-3 small d-flex align-items-center gap-2">
            <span>⚡</span>
            <span><strong>Coach action:</strong> {adaptedToday}</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Macro Card ───────────────────────────────────────────────────────────────

const MacroBar: React.FC<{
  label: string; current: number | null; target: number; variant: string;
}> = ({ label, current, target, variant }) => {
  const pct = current !== null ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <div>
      <div className="d-flex justify-content-between small mb-1">
        <span className="text-muted">{label}</span>
        <span className="fw-medium">
          {current !== null ? Math.round(current) : '—'}/{target}g
        </span>
      </div>
      <div className="progress" style={{ height: '6px' }}>
        <div
          className={`progress-bar bg-${variant}`}
          role="progressbar"
          style={{ width: `${pct}%` }}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
};

// ─── Phase Card ───────────────────────────────────────────────────────────────

const PhaseCard: React.FC<{
  phase: CoachDaily['phase'];
  coachData: CoachDaily;
  weeklyKpiRows?: any[];
  onNavigate?: (path: string) => void;
}> = ({ phase, coachData, weeklyKpiRows, onNavigate }) => {
  const [phaseGoal, setPhaseGoal] = useState<any>(null);

  useEffect(() => {
    if (!phase?.phaseGoalId) return;
    const unsub = onSnapshot(doc(db, 'goals', phase.phaseGoalId), snap => {
      if (snap.exists()) setPhaseGoal({ id: snap.id, ...snap.data() });
    });
    return unsub;
  }, [phase?.phaseGoalId]);

  if (!phase?.phaseName) return null;

  const progress = phase.totalDaysInPhase > 0
    ? Math.round((phase.dayInPhase / phase.totalDaysInPhase) * 100)
    : 0;
  const kpisV2: any[] = phaseGoal?.kpisV2 || [];

  return (
    <div className="card border-0 shadow-sm">
      <div className="card-body">
        <div className="d-flex align-items-start justify-content-between mb-3">
          <div>
            <h6 className="text-muted mb-0" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Active Phase
            </h6>
            <div className="fw-semibold mt-1">{phase.phaseName}</div>
          </div>
          <div className="text-end">
            <div className="fs-4 fw-bold text-primary">{progress}%</div>
            <div className="text-muted" style={{ fontSize: '0.75rem' }}>
              Day {phase.dayInPhase}/{phase.totalDaysInPhase}
            </div>
            {coachData.fitnessLevel && (
              <span className="badge bg-success-subtle text-success mt-1" style={{ fontSize: '0.7rem' }}>
                {coachData.fitnessLevel}
              </span>
            )}
          </div>
        </div>

        <div className="progress mb-3" style={{ height: '8px' }}>
          <div
            className="progress-bar bg-primary"
            role="progressbar"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Weekly sport KPI grid (12 weeks) */}
        {weeklyKpiRows && weeklyKpiRows.length > 0 && (
          <div className="mb-3">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--bs-secondary)' }}>
                Weekly targets — 12 weeks
              </span>
              {onNavigate && (
                <button
                  className="btn btn-link btn-sm p-0 text-muted"
                  style={{ fontSize: '0.7rem' }}
                  onClick={() => onNavigate('/metrics')}
                >
                  Full metrics →
                </button>
              )}
            </div>
            <FitnessKpiGrid rows={weeklyKpiRows} />
          </div>
        )}

        {/* Phase KPIs */}
        {kpisV2.length > 0 && (
          <div>
            <div className="text-muted mb-2" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Phase KPIs
            </div>
            <div className="vstack gap-2">
              {kpisV2.map((kpi: any) => {
                const current = kpi.current ?? null;
                const pct = (current !== null && kpi.target > 0)
                  ? Math.min(100, Math.round((current / kpi.target) * 100)) : null;
                const variant =
                  !pct ? 'secondary' :
                  pct >= 100 ? 'success' :
                  pct >= 80 ? 'primary' :
                  pct >= 50 ? 'warning' : 'danger';
                return (
                  <div key={kpi.id}>
                    <div className="d-flex justify-content-between small mb-1">
                      <span className="text-muted">{kpi.name}</span>
                      <span className={`text-${variant} fw-medium`}>
                        {current !== null
                          ? `${typeof current === 'number' ? current.toFixed(1) : current}${kpi.unit}`
                          : '—'}
                        /{kpi.target}{kpi.unit}
                        {pct !== null ? ` · ${pct}%` : ''}
                      </span>
                    </div>
                    <div className="progress" style={{ height: '5px' }}>
                      <div
                        className={`progress-bar bg-${variant}`}
                        role="progressbar"
                        style={{ width: `${pct ?? 0}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {phaseGoal?.kpisLastSyncedAt && (
              <div className="text-muted mt-2" style={{ fontSize: '0.7rem' }}>
                KPIs synced{' '}
                {new Date(phaseGoal.kpisLastSyncedAt?.toMillis?.() ?? 0)
                  .toLocaleDateString('en-GB')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Setup Screen ─────────────────────────────────────────────────────────────
// Does NOT duplicate the FocusGoalWizard — it offers two lightweight paths:
//   A) Quick-provision the 4-phase structure (calls provisionIronmanGoals)
//   B) Link an existing umbrella health goal the user created in Goals

const SetupScreen: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid;
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusGoalEnd, setFocusGoalEnd] = useState<string | null>(null);
  const [focusGoalEndMs, setFocusGoalEndMs] = useState<number | null>(null);
  const [umbrellaGoals, setUmbrellaGoals] = useState<any[]>([]);
  const [selectedGoalId, setSelectedGoalId] = useState('');
  const [showManualDate, setShowManualDate] = useState(false);
  const [raceDate, setRaceDate] = useState('');

  // Optional race events — pre-filled with sensible defaults
  const defaultSprintTri = new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0];
  const [sprintTriDate, setSprintTriDate] = useState(defaultSprintTri);
  const [sprintTriTitle, setSprintTriTitle] = useState('Sprint Triathlon');
  const [halfIronDate, setHalfIronDate] = useState('2027-05-15');
  const [halfIronTitle, setHalfIronTitle] = useState('70.3 Half Ironman');

  useEffect(() => {
    if (!uid) return;
    getDocs(query(
      collection(db, 'focusGoals'),
      where('ownerUid', '==', uid),
      where('isActive', '==', true),
    )).then(snap => {
      if (!snap.empty) {
        const fg = snap.docs[0].data();
        const endMs = fg.endDate?.toMillis?.() ?? (typeof fg.endDate === 'number' ? fg.endDate : null);
        if (endMs) {
          setFocusGoalEndMs(endMs);
          setFocusGoalEnd(new Date(endMs).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'long', year: 'numeric',
          }));
        }
      }
    });
    getDocs(query(
      collection(db, 'goals'),
      where('ownerUid', '==', uid),
      where('goalKind', '==', 'umbrella'),
    )).then(snap => {
      setUmbrellaGoals(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [uid]);

  const handleQuickProvision = async () => {
    setLoading(true);
    setError(null);
    try {
      const raceEvents = [];
      if (sprintTriDate) raceEvents.push({ title: sprintTriTitle || 'Sprint Triathlon', date: sprintTriDate });
      if (halfIronDate) raceEvents.push({ title: halfIronTitle || '70.3 Half Ironman', date: halfIronDate });
      await httpsCallable(functions, 'provisionIronmanGoals')({
        raceDate: raceDate || undefined,
        raceEvents,
      });
      onComplete();
    } catch (e: any) {
      setError(e?.message || 'Setup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLinkExisting = async () => {
    if (!selectedGoalId || !uid) return;
    setLinking(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'profiles', uid), {
        ironmanUmbrellaGoalId: selectedGoalId,
      });
      onComplete();
    } catch (e: any) {
      setError(e?.message || 'Link failed. Please try again.');
    } finally {
      setLinking(false);
    }
  };

  const openFocusWizard = () => {
    saveFocusWizardPrefill({
      visionText: 'Complete Ironman training programme',
      timeframe: 'year',
      source: 'coach_setup',
    });
    navigate('/focus-goals?from=coach');
  };

  return (
    <div className="container-fluid py-4" style={{ maxWidth: 640 }}>
      <div className="text-center mb-4">
        <div style={{ fontSize: '3rem' }}>🏊‍♂️</div>
        <h4 className="fw-bold mt-2 mb-1">Ironman Coach</h4>
        <p className="text-muted small mb-0">
          The coach works on top of your Focus Goals — no separate system to learn.
        </p>
      </div>

      <div className="alert alert-info small mb-4">
        <strong>How it works:</strong> The coach reads your active Focus Goal's end date as your
        race date, then creates a 4-phase training structure (Base → Build → Peak → Taper) in your
        Goals. Each morning at 05:00 it reads your HealthKit + Strava data and takes action —
        adapting workouts, scaling macros, and sending your Telegram briefing.
      </div>

      {error && <div className="alert alert-danger small">{error}</div>}

      <div className="vstack gap-3">
        {/* Step 1 — Focus Goal */}
        <div className={`card ${focusGoalEnd ? 'border-success' : 'border-primary border-2'}`}>
          <div className="card-body">
            <div className="d-flex align-items-center gap-2 mb-2">
              <span className={`badge ${focusGoalEnd ? 'bg-success' : 'bg-primary'}`}>Step 1</span>
              <h6 className="fw-semibold mb-0">Set your race date via Focus Goal Wizard</h6>
            </div>
            {focusGoalEnd ? (
              <div className="d-flex align-items-center gap-2 small">
                <span className="text-success">✓</span>
                <span>Race date: <strong>{focusGoalEnd}</strong> (from your active Focus Goal)</span>
              </div>
            ) : (
              <>
                <p className="text-muted small mb-3">
                  The wizard creates a year-long focus period ending on your race date. The coach
                  reads this end date to set up your 18-month training window.
                </p>
                <div className="d-flex gap-2 flex-wrap">
                  <button className="btn btn-primary btn-sm" onClick={openFocusWizard}>
                    Open Focus Goal Wizard →
                  </button>
                  <button
                    className="btn btn-link btn-sm text-muted p-0"
                    onClick={() => setShowManualDate(v => !v)}
                  >
                    Enter date manually instead
                  </button>
                </div>
                {showManualDate && (
                  <div className="mt-3">
                    <label className="form-label small fw-medium mb-1">Race Date</label>
                    <input
                      type="date"
                      className="form-control form-control-sm"
                      value={raceDate}
                      min={new Date().toISOString().split('T')[0]}
                      onChange={e => setRaceDate(e.target.value)}
                      style={{ maxWidth: 200 }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Step 2 — Provision */}
        <div className={`card ${!focusGoalEnd && !raceDate ? 'opacity-50' : 'border-primary border-2'}`}>
          <div className="card-body">
            <div className="d-flex align-items-center gap-2 mb-2">
              <span className="badge bg-primary">Step 2</span>
              <h6 className="fw-semibold mb-0">Create your 4-phase training structure</h6>
            </div>
            <p className="text-muted small mb-3">
              Creates <em>Ironman Programme</em> in your Goals with four phase milestones —
              Base, Build, Peak, and Taper — each with fitness KPIs that sync nightly from Strava.
              Takes 5 seconds.
            </p>

            {/* Optional race events */}
            <div className="mb-3">
              <p className="small fw-medium mb-2">Race events <span className="text-muted fw-normal">(optional — shown as star markers on the timeline)</span></p>
              <div className="vstack gap-2">
                <div className="d-flex gap-2 align-items-center flex-wrap">
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    style={{ maxWidth: 180 }}
                    value={sprintTriTitle}
                    onChange={e => setSprintTriTitle(e.target.value)}
                    placeholder="Sprint Triathlon"
                  />
                  <input
                    type="date"
                    className="form-control form-control-sm"
                    style={{ maxWidth: 160 }}
                    value={sprintTriDate}
                    onChange={e => setSprintTriDate(e.target.value)}
                  />
                  <span className="text-muted small">Phase 0 target</span>
                </div>
                <div className="d-flex gap-2 align-items-center flex-wrap">
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    style={{ maxWidth: 180 }}
                    value={halfIronTitle}
                    onChange={e => setHalfIronTitle(e.target.value)}
                    placeholder="70.3 Half Ironman"
                  />
                  <input
                    type="date"
                    className="form-control form-control-sm"
                    style={{ maxWidth: 160 }}
                    value={halfIronDate}
                    onChange={e => setHalfIronDate(e.target.value)}
                  />
                  <span className="text-muted small">Phase 2 target</span>
                </div>
              </div>
            </div>

            <button
              className="btn btn-primary btn-sm"
              onClick={handleQuickProvision}
              disabled={loading || (!focusGoalEnd && !raceDate)}
            >
              {loading ? (
                <><span className="spinner-border spinner-border-sm me-2" />Setting up…</>
              ) : '🚀 Create 4-phase structure'}
            </button>
          </div>
        </div>

        {/* Link existing goal */}
        {umbrellaGoals.length > 0 && (
          <div className="card">
            <div className="card-body">
              <h6 className="fw-semibold mb-1 small">
                🔗 Or link an existing umbrella goal
              </h6>
              <p className="text-muted small mb-2">
                You already have an umbrella goal — link it instead of creating a new one.
              </p>
              <div className="d-flex gap-2">
                <select
                  className="form-select form-select-sm"
                  value={selectedGoalId}
                  onChange={e => setSelectedGoalId(e.target.value)}
                >
                  <option value="">Select a goal…</option>
                  {umbrellaGoals.map((g: any) => (
                    <option key={g.id} value={g.id}>{g.title}</option>
                  ))}
                </select>
                <button
                  className="btn btn-outline-primary btn-sm text-nowrap"
                  onClick={handleLinkExisting}
                  disabled={!selectedGoalId || linking}
                >
                  {linking ? <span className="spinner-border spinner-border-sm" /> : 'Link'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Training Programmes ─────────────────────────────────────────────────────

const TrainingProgrammesSection: React.FC<{ uid: string }> = ({ uid }) => {
  const [runnerUrl, setRunnerUrl] = useState('');
  const [crossFitUrl, setCrossFitUrl] = useState('');
  const [lastPolled, setLastPolled] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getDoc(doc(db, 'profiles', uid)).then(snap => {
      const d = snap.data();
      setRunnerUrl(d?.runnerProgrammeUrl || '');
      setCrossFitUrl(d?.crossFitProgrammeUrl || '');
    });
    getDoc(doc(db, 'fitness_programme_cache', uid)).then(snap => {
      if (snap.exists()) {
        const ts = snap.data()?.lastPolledAt;
        const d = ts?.toDate?.() ?? null;
        setLastPolled(d);
      }
    });
  }, [uid]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'profiles', uid), {
        runnerProgrammeUrl: runnerUrl.trim() || null,
        crossFitProgrammeUrl: crossFitUrl.trim() || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card border-0 shadow-sm">
      <div className="card-body">
        <h6 className="text-muted mb-3" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Training Programmes
        </h6>
        <p className="text-muted small mb-3">
          Provide iCal feed URLs for your training apps. The coach polls these every 2 hours,
          creates calendar blocks, and includes them in your morning briefing and daily email.
        </p>
        <div className="vstack gap-3">
          <div>
            <label className="form-label small fw-medium mb-1">Runner Programme iCal URL</label>
            <input
              type="url"
              className="form-control form-control-sm"
              placeholder="webcal:// or https://..."
              value={runnerUrl}
              onChange={e => setRunnerUrl(e.target.value)}
            />
            <div className="form-text small">From the Runner app: Share Plan → Copy iCal Link</div>
          </div>
          <div>
            <label className="form-label small fw-medium mb-1">CrossFit Programme iCal URL</label>
            <input
              type="url"
              className="form-control form-control-sm"
              placeholder="webcal:// or https://..."
              value={crossFitUrl}
              onChange={e => setCrossFitUrl(e.target.value)}
            />
            <div className="form-text small">From your CrossFit gym's booking system iCal export</div>
          </div>
          <div className="d-flex align-items-center justify-content-between">
            <button
              className={`btn btn-sm ${saved ? 'btn-success' : 'btn-primary'}`}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? (
                <><span className="spinner-border spinner-border-sm me-1" />Saving…</>
              ) : saved ? '✓ Saved' : 'Save'}
            </button>
            {lastPolled && (
              <span className="text-muted small">
                Last synced: {lastPolled.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Coach Actions Log (what the coach ACTUALLY DID today) ───────────────────

const CoachActionsToday: React.FC<{ coachData: CoachDaily }> = ({ coachData }) => {
  const actions: { icon: string; text: string; variant: string }[] = [];

  if (coachData.readinessLabel === 'red') {
    actions.push({ icon: '🛌', text: 'Replaced today\'s session with Rest / Active Recovery (readiness < 60%)', variant: 'danger' });
  } else if (coachData.readinessLabel === 'amber') {
    actions.push({ icon: '⬇️', text: 'Reduced today\'s session intensity by 30% (readiness 60–80%)', variant: 'warning' });
  } else {
    actions.push({ icon: '✅', text: 'Readiness green — no workout changes needed', variant: 'success' });
  }

  if (coachData.macros?.tomorrowTrainingType) {
    const t = coachData.macros.tomorrowTrainingType.replace('_', ' ');
    actions.push({ icon: '🍽️', text: `Carbs scaled for tomorrow's ${t}`, variant: 'info' });
  }

  if ((coachData.macros?.proteinG ?? 0) > 0) {
    actions.push({
      icon: '💪',
      text: `Protein floor set at ${coachData.macros!.proteinG}g (2g/kg LBM)`,
      variant: 'primary',
    });
  }

  return (
    <div className="card border-0 shadow-sm">
      <div className="card-body">
        <h6 className="text-muted mb-3" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          What the coach did today
        </h6>
        <div className="vstack gap-2">
          {actions.map((a, i) => (
            <div key={i} className={`d-flex align-items-start gap-2 small text-${a.variant}`}>
              <span>{a.icon}</span>
              <span>{a.text}</span>
            </div>
          ))}
        </div>
        {coachData.updatedAt && (
          <div className="text-muted mt-3" style={{ fontSize: '0.7rem' }}>
            Last updated:{' '}
            {new Date(
              coachData.updatedAt?.toMillis?.() ?? coachData.updatedAt
            ).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Steps Card ──────────────────────────────────────────────────────────────

const STEP_TARGET = 12000;

const StepsCard: React.FC<{ stepsToday: number | null; uid: string }> = ({ stepsToday, uid }) => {
  const pct = stepsToday !== null ? Math.min(100, Math.round((stepsToday / STEP_TARGET) * 100)) : 0;
  const colour = pct >= 100 ? 'success' : pct >= 50 ? 'primary' : 'warning';
  const remaining = stepsToday !== null ? Math.max(0, STEP_TARGET - stepsToday) : null;

  const handleManualSteps = async () => {
    const input = window.prompt('Enter today\'s step count:');
    const val = input ? parseInt(input.replace(/[^0-9]/g, ''), 10) : NaN;
    if (!Number.isFinite(val) || val < 0) return;
    try {
      await updateDoc(doc(db, 'profiles', uid), { stepsToday: val });
    } catch (e) {
      console.warn('[StepsCard] manual entry failed', e);
    }
  };

  return (
    <div className="card border-0 shadow-sm">
      <div className="card-body">
        <div className="d-flex align-items-center justify-content-between mb-1">
          <h6 className="text-muted mb-0" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Daily Step Goal — 12,000
          </h6>
          <span className="text-muted small" style={{ cursor: 'pointer' }} onClick={handleManualSteps} title="Tap to enter manually">
            {stepsToday !== null ? stepsToday.toLocaleString() : '—'} / {STEP_TARGET.toLocaleString()}
          </span>
        </div>
        <div className="progress" style={{ height: '8px' }}>
          <div
            className={`progress-bar bg-${colour}`}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{ width: `${pct}%`, transition: 'width 0.4s ease' }}
          />
        </div>
        <div className="d-flex justify-content-between mt-1" style={{ fontSize: '0.7rem', color: 'var(--bs-secondary)' }}>
          <span>Progress toward 12,000 steps today</span>
          {stepsToday !== null && remaining !== null && remaining > 0 && (
            <span>{remaining.toLocaleString()} to go (~{Math.round(remaining / 100)} min walk)</span>
          )}
          {stepsToday !== null && remaining !== null && remaining <= 0 && (
            <span className="text-success">Goal hit ✓</span>
          )}
          {stepsToday === null && (
            <span style={{ cursor: 'pointer' }} onClick={handleManualSteps}>Syncs from Apple Health · tap to enter manually</span>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Manual Protein Entry ─────────────────────────────────────────────────────

const ManualProteinCard: React.FC<{
  proteinTarget: number;
  proteinActual: number | null;
  uid: string;
}> = ({ proteinTarget, proteinActual, uid }) => {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Only show if Apple Health hasn't already provided actuals
  if (proteinActual !== null) return null;

  const handleSave = async () => {
    const val = parseFloat(value);
    if (!Number.isFinite(val) || val < 0) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'profiles', uid), { manualProteinG: val });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      setValue('');
    } catch (e) {
      console.warn('[ManualProtein] save failed', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card border-0 shadow-sm">
      <div className="card-body">
        <h6 className="text-muted mb-2" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Log Protein Manually
        </h6>
        <p className="text-muted small mb-2">
          Target: {proteinTarget}g. When MyFitnessPal or a nutrition app is connected to Apple Health on your iPhone,
          protein is synced automatically — this entry is a fallback for when it isn't.
        </p>
        <div className="input-group input-group-sm">
          <input
            type="number"
            className="form-control"
            placeholder={`e.g. ${Math.round(proteinTarget * 0.7)}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={{ maxWidth: '120px' }}
          />
          <span className="input-group-text">g</span>
          <button
            className="btn btn-outline-success"
            disabled={saving || !value}
            onClick={handleSave}
          >
            {saving ? '…' : saved ? '✓ Saved' : 'Log'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export const AiCoachPage: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const uid = currentUser?.uid;
  const [hasUmbrella, setHasUmbrella] = useState<boolean | null>(null);
  const [umbrellaGoalId, setUmbrellaGoalId] = useState<string | null>(null);
  const [phaseGoals, setPhaseGoals] = useState<any[]>([]);
  const [coachData, setCoachData] = useState<CoachDaily | null>(null);
  const [weeklyPromptActive, setWeeklyPromptActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [workouts, setWorkouts] = useState<any[]>([]);
  const [lastHealthKitSync, setLastHealthKitSync] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const today = todayStr();

  // Detect umbrella goal — profile first (fast), then goals query (fallback)
  useEffect(() => {
    if (!uid) return;
    getDoc(doc(db, 'profiles', uid)).then(snap => {
      const profile = snap.data();
      if (profile?.ironmanUmbrellaGoalId) {
        setHasUmbrella(true);
        setUmbrellaGoalId(profile.ironmanUmbrellaGoalId);
      } else {
        // Fallback: any umbrella health goal
        getDocs(query(
          collection(db, 'goals'),
          where('ownerUid', '==', uid),
          where('goalKind', '==', 'umbrella'),
        )).then(gs => {
          setHasUmbrella(!gs.empty);
          if (!gs.empty) setUmbrellaGoalId(gs.docs[0].id);
        });
      }
    });
  }, [uid]);

  // Load phase goals directly so they show immediately (not gated on coachData)
  useEffect(() => {
    if (!uid || !umbrellaGoalId) return;
    getDocs(query(
      collection(db, 'goals'),
      where('ownerUid', '==', uid),
      where('parentGoalId', '==', umbrellaGoalId),
    )).then(snap => {
      const sorted = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => (a.startDate ?? 0) - (b.startDate ?? 0));
      setPhaseGoals(sorted);
    });
  }, [uid, umbrellaGoalId]);

  // Subscribe to today's coach_daily doc
  useEffect(() => {
    if (!uid || !hasUmbrella) return;
    const unsub = onSnapshot(doc(db, 'coach_daily', `${uid}_${today}`), snap => {
      if (snap.exists()) setCoachData(snap.data() as CoachDaily);
    });
    return unsub;
  }, [uid, hasUmbrella, today]);

  // Coach data is written nightly at 05:00 by runCoachOrchestratorNightly.
  // Do not call getCoachToday from the UI — it causes errors before goals are provisioned.

  // Weekly photo prompt
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(doc(db, 'coach_weekly_prompts', uid), snap => {
      if (snap.exists()) setWeeklyPromptActive(snap.data()?.promptActive === true);
    });
    return unsub;
  }, [uid]);

  // Load workouts for weekly KPI grid
  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, 'metrics_workouts'),
      where('ownerUid', '==', uid),
      orderBy('startDate', 'desc'),
      limit(2000)
    );
    return onSnapshot(q, snap => {
      setWorkouts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => setWorkouts([]));
  }, [uid]);

  // Track last HealthKit sync from health_metrics — most recently updated doc
  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, 'health_metrics'),
      where('ownerUid', '==', uid),
      orderBy('updatedAt', 'desc'),
      limit(1)
    );
    return onSnapshot(q, snap => {
      if (snap.empty) { setLastHealthKitSync(null); return; }
      const d = snap.docs[0].data();
      const ts = d.updatedAt?.toMillis?.() ?? (typeof d.updatedAt === 'number' ? d.updatedAt : null);
      setLastHealthKitSync(ts);
    }, () => setLastHealthKitSync(null));
  }, [uid]);

  // Compute weekly sport KPI grid from workouts
  const weeklyKpiRows = useMemo(() => {
    const weekKeys = getLast12WeekKeys();
    const byWeek: Record<string, { run_m: number; swim_m: number; cycle_m: number }> = {};
    weekKeys.forEach(k => { byWeek[k] = { run_m: 0, swim_m: 0, cycle_m: 0 }; });
    for (const w of workouts) {
      const startMs = typeof w.startDate === 'number' ? w.startDate : (w.startDate?.toMillis?.() ?? 0);
      if (!startMs) continue;
      const wk = getISOWeekKey(new Date(startMs));
      if (!byWeek[wk]) continue;
      const dist = Number(w.distance_m || 0);
      const sport = String(w.sportType || w.type || '').toLowerCase();
      if (sport.includes('run') || sport.includes('walk')) byWeek[wk].run_m += dist;
      else if (sport.includes('swim')) byWeek[wk].swim_m += dist;
      else if (sport.includes('cycl') || sport.includes('ride') || sport.includes('bike')) byWeek[wk].cycle_m += dist;
    }
    const runKms   = weekKeys.map(k => byWeek[k].run_m   / 1000);
    const swimKms  = weekKeys.map(k => byWeek[k].swim_m  / 1000);
    const cycleKms = weekKeys.map(k => byWeek[k].cycle_m / 1000);
    const h12 = (vals: number[], t: number) => vals.filter(v => v >= t).length;
    return [
      { label: 'Run  30km/wk',  summaryText: `${h12(runKms,   30)}/12 weeks hit target`, boxes: weekKeys.map((k, i) => ({ key: k, pct: runKms[i]   > 0 ? Math.round((runKms[i]   / 30) * 100) : null, tooltip: `${k}: ${runKms[i].toFixed(1)} km`   })) },
      { label: 'Swim  4km/wk',  summaryText: `${h12(swimKms,   4)}/12 weeks hit target`, boxes: weekKeys.map((k, i) => ({ key: k, pct: swimKms[i]  > 0 ? Math.round((swimKms[i]  /  4) * 100) : null, tooltip: `${k}: ${swimKms[i].toFixed(2)} km`  })) },
      { label: 'Cycle 50km/wk', summaryText: `${h12(cycleKms, 50)}/12 weeks hit target`, boxes: weekKeys.map((k, i) => ({ key: k, pct: cycleKms[i] > 0 ? Math.round((cycleKms[i] / 50) * 100) : null, tooltip: `${k}: ${cycleKms[i].toFixed(1)} km` })) },
    ];
  }, [workouts]);

  const dismissWeeklyPrompt = async () => {
    if (!uid) return;
    await updateDoc(doc(db, 'coach_weekly_prompts', uid), { promptActive: false });
    setWeeklyPromptActive(false);
  };

  const handlePhotoUpload = useCallback(async (file: File) => {
    if (!uid) return;
    setUploading(true);
    setUploadError(null);
    try {
      const timestamp = Date.now();
      const ext = file.name.split('.').pop() || 'jpg';
      const storagePath = `coach-photos/${uid}/${timestamp}.${ext}`;
      await uploadBytes(ref(storage, storagePath), file);
      await getDownloadURL(ref(storage, storagePath)); // confirm accessible
      await httpsCallable(functions, 'analyzeBodyPhoto')({ storagePath });
    } catch (e: any) {
      setUploadError(e?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [uid]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handlePhotoUpload(file);
    e.target.value = '';
  };

  if (hasUmbrella === null) {
    return (
      <div className="d-flex align-items-center justify-content-center py-5 text-muted small">
        <span className="spinner-border spinner-border-sm me-2" />
        Loading coach…
      </div>
    );
  }

  if (hasUmbrella === false) {
    return <SetupScreen onComplete={() => setHasUmbrella(true)} />;
  }

  const macros = coachData?.macros;
  const phase = coachData?.phase;

  return (
    <div className="container-fluid py-3" style={{ maxWidth: 680 }}>
      {/* Header */}
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <h4 className="fw-bold mb-0">🏊‍♂️ Ironman Coach</h4>
          <p className="text-muted small mb-0">
            Proactive. Agentic. Daily at 05:00.
            {lastHealthKitSync !== null && (
              <span className="ms-2" style={{ fontSize: '0.7rem', color: 'var(--bs-secondary)' }}>
                · HealthKit synced {(() => {
                  const diffMs = Date.now() - lastHealthKitSync;
                  const diffMins = Math.round(diffMs / 60000);
                  const diffHrs  = Math.round(diffMs / 3600000);
                  const diffDays = Math.round(diffMs / 86400000);
                  if (diffMins < 2)   return 'just now';
                  if (diffMins < 60)  return `${diffMins}m ago`;
                  if (diffHrs  < 24)  return `${diffHrs}h ago`;
                  return `${diffDays}d ago`;
                })()}
              </span>
            )}
            {lastHealthKitSync === null && (
              <span className="ms-2" style={{ fontSize: '0.7rem', color: 'var(--bs-secondary)' }}>
                · HealthKit: no data — open BOB on iPhone to sync
              </span>
            )}
          </p>
        </div>
        <div className="d-flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="btn btn-sm btn-outline-secondary"
          >
            {uploading ? (
              <><span className="spinner-border spinner-border-sm me-1" />Uploading…</>
            ) : '📷 Photo'}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="d-none"
          onChange={handleFileChange}
        />
      </div>

      {/* Verdict banner (integrates with existing BOB banner system) */}
      <CoachVerdictBanner />

      {/* Weekly photo prompt */}
      {weeklyPromptActive && (
        <div className="alert alert-secondary d-flex align-items-center justify-content-between mb-3">
          <span className="small">📸 Monday check-in — upload your weekly progress photo</span>
          <div className="d-flex gap-2">
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => fileInputRef.current?.click()}
            >
              Upload
            </button>
            <button className="btn-close" onClick={dismissWeeklyPrompt} />
          </div>
        </div>
      )}

      {uploadError && (
        <div className="alert alert-danger small mb-3">{uploadError}</div>
      )}

      <div className="vstack gap-3">
        {/* Readiness */}
        {coachData ? (
          <ReadinessGauge
            score={coachData.readinessScore}
            label={coachData.readinessLabel}
            hrv={coachData.hrvToday}
            sleep={coachData.sleepToday}
            adaptedToday={
              coachData.readinessLabel === 'red'
                ? 'Replaced session with Rest / Active Recovery'
                : coachData.readinessLabel === 'amber'
                ? 'Reduced session intensity by 30%'
                : null
            }
          />
        ) : (
          <div className="card border-0 shadow-sm">
            <div className="card-body py-3">
              <div className="d-flex align-items-center gap-3 mb-3">
                <div style={{ fontSize: '2rem' }}>✅</div>
                <div>
                  <div className="fw-semibold">Coach is set up</div>
                  <div className="text-muted small">Daily briefing runs at 05:00 — today's data will appear here tomorrow morning.</div>
                </div>
              </div>
              {phaseGoals.length > 0 && (
                <div className="border rounded p-2 small">
                  <div className="text-muted fw-semibold mb-2" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Training phases created
                  </div>
                  {phaseGoals.map((g: any, i: number) => {
                    const start = g.startDate ? new Date(g.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
                    const end = g.endDate ? new Date(g.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
                    const isActive = g.startDate && g.endDate && g.startDate <= Date.now() && g.endDate >= Date.now();
                    return (
                      <div key={g.id} className={`d-flex align-items-center gap-2 py-1 ${i < phaseGoals.length - 1 ? 'border-bottom' : ''}`}>
                        <span className={`badge ${isActive ? 'bg-success' : 'bg-secondary'}`} style={{ fontSize: '0.6rem', minWidth: 48 }}>
                          {isActive ? 'Active' : `Phase ${i}`}
                        </span>
                        <span className="fw-medium">{g.title}</span>
                        <span className="text-muted ms-auto">{start} – {end}</span>
                      </div>
                    );
                  })}
                  <div className="mt-2">
                    <a href="/goals" className="text-decoration-none small">View in Goals →</a>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* What the coach did today */}
        {coachData && <CoachActionsToday coachData={coachData} />}

        {/* Phase card */}
        {phase && coachData && (
          <PhaseCard
            phase={phase}
            coachData={coachData}
            weeklyKpiRows={weeklyKpiRows.length > 0 ? weeklyKpiRows : undefined}
            onNavigate={navigate}
          />
        )}

        {/* Macros */}
        {macros && (
          <div className="card border-0 shadow-sm">
            <div className="card-body">
              <div className="d-flex align-items-center justify-content-between mb-3">
                <h6 className="text-muted mb-0" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Today's Macro Targets
                </h6>
                {coachData?.currentBodyFatPct != null && (
                  <span className="badge bg-secondary-subtle text-secondary small">
                    BF {coachData.currentBodyFatPct.toFixed(1)}% · {coachData.currentWeightKg?.toFixed(1)}kg
                  </span>
                )}
              </div>
              <div className="vstack gap-3">
                <MacroBar label="Protein" current={macros.proteinActualG ?? null} target={macros.proteinG} variant="success" />
                <MacroBar label="Carbohydrates" current={macros.carbActualG ?? null} target={macros.carbG} variant="primary" />
                <MacroBar label="Fat" current={macros.fatActualG ?? null} target={macros.fatG} variant="warning" />
              </div>
              <div className="text-muted small mt-2 pt-2 border-top">
                TDEE ~{macros.tdeeKcal} kcal · Tomorrow: {macros.tomorrowTrainingType.replace('_', ' ')}
                {macros.proteinActualG === null && (
                  <span className="ms-2 text-warning">· Sync Apple Health to see actuals</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Steps today */}
        {coachData && (
          <StepsCard stepsToday={(coachData as any).stepsToday ?? null} uid={uid!} />
        )}

        {/* Manual protein entry */}
        {macros && uid && (
          <ManualProteinCard
            proteinTarget={macros.proteinG}
            proteinActual={macros.proteinActualG}
            uid={uid}
          />
        )}

        {/* Photo gallery */}
        <div className="card border-0 shadow-sm">
          <div className="card-body">
            <h6 className="text-muted mb-3" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Progress Photos
            </h6>
            <AiCoachPhotoGallery onUploadClick={() => fileInputRef.current?.click()} />
          </div>
        </div>

        {/* Training programme iCal settings */}
        {uid && <TrainingProgrammesSection uid={uid} />}
      </div>
    </div>
  );
};

export default AiCoachPage;
