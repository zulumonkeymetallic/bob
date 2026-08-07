import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DelegationReviewBanner from './DelegationReviewBanner';

/**
 * The behaviours that matter here are the ones a glance at the UI cannot confirm.
 *
 * A delegated item does not change lane when it completes, so this banner is the only unprompted
 * signal that work is waiting. If it renders when there is nothing to review it adds a permanent
 * red dot to the bell that trains Jim to ignore it; if it silently drops a collection, finished
 * work sits invisible. Both fail without erroring.
 */

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

jest.mock('../firebase', () => ({ db: {} }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ currentUser: { uid: 'u1' } }) }));

/** Captures each subscription by collection name so a test can emit into one of the three. */
const listeners: Record<string, (snap: any) => void> = {};
const errorListeners: Record<string, (err: any) => void> = {};

jest.mock('firebase/firestore', () => ({
  collection: (_db: any, name: string) => ({ name }),
  query: (ref: any, ...rest: any[]) => ({ ...ref, rest }),
  where: (field: string, op: string, value: any) => ({ field, op, value }),
  onSnapshot: (q: any, next: (snap: any) => void, onError: (err: any) => void) => {
    listeners[q.name] = next;
    errorListeners[q.name] = onError;
    return () => { delete listeners[q.name]; };
  },
}));

const docOf = (data: any) => ({ id: data.id, data: () => data });

/**
 * Snapshots arrive from outside React, so every emission is wrapped in act() — otherwise the
 * state updates land after the assertion and each test passes or fails on timing rather than
 * behaviour.
 */
const emitAll = (overrides: Record<string, any[]> = {}) => act(() => {
  ['stories', 'tasks', 'goals'].forEach((name) => {
    listeners[name]({ docs: (overrides[name] || []).map(docOf) });
  });
});

const emitError = (name: string, err: any) => act(() => { errorListeners[name](err); });

beforeEach(() => {
  mockNavigate.mockClear();
  Object.keys(listeners).forEach((k) => delete listeners[k]);
});

test('renders nothing while no item is awaiting review', () => {
  const { container } = render(<DelegationReviewBanner />);
  emitAll();
  // NotificationStream hides sections with no children — an empty div would still show the bell.
  expect(container).toBeEmptyDOMElement();
});

test('subscribes to all three collections, not just stories and tasks', () => {
  render(<DelegationReviewBanner />);
  // Goals are processed by the delegation cycle and have no card on any board, so omitting them
  // would leave a completed goal with no surface at all.
  expect(Object.keys(listeners).sort()).toEqual(['goals', 'stories', 'tasks']);
});

test('lists an awaiting item with its ref, title and document link', async () => {
  render(<DelegationReviewBanner />);
  emitAll({
    stories: [{
      id: 's1', ref: 'ST-30788', title: 'China Trip Planning',
      aiDelegationDocumentLink: 'https://docs.google.com/document/d/abc/edit',
      aiDelegationCompletedAt: 1000,
    }],
  });

  expect(await screen.findByText('ST-30788 — China Trip Planning')).toBeInTheDocument();
  expect(screen.getByText(/1 awaiting review/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /open document/i }))
    .toHaveAttribute('href', 'https://docs.google.com/document/d/abc/edit');
});

test('a goal awaiting review routes to /goals, not /tasks', async () => {
  render(<DelegationReviewBanner />);
  emitAll({ goals: [{ id: 'g1', ref: 'GR-47791', title: 'Enhance BOB', aiDelegationCompletedAt: 5 }] });

  await userEvent.click(await screen.findByText('GR-47791 — Enhance BOB'));
  expect(mockNavigate).toHaveBeenCalledWith('/goals/g1');
});

test('orders most recently completed first across collections', async () => {
  render(<DelegationReviewBanner />);
  emitAll({
    stories: [{ id: 's1', ref: 'ST-1', title: 'Older', aiDelegationCompletedAt: 100 }],
    tasks: [{ id: 't1', ref: 'TK-1', title: 'Newer', aiDelegationCompletedAt: 900 }],
  });

  const rows = await screen.findAllByTitle(/Older|Newer/);
  expect(rows.map((r) => r.textContent)).toEqual(['TK-1 — Newer', 'ST-1 — Older']);
});

test('excludes soft-deleted records', async () => {
  render(<DelegationReviewBanner />);
  emitAll({
    stories: [
      { id: 's1', ref: 'ST-1', title: 'Live', aiDelegationCompletedAt: 1 },
      { id: 's2', ref: 'ST-2', title: 'Binned', deleted: true, aiDelegationCompletedAt: 2 },
    ],
  });

  expect(await screen.findByText('ST-1 — Live')).toBeInTheDocument();
  expect(screen.queryByText('ST-2 — Binned')).not.toBeInTheDocument();
  expect(screen.getByText(/1 awaiting review/i)).toBeInTheDocument();
});

test('one collection failing its rules check does not blank the others', async () => {
  render(<DelegationReviewBanner />);
  emitAll({ stories: [{ id: 's1', ref: 'ST-1', title: 'Survives', aiDelegationCompletedAt: 1 }] });
  emitError('goals', new Error('permission-denied'));

  expect(await screen.findByText('ST-1 — Survives')).toBeInTheDocument();
});
