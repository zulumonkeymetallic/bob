/**
 * GlobalIntegrationStatus
 *
 * Compact desktop-only strip showing Monzo and Strava staleness on every page.
 * Appears in SidebarLayout below the GlobalGoalFocusBanner.
 * Only renders when one or more integrations is stale (≥2 days) or disconnected.
 * Clicking either chip navigates to /settings?tab=integrations.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

function toMs(value: any): number | null {
  if (!value) return null;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
  if (typeof value === 'string') {
    const p = Date.parse(value);
    return Number.isFinite(p) ? p : null;
  }
  return null;
}

function ageLabel(ms: number | null): string | null {
  if (ms === null) return null;
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.round(diff / 3600000);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

function ageDays(ms: number | null): number | null {
  if (ms === null) return null;
  return Math.floor((Date.now() - ms) / 86400000);
}

const STALE_DAYS = 2; // flag as stale after this many days

const GlobalIntegrationStatus: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const uid = currentUser?.uid;
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(db, 'profiles', uid), snap => {
      setProfile(snap.exists() ? snap.data() : null);
    }, () => setProfile(null));
  }, [uid]);

  const chips = useMemo(() => {
    if (!profile) return [];
    const result: Array<{ key: string; label: string; colour: string; title: string }> = [];

    // ── Strava ─────────────────────────────────────────────────────────────────
    const stravaConnected = !!profile.stravaConnected;
    const stravaMs = toMs(profile.stravaLastSyncAt ?? profile.stravaLastSyncEpochMs ?? profile.stravaLastSync);
    const stravaDays = ageDays(stravaMs);

    if (!stravaConnected) {
      result.push({ key: 'strava', label: 'Strava: not connected', colour: '#dc2626', title: 'Strava is not connected — go to Settings → Integrations to reconnect' });
    } else if (stravaDays === null) {
      result.push({ key: 'strava', label: 'Strava: never synced', colour: '#f59e0b', title: 'Strava has not synced yet — trigger a sync from Settings → Integrations' });
    } else if (stravaDays >= STALE_DAYS) {
      result.push({ key: 'strava', label: `Strava: ${ageLabel(stravaMs)}`, colour: '#f59e0b', title: `Strava last synced ${ageLabel(stravaMs)} — may be stale` });
    }

    // ── Monzo ──────────────────────────────────────────────────────────────────
    const monzoConnected = !!(profile.monzoConnected ?? profile.monzoAccessToken);
    const monzoMs = toMs(profile.monzoLastSyncAt ?? profile.monzoLastSync);
    const monzoDays = ageDays(monzoMs);

    if (!monzoConnected) {
      result.push({ key: 'monzo', label: 'Monzo: not connected', colour: '#dc2626', title: 'Monzo is not connected — go to Settings → Integrations to reconnect' });
    } else if (monzoDays === null) {
      result.push({ key: 'monzo', label: 'Monzo: never synced', colour: '#f59e0b', title: 'Monzo has not synced yet' });
    } else if (monzoDays >= STALE_DAYS) {
      result.push({ key: 'monzo', label: `Monzo: ${ageLabel(monzoMs)}`, colour: '#f59e0b', title: `Monzo last synced ${ageLabel(monzoMs)} — transactions may be out of date` });
    }

    return result;
  }, [profile]);

  if (!chips.length) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        padding: '6px 12px 4px',
        borderTop: '1px solid var(--bs-border-color)',
      }}
    >
      {chips.map(chip => (
        <button
          key={chip.key}
          title={chip.title}
          onClick={() => navigate('/settings?tab=integrations')}
          style={{
            background: 'transparent',
            border: `1px solid ${chip.colour}`,
            borderRadius: 4,
            color: chip.colour,
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 7px',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            letterSpacing: '0.01em',
          }}
        >
          <span style={{ fontSize: 9 }}>⚠</span>
          {chip.label}
        </button>
      ))}
    </div>
  );
};

export default GlobalIntegrationStatus;
