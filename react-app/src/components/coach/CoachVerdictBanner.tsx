/**
 * CoachVerdictBanner
 *
 * Shows today's coach readiness verdict as a dismissible banner.
 * Reads coach_daily/{uid}_{today} in real time.
 * Mirrors the CheckInBanner dismiss pattern (localStorage keyed to uid+date).
 */

import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import type { CoachDaily } from '../../types/CoachTypes';

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

export const CoachVerdictBanner: React.FC = () => {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid;
  const [coachData, setCoachData] = useState<CoachDaily | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const today = todayStr();
  const dismissKey = uid ? `coach_verdict_dismissed_${uid}_${today}` : null;

  useEffect(() => {
    if (!dismissKey) return;
    if (localStorage.getItem(dismissKey) === 'true') {
      setDismissed(true);
    }
  }, [dismissKey]);

  useEffect(() => {
    if (!uid) return;
    const docRef = doc(db, 'coach_daily', `${uid}_${today}`);
    const unsub = onSnapshot(docRef, snap => {
      if (snap.exists()) setCoachData(snap.data() as CoachDaily);
    });
    return unsub;
  }, [uid, today]);

  if (!coachData || dismissed) return null;

  const { readinessLabel, readinessScore, briefingText } = coachData;
  const readinessPct = Math.round((readinessScore ?? 0) * 100);

  // Extract training title from briefingText (line 3 after "Today: ")
  const todayTraining = briefingText?.split('\n')[2]
    ?.replace('Today: ', '')
    .replace('.', '') || '';

  const colour =
    readinessLabel === 'green' ? 'bg-green-900/40 border-green-500/50 text-green-300' :
    readinessLabel === 'amber' ? 'bg-yellow-900/40 border-yellow-500/50 text-yellow-300' :
                                 'bg-red-900/40 border-red-500/50 text-red-300';

  const emoji =
    readinessLabel === 'green' ? '🟢' :
    readinessLabel === 'amber' ? '🟡' : '🔴';

  const handleDismiss = () => {
    if (dismissKey) localStorage.setItem(dismissKey, 'true');
    setDismissed(true);
  };

  return (
    <div className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm mb-2 ${colour}`}>
      <span>
        {emoji} <strong>Coach:</strong> Readiness {readinessPct}%
        {todayTraining ? ` — ${todayTraining}` : ''}
      </span>
      <button
        onClick={handleDismiss}
        className="opacity-60 hover:opacity-100 transition-opacity ml-2 shrink-0"
        aria-label="Dismiss coach banner"
      >
        ✕
      </button>
    </div>
  );
};

export default CoachVerdictBanner;
