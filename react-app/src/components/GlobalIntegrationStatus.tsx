/**
 * GlobalIntegrationStatus
 *
 * Integration health (Google Calendar, Monzo, Strava, HealthKit) as a row in the notification
 * dropdown, with working Reconnect actions — not a separate page banner. Previously this lived
 * twice: a compact desktop-only strip here (nav-only, no real reconnect), and a full
 * react-bootstrap Alert banner at the top of Dashboard.tsx with its own Monzo OAuth popup logic
 * and Strava/Trakt "Reconnect" nav buttons. Per Jim, 2026-07-25: integrations belong in
 * notifications, not as page banners — merged into one, matching the panel's row style
 * (DeferralCandidatesBanner, CheckInBanner, SprintClosureBanner), with the Monzo OAuth
 * reconnect logic ported over from Dashboard.tsx (the only thing the old strip couldn't do).
 *
 * Per Jim, 2026-08-06: rows are shown whether or not anything is wrong, because "when did this
 * last actually sync" is the question being asked — previously a row only appeared once an
 * integration had already gone stale, so a healthy Monzo was indistinguishable from one that
 * had silently stopped. Anything with no successful sync for more than 3 days is `critical`,
 * which sorts it to the top of this list and (via onCriticalChange) to the top of the whole
 * notification panel.
 *
 * Connected-ness is deliberately read from client-visible state only: `tokens` and `users` are
 * server-only under firestore.rules, so Google Calendar's status comes from the
 * profiles/{uid}.googleCalendarConnected flag that oauthCallback, calendarStatus and every
 * successful sync now maintain.
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

/** Newest of several timestamps — integrations often stamp more than one place. */
function newestMs(...values: any[]): number | null {
  const times = values.map(toMs).filter((v): v is number => v !== null);
  return times.length ? Math.max(...times) : null;
}

const STALE_DAYS_WARN      = 2;  // Strava / Monzo / Calendar — worth noticing
const STALE_DAYS_CRITICAL  = 3;  // Per Jim: past this it jumps to the top of the list
const STALE_DAYS_HEALTHKIT = 7;  // Phone-side sync, naturally more intermittent

type Severity = 'ok' | 'warn' | 'critical';

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warn: 1, ok: 2 };

const SEVERITY_COLOUR: Record<Severity, string> = {
  critical: 'var(--danger, #dc2626)',
  warn: 'var(--warning, #d97706)',
  ok: 'var(--success, #16a34a)',
};

type ReconnectAction =
  | { kind: 'monzo-oauth' }
  | { kind: 'nav'; path: string };

interface Row {
  key: string;
  label: string;
  detail: string;
  severity: Severity;
  reconnect?: ReconnectAction;
  reconnectLabel: string;
}

const SETTINGS_PATH = '/settings?tab=integrations';

/**
 * Shared shape for an OAuth-style integration: connected flag plus a last-successful-sync
 * timestamp. `errorMessage` is only surfaced when the provider actually reported a failure —
 * a stale error left over from before a later successful sync would otherwise read as current.
 */
function buildRow(opts: {
  key: string;
  label: string;
  connected: boolean;
  lastSyncMs: number | null;
  needsReconnect?: boolean;
  errored?: boolean;
  errorMessage?: string | null;
  reconnect: ReconnectAction;
  criticalDays?: number;
  warnDays?: number;
}): Row {
  const {
    key, label, connected, lastSyncMs, needsReconnect, errored, errorMessage, reconnect,
    criticalDays = STALE_DAYS_CRITICAL, warnDays = STALE_DAYS_WARN,
  } = opts;

  const days = ageDays(lastSyncMs);
  const synced = ageLabel(lastSyncMs);

  if (!connected) {
    return { key, label, detail: 'disconnected', severity: 'critical', reconnect, reconnectLabel: 'Connect' };
  }
  if (needsReconnect) {
    return {
      key, label,
      detail: errorMessage ? `needs reconnect — ${errorMessage}` : 'needs reconnect',
      severity: 'critical', reconnect, reconnectLabel: 'Reconnect',
    };
  }
  // No successful sync on record at all. Connected but never delivering is a failure, not a
  // neutral "not yet" — Strava sat in exactly this state (stravaLastSyncAt is nulled on connect
  // and only rewritten on success) and used to render as a harmless "Settings" row.
  if (days === null) {
    return {
      key, label,
      detail: errorMessage ? `never synced — ${errorMessage}` : 'never synced',
      severity: 'critical', reconnect, reconnectLabel: 'Reconnect',
    };
  }
  if (days > criticalDays) {
    return {
      key, label,
      detail: errorMessage ? `last synced ${synced} — ${errorMessage}` : `last synced ${synced}`,
      severity: 'critical', reconnect, reconnectLabel: 'Reconnect',
    };
  }
  if (errored) {
    return {
      key, label,
      detail: errorMessage ? `last synced ${synced} — ${errorMessage}` : `last synced ${synced}, retrying`,
      severity: 'warn', reconnect, reconnectLabel: 'Reconnect',
    };
  }
  if (days >= warnDays) {
    return { key, label, detail: `last synced ${synced}`, severity: 'warn', reconnect, reconnectLabel: 'Reconnect' };
  }
  return { key, label, detail: `last synced ${synced}`, severity: 'ok', reconnect, reconnectLabel: 'Reconnect' };
}

interface GlobalIntegrationStatusProps {
  /** Fires when any integration crosses into `critical`, so the panel can float this to the top. */
  onCriticalChange?: (critical: boolean) => void;
}

const GlobalIntegrationStatus: React.FC<GlobalIntegrationStatusProps> = ({ onCriticalChange }) => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const uid = currentUser?.uid;
  const [profile, setProfile] = useState<any>(null);
  const [monzoStatus, setMonzoStatus] = useState<any>(null);
  const [lastHealthKitMs, setLastHealthKitMs] = useState<number | null | undefined>(undefined); // undefined = loading
  const [monzoBusy, setMonzoBusy] = useState(false);
  const [monzoMsg, setMonzoMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(db, 'profiles', uid), snap => {
      setProfile(snap.exists() ? snap.data() : null);
    }, () => setProfile(null));
  }, [uid]);

  // integration_status carries the richer Monzo state (lastSyncStatus, needsReauth, the actual
  // provider error) that the profile mirror doesn't.
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(db, 'integration_status', `monzo_${uid}`), snap => {
      setMonzoStatus(snap.exists() ? snap.data() : null);
    }, () => setMonzoStatus(null));
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

    // ── Google Calendar ────────────────────────────────────────────────────────
    // Was absent from this panel entirely, so a calendar that stopped importing said nothing.
    const googleMs = toMs(profile.googleCalendarLastSyncAt);
    result.push(buildRow({
      key: 'google',
      label: 'Calendar',
      // Undefined (not false) means the flag predates this account's last connect; a recorded
      // sync is then the only evidence available, and it's good evidence.
      connected: profile.googleCalendarConnected === true
        || (profile.googleCalendarConnected === undefined && googleMs !== null),
      lastSyncMs: googleMs,
      reconnect: { kind: 'nav', path: SETTINGS_PATH },
    }));

    // ── Monzo ──────────────────────────────────────────────────────────────────
    const monzoMs = newestMs(monzoStatus?.lastSyncAt, profile.monzoLastSyncAt, profile.monzoLastSync);
    const monzoErrored = monzoStatus?.lastSyncStatus === 'error';
    const monzoErrorMs = toMs(monzoStatus?.lastErrorAt);
    // Only treat the stored error as live if nothing succeeded after it.
    const monzoErrorLive = monzoErrored && (monzoErrorMs === null || monzoMs === null || monzoErrorMs >= monzoMs);
    result.push(buildRow({
      key: 'monzo',
      label: 'Monzo',
      connected: !!(monzoStatus?.connected ?? profile.monzoConnected ?? profile.monzoAccessToken),
      lastSyncMs: monzoMs,
      needsReconnect: monzoStatus?.needsReauth === true,
      errored: monzoErrorLive,
      errorMessage: monzoMsg || (monzoErrorLive ? monzoStatus?.lastErrorMessage : null) || null,
      reconnect: { kind: 'monzo-oauth' },
    }));

    // ── Strava ─────────────────────────────────────────────────────────────────
    const stravaMs = newestMs(profile.stravaLastSyncAt, profile.stravaLastSyncEpochMs, profile.stravaLastSync);
    result.push(buildRow({
      key: 'strava',
      label: 'Strava',
      connected: !!profile.stravaConnected,
      lastSyncMs: stravaMs,
      // The provider explicitly asks for re-auth — this was previously ignored, so an expired
      // Strava token offered a "Settings" link instead of "Reconnect".
      needsReconnect: profile.stravaNeedsReconnect === true,
      errored: profile.stravaLastSyncStatus === 'error',
      errorMessage: profile.stravaLastErrorMessage || null,
      reconnect: { kind: 'nav', path: SETTINGS_PATH },
    }));

    // ── HealthKit ──────────────────────────────────────────────────────────────
    // No reconnect action makes sense here — it's a phone-side sync, not an OAuth connection.
    const hkMs = newestMs(lastHealthKitMs, profile.healthkitLastSyncAt);
    const hkDays = ageDays(hkMs);
    if (hkMs === null) {
      result.push({ key: 'healthkit', label: 'HealthKit', detail: 'open BOB on iPhone to sync', severity: 'critical', reconnectLabel: '' });
    } else if (hkDays !== null && hkDays >= STALE_DAYS_HEALTHKIT) {
      result.push({ key: 'healthkit', label: 'HealthKit', detail: `last synced ${ageLabel(hkMs)} — sync via iPhone`, severity: 'warn', reconnectLabel: '' });
    } else {
      result.push({ key: 'healthkit', label: 'HealthKit', detail: `last synced ${ageLabel(hkMs)}`, severity: 'ok', reconnectLabel: '' });
    }

    return result.sort((a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.label.localeCompare(b.label));
  }, [profile, monzoStatus, lastHealthKitMs, monzoMsg]);

  const hasCritical = useMemo(() => rows.some(r => r.severity === 'critical'), [rows]);

  useEffect(() => {
    onCriticalChange?.(hasCritical);
  }, [hasCritical, onCriticalChange]);

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
              borderLeft: `3px solid ${SEVERITY_COLOUR[row.severity]}`,
              padding: '5px 6px 5px 8px',
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{row.label}</span>
              <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 6 }}>— {row.detail}</span>
            </span>
            {/* A healthy integration needs no call to action; the timestamp is the whole point. */}
            {row.reconnect && row.severity !== 'ok' && (
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
