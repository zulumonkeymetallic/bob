/**
 * AiStatusBanner
 *
 * Says out loud when AI has stopped working and why.
 *
 * BOB is bring-your-own-key, so "no AI" is a normal state on day one rather than a fault, and
 * the failures that follow (a revoked key, an empty balance, a model that no longer exists) are
 * all things only the user can fix. Before this, every one of them was a console warning and a
 * silently empty result: the nightly briefing ran on a fallback for days without anything
 * saying so. The backend now records the last outcome per user in `ai_status/{uid}`
 * (functions/utils/llmCredentials.js) and this renders it.
 *
 * Renders nothing when AI is healthy — it is a row in the notification dropdown, and
 * NotificationStream hides sections that produce no content.
 */

import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { KeyRound, AlertTriangle } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { shouldShowAiStatus, describeAiStatus, type AiStatus } from '../utils/aiStatus';

const AiStatusBanner: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<AiStatus | null>(null);

  useEffect(() => {
    if (!currentUser?.uid) {
      setStatus(null);
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'ai_status', currentUser.uid),
      (snap) => setStatus(snap.exists() ? (snap.data() as AiStatus) : null),
      // A rules failure here must not break the notification panel for everything else.
      () => setStatus(null),
    );
    return () => unsub();
  }, [currentUser?.uid]);

  if (!shouldShowAiStatus(status)) return null;

  const { headline, providerLabel, isSetup, failureCount, ctaLabel } = describeAiStatus(status!);
  const Icon = isSetup ? KeyRound : AlertTriangle;
  const accent = isSetup ? 'var(--brand, #5f77dc)' : 'var(--danger, #dc2626)';

  return (
    <div style={{ minWidth: 260 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: 6 }}>
        AI
      </div>
      <div
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          background: 'var(--notion-hover, rgba(0,0,0,0.04))',
          border: `1px solid ${accent}`, borderRadius: 6,
          padding: '7px 8px',
        }}
      >
        <Icon size={14} style={{ color: accent, flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, display: 'block' }}>
            {headline}
            {providerLabel && (
              <span style={{ fontWeight: 400, color: 'var(--muted)' }}> — {providerLabel}</span>
            )}
          </span>
          <span style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginTop: 2 }}>
            {status?.message}
          </span>
          {failureCount > 1 && (
            <span style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginTop: 2 }}>
              Failed {failureCount} times since it last worked.
            </span>
          )}
          <button
            onClick={() => navigate('/settings?tab=ai')}
            style={{
              marginTop: 6, background: 'transparent',
              border: '1px solid var(--border, #e5e7eb)', borderRadius: 6,
              padding: '2px 7px', fontSize: 10, fontWeight: 600,
              color: 'var(--brand, #5f77dc)', cursor: 'pointer',
            }}
          >
            {ctaLabel}
          </button>
        </span>
      </div>
    </div>
  );
};

export default AiStatusBanner;
