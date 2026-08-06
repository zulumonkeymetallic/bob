import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddGoalModal from './AddGoalModal';

jest.mock('../firebase', () => ({ db: {} }));

// Plain functions, not jest.fn: CRA's jest config sets resetMocks, which strips a jest.fn's
// implementation before each test and would leave getDocs returning undefined.
jest.mock('firebase/firestore', () => ({
  collection: () => ({}),
  addDoc: async () => ({ id: 'new-goal' }),
  getDocs: async () => ({ docs: [] }),
  query: () => ({}),
  where: () => ({}),
  serverTimestamp: () => 'ts',
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'u1' } }),
}));

jest.mock('../contexts/PersonaContext', () => ({
  usePersona: () => ({ currentPersona: 'personal' }),
}));

jest.mock('../hooks/useGlobalThemes', () => ({
  useGlobalThemes: () => ({
    themes: [
      { id: 0, name: 'General', label: 'General' },
      { id: 1, name: 'Health & Fitness', label: 'Health & Fitness' },
      { id: 2, name: 'Career & Professional', label: 'Career & Professional' },
      { id: 3, name: 'Finance & Wealth', label: 'Finance & Wealth' },
    ],
    loading: false,
    error: null,
    refresh: jest.fn(),
  }),
}));

const themeField = () => screen.getByPlaceholderText('Search themes...') as HTMLInputElement;

describe('AddGoalModal theme picker', () => {
  it('defaults to the Health & Fitness label', async () => {
    render(<AddGoalModal show onClose={jest.fn()} />);
    await waitFor(() => expect(themeField().value).toBe('Health & Fitness'));
  });

  it('keeps a newly chosen theme instead of snapping back to the default', async () => {
    // The reported bug: the field's value was `themeInput || label(formData.theme) || ''`, so
    // the moment the box was cleared to type a new theme it refilled with the default theme's
    // label (id 1, Health & Fitness) and any partial text failed to resolve.
    render(<AddGoalModal show onClose={jest.fn()} />);
    await waitFor(() => expect(themeField().value).toBe('Health & Fitness'));

    await userEvent.clear(themeField());
    await userEvent.type(themeField(), 'Finance & Wealth');
    await userEvent.tab();

    await waitFor(() => expect(themeField().value).toBe('Finance & Wealth'));
  });

  it('stays empty while being cleared rather than instantly refilling with the default', async () => {
    render(<AddGoalModal show onClose={jest.fn()} />);
    await waitFor(() => expect(themeField().value).toBe('Health & Fitness'));

    await userEvent.clear(themeField());
    expect(themeField().value).toBe('');
  });

  it('resolves a partial entry to a full theme label on blur', async () => {
    render(<AddGoalModal show onClose={jest.fn()} />);
    await waitFor(() => expect(themeField().value).toBe('Health & Fitness'));

    await userEvent.clear(themeField());
    await userEvent.type(themeField(), 'Career');
    await userEvent.tab();

    // Snapped to the canonical label, so what is displayed matches what would be saved.
    await waitFor(() => expect(themeField().value).toBe('Career & Professional'));
  });

  it('falls back to the current theme when the text matches nothing', async () => {
    render(<AddGoalModal show onClose={jest.fn()} />);
    await waitFor(() => expect(themeField().value).toBe('Health & Fitness'));

    await userEvent.clear(themeField());
    await userEvent.type(themeField(), 'Finance & Wealth');
    await userEvent.tab();
    await waitFor(() => expect(themeField().value).toBe('Finance & Wealth'));

    await userEvent.clear(themeField());
    await userEvent.type(themeField(), 'zzzz-not-a-theme');
    await userEvent.tab();

    // Reverts to the last good selection, not to the id-1 default.
    await waitFor(() => expect(themeField().value).toBe('Finance & Wealth'));
  });
});
