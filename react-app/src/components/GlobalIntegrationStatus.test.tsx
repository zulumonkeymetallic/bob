import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import GlobalIntegrationStatus from './GlobalIntegrationStatus';

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'u1' } }),
}));

jest.mock('firebase/functions', () => ({
  httpsCallable: () => async () => ({ data: {} }),
}));

jest.mock('../firebase', () => ({ db: {}, functions: {} }));

// Firestore refs are reduced to plain tagged objects so onSnapshot can route each subscription
// to the right fixture.
jest.mock('firebase/firestore', () => ({
  collection: (_db: any, name: string) => ({ kind: 'collection', name }),
  doc: (_db: any, coll: string, id: string) => ({ kind: 'doc', coll, id }),
  query: (ref: any) => ref,
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  onSnapshot: (ref: any, cb: any) => {
    const fixture = (globalThis as any).__snapshots__;
    if (ref.kind === 'doc' && ref.coll === 'profiles') {
      cb({ exists: () => true, data: () => fixture.profile });
    } else if (ref.kind === 'doc' && ref.coll === 'integration_status') {
      cb({ exists: () => !!fixture.monzoStatus, data: () => fixture.monzoStatus });
    } else if (ref.kind === 'collection' && ref.name === 'health_metrics') {
      const ms = fixture.healthKitMs;
      if (ms == null) cb({ empty: true, docs: [] });
      else cb({ empty: false, docs: [{ data: () => ({ updatedAt: ms }) }] });
    }
    return () => {};
  },
}));

const DAY = 86400000;
const daysAgo = (n: number) => Date.now() - n * DAY;

const setSnapshots = (overrides: any = {}) => {
  (globalThis as any).__snapshots__ = {
    profile: {
      googleCalendarConnected: true,
      googleCalendarLastSyncAt: daysAgo(0.2),
      monzoConnected: true,
      monzoLastSyncAt: daysAgo(0.1),
      stravaConnected: true,
      stravaLastSyncAt: daysAgo(0.5),
      ...(overrides.profile || {}),
    },
    monzoStatus: overrides.monzoStatus === undefined
      ? { connected: true, lastSyncAt: daysAgo(0.1), lastSyncStatus: 'success' }
      : overrides.monzoStatus,
    healthKitMs: overrides.healthKitMs === undefined ? daysAgo(0.3) : overrides.healthKitMs,
  };
};

/** The row container for a given integration label. */
const rowFor = (label: string) => screen.getByText(label).closest('div') as HTMLElement;

beforeEach(() => {
  jest.clearAllMocks();
  setSnapshots();
});

describe('GlobalIntegrationStatus', () => {
  it('reports last successful sync for healthy integrations instead of hiding them', async () => {
    render(<GlobalIntegrationStatus />);

    // Previously a healthy integration rendered no row at all, so "when did Monzo last sync?"
    // was unanswerable from the notification panel.
    await waitFor(() => expect(screen.getByText('Monzo')).toBeInTheDocument());
    expect(within(rowFor('Monzo')).getByText(/last synced/i)).toBeInTheDocument();
    expect(within(rowFor('Calendar')).getByText(/last synced/i)).toBeInTheDocument();
  });

  it('offers no reconnect button while an integration is healthy', async () => {
    render(<GlobalIntegrationStatus />);
    await waitFor(() => expect(screen.getByText('Monzo')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument();
  });

  it('does not flag a critical state when everything is fresh', async () => {
    const onCriticalChange = jest.fn();
    render(<GlobalIntegrationStatus onCriticalChange={onCriticalChange} />);
    await waitFor(() => expect(onCriticalChange).toHaveBeenCalled());
    expect(onCriticalChange).toHaveBeenLastCalledWith(false);
  });

  it('escalates to critical once a sync is more than 3 days old', async () => {
    setSnapshots({
      profile: { monzoLastSyncAt: daysAgo(4) },
      monzoStatus: { connected: true, lastSyncAt: daysAgo(4), lastSyncStatus: 'success' },
    });
    const onCriticalChange = jest.fn();
    render(<GlobalIntegrationStatus onCriticalChange={onCriticalChange} />);

    await waitFor(() => expect(onCriticalChange).toHaveBeenLastCalledWith(true));
    const button = within(rowFor('Monzo')).getByRole('button', { name: /reconnect/i });
    expect(button).toHaveAttribute('title', 'Reconnect Monzo');
  });

  it('holds at warn — not critical — at exactly 3 days', async () => {
    setSnapshots({
      profile: { monzoLastSyncAt: daysAgo(3.2) },
      monzoStatus: { connected: true, lastSyncAt: daysAgo(3.2), lastSyncStatus: 'success' },
    });
    const onCriticalChange = jest.fn();
    render(<GlobalIntegrationStatus onCriticalChange={onCriticalChange} />);
    await waitFor(() => expect(onCriticalChange).toHaveBeenCalled());
    expect(onCriticalChange).toHaveBeenLastCalledWith(false);
  });

  it('sorts critical integrations above healthy ones', async () => {
    setSnapshots({ profile: { stravaNeedsReconnect: true } });
    render(<GlobalIntegrationStatus />);

    await waitFor(() => expect(screen.getByText('Strava')).toBeInTheDocument());
    const labels = screen.getAllByText(/^(Calendar|Monzo|Strava|HealthKit)$/).map(n => n.textContent);
    expect(labels[0]).toBe('Strava');
  });

  it('offers Reconnect, not Settings, when Strava asks for re-authorisation', async () => {
    // The live failure mode on 2026-08-06: connected, stravaLastSyncAt null because it is only
    // written on success, so the old code called it "never synced" and offered a Settings link.
    setSnapshots({
      profile: {
        stravaNeedsReconnect: true,
        stravaLastSyncAt: null,
        stravaLastSyncStatus: 'error',
        stravaLastErrorMessage: 'Strava authorization expired. Reconnect Strava.',
      },
    });
    render(<GlobalIntegrationStatus />);

    await waitFor(() => expect(screen.getByText('Strava')).toBeInTheDocument());
    const row = rowFor('Strava');
    const button = within(row).getByRole('button', { name: /reconnect/i });
    expect(button).toHaveAttribute('title', 'Reconnect Strava');
    expect(within(row).queryByRole('button', { name: /settings/i })).not.toBeInTheDocument();
    expect(within(row).getByText(/authorization expired/i)).toBeInTheDocument();
  });

  it('treats a missing googleCalendarConnected flag plus a recorded sync as connected', async () => {
    // Accounts that connected before the flag existed must not read as disconnected.
    setSnapshots({ profile: { googleCalendarConnected: undefined, googleCalendarLastSyncAt: daysAgo(0.4) } });
    render(<GlobalIntegrationStatus />);

    await waitFor(() => expect(screen.getByText('Calendar')).toBeInTheDocument());
    const row = rowFor('Calendar');
    expect(within(row).getByText(/last synced/i)).toBeInTheDocument();
    expect(within(row).queryByText(/disconnected/i)).not.toBeInTheDocument();
  });

  it('ignores a stale provider error that a later successful sync superseded', async () => {
    setSnapshots({
      monzoStatus: {
        connected: true,
        lastSyncAt: daysAgo(0.1),
        lastSyncStatus: 'error',
        lastErrorAt: daysAgo(2),
        lastErrorMessage: 'Unsupported state or unable to authenticate data',
      },
    });
    render(<GlobalIntegrationStatus />);

    await waitFor(() => expect(screen.getByText('Monzo')).toBeInTheDocument());
    expect(within(rowFor('Monzo')).queryByText(/unsupported state/i)).not.toBeInTheDocument();
  });

  it('surfaces a provider error that is newer than the last success', async () => {
    setSnapshots({
      monzoStatus: {
        connected: true,
        lastSyncAt: daysAgo(1),
        lastSyncStatus: 'error',
        lastErrorAt: daysAgo(0.1),
        lastErrorMessage: 'Unsupported state or unable to authenticate data',
      },
    });
    render(<GlobalIntegrationStatus />);

    await waitFor(() => expect(screen.getByText('Monzo')).toBeInTheDocument());
    expect(within(rowFor('Monzo')).getByText(/unsupported state/i)).toBeInTheDocument();
  });
});
