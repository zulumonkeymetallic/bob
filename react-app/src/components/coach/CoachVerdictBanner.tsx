/**
 * CoachVerdictBanner
 *
 * Shows today's coach readiness verdict as a dismissible banner.
 * Reads coach_daily/{uid}_{today} in real time.
 * Mirrors the CheckInBanner dismiss pattern (localStorage keyed to uid+date).
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { Badge, Button, Card, ProgressBar } from 'react-bootstrap';
import { Activity, Dumbbell, HeartPulse, X } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import type { CoachDaily } from '../../types/CoachTypes';

function fmtSyncAge(tsMs: number): string {
  const diff = Date.now() - tsMs;
  const mins = Math.round(diff / 60000);
  if (mins < 2)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.round(diff / 3600000);
  if (hrs  < 24)  return `${hrs}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

export const CoachVerdictBanner: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const uid = currentUser?.uid;
  const [coachData, setCoachData] = useState<CoachDaily | null>(null);
  const [coachConfigured, setCoachConfigured] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [lastSyncMs, setLastSyncMs] = useState<number | null>(null);

  const today = todayStr();
  const dismissKey = uid ? `coach_verdict_dismissed_${uid}_${today}` : null;

  useEffect(() => {
    if (!dismissKey) return;
    if (localStorage.getItem(dismissKey) === 'true') {
      setDismissed(true);
    }
  }, [dismissKey]);

  useEffect(() => {
    if (!uid) {
      setCoachConfigured(false);
      return;
    }
    const profileRef = doc(db, 'profiles', uid);
    const unsub = onSnapshot(profileRef, (snap) => {
      const data = snap.data() as any;
      const hasCoachPlan =
        Boolean(data?.ironmanUmbrellaGoalId) &&
        (Boolean(data?.runnerProgrammeUrl) || Boolean(data?.crossFitProgrammeUrl));
      const enabled = data?.aiCoachEnabled !== false;
      setCoachConfigured(enabled && hasCoachPlan);
    }, () => {
      setCoachConfigured(false);
    });
    return unsub;
  }, [uid]);

  useEffect(() => {
    if (!uid || !coachConfigured) {
      setCoachData(null);
      return;
    }
    const docRef = doc(db, 'coach_daily', `${uid}_${today}`);
    const unsub = onSnapshot(docRef, snap => {
      if (snap.exists()) {
        setCoachData(snap.data() as CoachDaily);
      } else {
        setCoachData(null);
      }
    }, () => {});
    return unsub;
  }, [uid, today, coachConfigured]);

  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, 'health_metrics'),
      where('ownerUid', '==', uid),
      orderBy('updatedAt', 'desc'),
      limit(1)
    );
    return onSnapshot(q, snap => {
      if (snap.empty) { setLastSyncMs(null); return; }
      const d = snap.docs[0].data();
      const ts = d.updatedAt?.toMillis?.() ?? (typeof d.updatedAt === 'number' ? d.updatedAt : null);
      setLastSyncMs(ts);
    }, () => setLastSyncMs(null));
  }, [uid]);

  if (!coachConfigured || !coachData || dismissed) return null;

  const { readinessLabel, readinessScore, briefingText } = coachData;
  const readinessPct = Math.round((readinessScore ?? 0) * 100);

  // Extract training title from briefingText (line 3 after "Today: ")
  const todayTraining = briefingText?.split('\n')[2]
    ?.replace('Today: ', '')
    .replace('.', '') || '';

  const appearance =
    readinessLabel === 'green'
      ? {
        gradient: 'linear-gradient(135deg, #157347 0%, #1f9d63 100%)',
        pillBg: 'rgba(255,255,255,0.22)',
        icon: <HeartPulse size={18} />,
        label: 'Green',
      }
      : readinessLabel === 'amber'
        ? {
          gradient: 'linear-gradient(135deg, #b58105 0%, #d39e00 100%)',
          pillBg: 'rgba(255,255,255,0.22)',
          icon: <Activity size={18} />,
          label: 'Amber',
        }
        : {
          gradient: 'linear-gradient(135deg, #b02a37 0%, #d63344 100%)',
          pillBg: 'rgba(255,255,255,0.22)',
          icon: <Dumbbell size={18} />,
          label: 'Red',
        };

  const handleDismiss = () => {
    if (dismissKey) localStorage.setItem(dismissKey, 'true');
    setDismissed(true);
  };

  return (
    <Card
      className="mb-3 border-0 shadow-sm"
      style={{
        background: appearance.gradient,
        color: '#fff',
      }}
    >
      <Card.Body style={{ padding: '10px 14px' }}>
        <div className="d-flex align-items-start gap-2">
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              backgroundColor: appearance.pillBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
            aria-hidden="true"
          >
            {appearance.icon}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <span style={{ fontSize: 13, fontWeight: 700 }}>AI Coach</span>
              <Badge pill bg="light" text="dark" style={{ fontSize: 10 }}>
                {appearance.label}
              </Badge>
              <span style={{ fontSize: 12, opacity: 0.95 }}>Readiness {readinessPct}%</span>
              {lastSyncMs !== null && (
                <span style={{ fontSize: 10, opacity: 0.8 }}>
                  · HealthKit {fmtSyncAge(lastSyncMs)}
                </span>
              )}
              {lastSyncMs === null && (
                <span style={{ fontSize: 10, opacity: 0.7 }}>· HealthKit: no sync</span>
              )}
            </div>
            <div
              style={{
                marginTop: 2,
                fontSize: 11,
                opacity: 0.9,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={todayTraining || 'No training scheduled'}
            >
              {todayTraining || 'No training scheduled'}
            </div>
            <ProgressBar
              now={readinessPct}
              variant="light"
              style={{ marginTop: 7, height: 6, backgroundColor: 'rgba(255,255,255,0.22)' }}
            />
          </div>

          <div className="d-flex align-items-center gap-1" style={{ flexShrink: 0 }}>
            <Button
              size="sm"
              variant="light"
              onClick={() => navigate('/ai-coach')}
              style={{ borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}
            >
              Open coach
            </Button>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss coach banner"
              title="Dismiss for today"
              style={{
                background: 'rgba(255,255,255,0.24)',
                border: 'none',
                color: '#fff',
                cursor: 'pointer',
                width: 24,
                height: 24,
                borderRadius: 6,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
};

export default CoachVerdictBanner;
