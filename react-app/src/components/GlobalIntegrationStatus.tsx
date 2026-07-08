/**
 * GlobalIntegrationStatus
 *
 * Compact desktop-only strip showing Monzo, Strava, and HealthKit staleness on every page.
 * Appears in SidebarLayout's banner strip.
 * Only renders when one or more integrations is stale or disconnected.
 * Strava/Monzo: stale after 2 days. HealthKit: stale after 7 days.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
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

const STALE_DAYS_INTEGRATION = 2;   // Strava / Monzo
const STALE_DAYS_HEALTHKIT    = 7;   // HealthKit — iOS sync needed

const GlobalIntegrationStatus: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const uid = currentUser?.uid;
  const [profile, setProfile] = useState<any>(null);
  const [lastHealthKitMs, setLastHealthKitMs] = useState<number | null | undefined>(undefined); // undefined = loading

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(db, 'profiles', uid), snap => {
      setProfile(snap.exists() ? snap.data() : null);
    }, () => setProfile(null));
  }, [uid]);

  // Most recent health_metrics doc — tracks last HealthKit push from iOS app
  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, 'health_metrics'),
      where('ownerUid', '==', uid),
      orderBy('updatedAt', 'desc'),
      limit(1)
    );
    return onSnapshot(q, snap => {
      if (snap.empty) { setLastHealthKitMs(null); return; }
      const d = snap.docs[0].data();
      const ts = d.updatedAt?.toMillis?.() ?? (typeof d.updatedAt === 'number' ? d.updatedAt : null);
      setLastHealthKitMs(ts);
    }, () => setLastHealthKitMs(null));
  }, [uid]);

  const chips = useMemo(() => {
    if (!profile || lastHealthKitMs === undefined) return []; // wait for both subscriptions
    const result: Array<{ key: string; label: string; colour: string; title: string; nav: string }> = [];

    // ── Strava ─────────────────────────────────────────────────────────────────
    const stravaConnected = !!profile.stravaConnected;
    const stravaMs = toMs(profile.stravaLastSyncAt ?? profile.stravaLastSyncEpochMs ?? profile.stravaLastSync);
    const stravaDays = ageDays(stravaMs);

    if (!stravaConnected) {
      result.push({ key: 'strava', label: 'Strava: not connected', colour: '#dc2626', title: 'Strava is not connected — go to Settings → Integrations to reconnect', nav: '/settings?tab=integrations' });
    } else if (stravaDays === null) {
      result.push({ key: 'strava', label: 'Strava: never synced', colour: '#f59e0b', title: 'Strava has not synced yet — trigger a sync from Settings → Integrations', nav: '/settings?tab=integrations' });
    } else if (stravaDays >= STALE_DAYS_INTEGRATION) {
      result.push({ key: 'strava', label: `Strava: ${ageLabel(stravaMs)}`, colour: '#f59e0b', title: `Strava last synced ${ageLabel(stravaMs)} — may be stale`, nav: '/settings?tab=integrations' });
    }

    // ── Monzo ──────────────────────────────────────────────────────────────────
    const monzoConnected = !!(profile.monzoConnected ?? profile.monzoAccessToken);
    const monzoMs = toMs(profile.monzoLastSyncAt ?? profile.monzoLastSync);
    const monzoDays = ageDays(monzoMs);

    if (!monzoConnected) {
      result.push({ key: 'monzo', label: 'Monzo: not connected', colour: '#dc2626', title: 'Monzo is not connected — go to Settings → Integrations to reconnect', nav: '/settings?tab=integrations' });
    } else if (monzoDays === null) {
      result.push({ key: 'monzo', label: 'Monzo: never synced', colour: '#f59e0b', title: 'Monzo has not synced yet', nav: '/settings?tab=integrations' });
    } else if (monzoDays >= STALE_DAYS_INTEGRATION) {
      result.push({ key: 'monzo', label: `Monzo: ${ageLabel(monzoMs)}`, colour: '#f59e0b', title: `Monzo last synced ${ageLabel(monzoMs)} — transactions may be out of date`, nav: '/settings?tab=integrations' });
    }

    // ── HealthKit ──────────────────────────────────────────────────────────────
    // lastHealthKitMs === null means the collection exists but has no data (never synced)
    const hkDays = ageDays(lastHealthKitMs);

    if (lastHealthKitMs === null) {
      result.push({ key: 'healthkit', label: 'HealthKit: open BOB on iPhone to sync', colour: '#f59e0b', title: 'No HealthKit data found. Open BOB on your iPhone to push health metrics.', nav: '/ai-coach' });
    } else if (hkDays !== null && hkDays >= STALE_DAYS_HEALTHKIT) {
      result.push({ key: 'healthkit', label: `HealthKit: ${ageLabel(lastHealthKitMs)} — sync via iPhone`, colour: '#f59e0b', title: `HealthKit data is ${ageLabel(lastHealthKitMs)} old. Open BOB on your iPhone to refresh health metrics.`, nav: '/ai-coach' });
    }

    return result;
  }, [profile, lastHealthKitMs]);

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
          onClick={() => navigate(chip.nav)}
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
