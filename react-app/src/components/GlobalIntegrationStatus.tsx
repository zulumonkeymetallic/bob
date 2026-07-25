/**
 * GlobalIntegrationStatus
 *
 * Integration health (Monzo, Strava, HealthKit) as a row in the notification dropdown,
 * with working Reconnect actions — not a separate page banner. Previously this lived twice:
 * a compact desktop-only strip here (nav-only, no real reconnect), and a full react-bootstrap
 * Alert banner at the top of Dashboard.tsx with its own Monzo OAuth popup logic and
 * Strava/Trakt "Reconnect" nav buttons. Per Jim, 2026-07-25: integrations belong in
 * notifications, not as page banners — merged into one, matching the panel's row style
 * (DeferralCandidatesBanner, CheckInBanner, SprintClosureBanner), with the Monzo OAuth
 * reconnect logic ported over from Dashboard.tsx (the only thing the old strip couldn't do).
 * Strava/Monzo: stale after 2 days. HealthKit: stale after 7 days.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { db, functions } from '../firebase';
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

type ReconnectAction =
  | { kind: 'monzo-oauth' }
  | { kind: 'nav'; path: string };

interface Row {
  key: string;
  label: string;
  detail: string;
  reconnect?: ReconnectAction;
  reconnectLabel: string;
}

const GlobalIntegrationStatus: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const uid = currentUser?.uid;
  const [profile, setProfile] = useState<any>(null);
  const [lastHealthKitMs, setLastHealthKitMs] = useState<number | null | undefined>(undefined); // undefined = loading
  const [monzoBusy, setMonzoBusy] = useState(false);
  const [monzoMsg, setMonzoMsg] = useState<string | null>(null);

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

  const handleMonzoReconnect = useCallback(async () => {
    if (!currentUser) return;
    setMonzoMsg(null);
    setMonzoBusy(true);
    try {
      const createSession = httpsCallable(functions, 'createMonzoOAuthSession');
      const res: any = await createSession({ origin: window.location.origin });
      const data = res?.data || res;
      const sessionId = data?.sessionId;
      const startUrl = data?.startUrl || (sessionId ? `${window.location.origin}/api/monzo/start?session=${sessionId}` : null);
      if (!startUrl) throw new Error('Unable to resolve Monzo start URL');
      const popup = window.open(startUrl, 'monzo-oauth', 'width=480,height=720');
      if (!popup) setMonzoMsg('Popup blocked — allow popups for Monzo connect');
    } catch (err: any) {
      setMonzoMsg(err?.message || 'Failed to start Monzo OAuth');
    } finally {
      setMonzoBusy(false);
    }
  }, [currentUser]);

  const rows = useMemo<Row[]>(() => {
    if (!profile || lastHealthKitMs === undefined) return []; // wait for both subscriptions
    const result: Row[] = [];

    // ── Strava ─────────────────────────────────────────────────────────────────
    const stravaConnected = !!profile.stravaConnected;
    const stravaMs = toMs(profile.stravaLastSyncAt ?? profile.stravaLastSyncEpochMs ?? profile.stravaLastSync);
    const stravaDays = ageDays(stravaMs);

    if (!stravaConnected) {
      result.push({ key: 'strava', label: 'Strava', detail: 'disconnected', reconnect: { kind: 'nav', path: '/settings?tab=integrations' }, reconnectLabel: 'Reconnect' });
    } else if (stravaDays === null) {
      result.push({ key: 'strava', label: 'Strava', detail: 'never synced', reconnect: { kind: 'nav', path: '/settings?tab=integrations' }, reconnectLabel: 'Settings' });
    } else if (stravaDays >= STALE_DAYS_INTEGRATION) {
      result.push({ key: 'strava', label: 'Strava', detail: `stale, ${ageLabel(stravaMs)}`, reconnect: { kind: 'nav', path: '/settings?tab=integrations' }, reconnectLabel: 'Reconnect' });
    }

    // ── Monzo ──────────────────────────────────────────────────────────────────
    const monzoConnected = !!(profile.monzoConnected ?? profile.monzoAccessToken);
    const monzoMs = toMs(profile.monzoLastSyncAt ?? profile.monzoLastSync);
    const monzoDays = ageDays(monzoMs);

    if (!monzoConnected) {
      result.push({ key: 'monzo', label: 'Monzo', detail: monzoMsg ? `disconnected · ${monzoMsg}` : 'disconnected', reconnect: { kind: 'monzo-oauth' }, reconnectLabel: 'Connect' });
    } else if (monzoDays === null) {
      result.push({ key: 'monzo', label: 'Monzo', detail: monzoMsg ? `never synced · ${monzoMsg}` : 'never synced', reconnect: { kind: 'monzo-oauth' }, reconnectLabel: 'Reconnect' });
    } else if (monzoDays >= STALE_DAYS_INTEGRATION) {
      result.push({ key: 'monzo', label: 'Monzo', detail: monzoMsg ? `stale, ${ageLabel(monzoMs)} · ${monzoMsg}` : `stale, ${ageLabel(monzoMs)}`, reconnect: { kind: 'monzo-oauth' }, reconnectLabel: 'Reconnect' });
    }

    // ── HealthKit ──────────────────────────────────────────────────────────────
    // lastHealthKitMs === null means the collection exists but has no data (never synced).
    // No reconnect action makes sense here — it's a phone-side sync, not an OAuth connection.
    const hkDays = ageDays(lastHealthKitMs);

    if (lastHealthKitMs === null) {
      result.push({ key: 'healthkit', label: 'HealthKit', detail: 'open BOB on iPhone to sync', reconnectLabel: '' });
    } else if (hkDays !== null && hkDays >= STALE_DAYS_HEALTHKIT) {
      result.push({ key: 'healthkit', label: 'HealthKit', detail: `${ageLabel(lastHealthKitMs)} — sync via iPhone`, reconnectLabel: '' });
    }

    return result;
  }, [profile, lastHealthKitMs, monzoMsg]);

  if (!rows.length) return null;

  const handleReconnect = (action: ReconnectAction | undefined) => {
    if (!action) return;
    if (action.kind === 'monzo-oauth') {
      handleMonzoReconnect();
    } else {
      navigate(action.path);
    }
  };

  return (
    <div style={{ minWidth: 260 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: 6 }}>
        Integrations
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(row => (
          <div
            key={row.key}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'var(--notion-hover, rgba(0,0,0,0.04))',
              border: '1px solid var(--border, #e5e7eb)', borderRadius: 6,
              padding: '5px 6px 5px 8px',
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{row.label}</span>
              <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 6 }}>— {row.detail}</span>
            </span>
            {row.reconnect && (
              <button
                onClick={() => handleReconnect(row.reconnect)}
                disabled={row.key === 'monzo' && monzoBusy}
                title={`${row.reconnectLabel} ${row.label}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
                  background: 'transparent', border: '1px solid var(--border, #e5e7eb)', borderRadius: 6,
                  padding: '2px 7px', fontSize: 10, fontWeight: 600,
                  color: row.key === 'monzo' && monzoBusy ? 'var(--muted)' : 'var(--brand, #5f77dc)',
                  cursor: row.key === 'monzo' && monzoBusy ? 'default' : 'pointer',
                }}
              >
                <RefreshCw size={11} />
                {row.key === 'monzo' && monzoBusy ? '…' : row.reconnectLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default GlobalIntegrationStatus;
