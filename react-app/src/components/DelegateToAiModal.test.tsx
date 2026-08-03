import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DelegateToAiModal from './DelegateToAiModal';

/**
 * What this modal writes IS the contract with functions/aiDelegation.js and
 * ~/.hermes/scripts/run_delegation_cycle.py. Get a field name or a sentinel value wrong and
 * the item sits in the queue forever, or the wrong engine picks it up, or a rejection never
 * reaches the prompt rewriter. These tests pin the payloads.
 */

const mockUpdateDoc = jest.fn();
const mockCallable = jest.fn();
const mockOnSnapshot = jest.fn();

// Implementations are assigned in beforeEach, not in these factories: CRA's jest config sets
// resetMocks: true, which strips any implementation given at mock-definition time.
jest.mock('firebase/firestore', () => ({
  doc: () => 'DOC_REF',
  updateDoc: (...args: any[]) => mockUpdateDoc(...args),
  serverTimestamp: () => 'SERVER_TS',
  deleteField: () => 'DELETE_FIELD',
  collection: () => 'COLLECTION',
  query: () => 'QUERY',
  where: () => 'WHERE',
  onSnapshot: (...args: any[]) => mockOnSnapshot(...args),
}));

jest.mock('firebase/functions', () => ({
  httpsCallable: (...args: any[]) => mockCallable(...args),
}));

jest.mock('../firebase', () => ({ db: {}, functions: {} }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ currentUser: { uid: 'u1' } }) }));

const baseStory = { id: 's1', ref: 'ST-11111', title: 'Research ITOM licensing options' };

const renderModal = (entity: any = baseStory) =>
  render(
    <DelegateToAiModal
      show
      onHide={jest.fn()}
      entityType="story"
      entityId={entity.id}
      entity={entity}
    />,
  );

beforeEach(() => {
  mockUpdateDoc.mockResolvedValue(undefined);
  mockCallable.mockReturnValue(async () => ({ data: { results: [] } }));
  // The modal subscribes to the entity doc and to research_docs; neither needs to emit for
  // these assertions, but both must hand back a working unsubscribe.
  mockOnSnapshot.mockReturnValue(() => {});
});

/** The rejection commentary box, distinguished from the prompt box above it. */
const feedbackBox = () => screen.getByPlaceholderText(/Too generic/i);

describe('queueing work', () => {
  it('writes the engine, the prompt and the queued state', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: /queue for tonight/i }));

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalled());
    expect(mockUpdateDoc).toHaveBeenCalledWith('DOC_REF', expect.objectContaining({
      flaggedToAi: true,
      aiDelegationEngine: 'gemini',
      aiDelegationPrompt: 'Research ITOM licensing options',
      aiDelegationStatus: 'queued',
    }));
  });

  it('deletes the tier override on Auto rather than writing a value', async () => {
    // The server falls through to classifyDelegationTask only when the field is ABSENT.
    // Writing 'auto' — or leaving a stale 'simple' behind — pins every future run to the
    // wrong tier, which is the opposite of "best model for the ask".
    renderModal({ ...baseStory, aiDelegationType: 'simple' });
    await userEvent.selectOptions(screen.getByRole('combobox'), 'auto');
    await userEvent.click(screen.getByRole('button', { name: /queue for tonight/i }));

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalled());
    expect(mockUpdateDoc.mock.calls[0][1].aiDelegationType).toBe('DELETE_FIELD');
  });

  it('routes to Hermes when that engine is picked', async () => {
    renderModal();
    await userEvent.click(screen.getByText(/Hermes \(Mac\)/i));
    await userEvent.click(screen.getByRole('button', { name: /queue for tonight/i }));

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalled());
    expect(mockUpdateDoc.mock.calls[0][1].aiDelegationEngine).toBe('hermes');
  });

  it('does not call the cloud runner for a Hermes delegation', async () => {
    // Hermes polls Firestore on its own schedule; runAiDelegationNow would run the CLOUD
    // cycle, which deliberately skips hermes-routed items — so it would do nothing but
    // report success.
    renderModal();
    await userEvent.click(screen.getByText(/Hermes \(Mac\)/i));
    await userEvent.click(screen.getByRole('button', { name: /delegate and run now/i }));

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalled());
    expect(mockCallable).not.toHaveBeenCalled();
  });

  it('runs the cloud cycle immediately for a Gemini delegation, scoped to this item', async () => {
    // Without entityId the callable works the whole queue: the user waits on up to five
    // unrelated documents and the result reported back may not be theirs.
    const invoke = jest.fn().mockResolvedValue({ data: { results: [] } });
    mockCallable.mockReturnValue(invoke);

    renderModal();
    await userEvent.click(screen.getByRole('button', { name: /delegate and run now/i }));

    await waitFor(() => expect(mockCallable).toHaveBeenCalledWith({}, 'runAiDelegationNow'));
    expect(invoke).toHaveBeenCalledWith({ limit: 1, entityId: 's1' });
  });
});

describe('reviewing a result', () => {
  const inReview = {
    ...baseStory,
    aiDelegationStatus: 'human_review',
    aiDelegationDocumentLink: 'https://docs.google.com/document/d/abc/edit',
  };

  it('surfaces the review panel and the document', () => {
    renderModal(inReview);
    expect(screen.getByText(/waiting on your review/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open the document/i }))
      .toHaveAttribute('href', 'https://docs.google.com/document/d/abc/edit');
  });

  it('clears only the delegation state on accept, never `status`', async () => {
    // Stories and tasks use different status scales and neither has a Review lane — writing
    // status here would close a task outright.
    renderModal(inReview);
    await userEvent.click(screen.getByRole('button', { name: /^accept$/i }));

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalled());
    const payload = mockUpdateDoc.mock.calls[0][1];
    expect(payload.aiDelegationStatus).toBeNull();
    expect(payload).not.toHaveProperty('status');
  });

  it('sends the commentary back into the queue on reject', async () => {
    renderModal(inReview);
    await userEvent.click(screen.getByRole('button', { name: /reject with commentary/i }));
    await userEvent.type(feedbackBox(), 'Too generic — name real suppliers.');
    await userEvent.click(screen.getByRole('button', { name: /reject, revise tonight/i }));

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalled());
    expect(mockUpdateDoc).toHaveBeenCalledWith('DOC_REF', expect.objectContaining({
      aiDelegationFeedback: 'Too generic — name real suppliers.',
      aiDelegationStatus: 'revision_requested',
      flaggedToAi: true,
    }));
  });

  it('refuses to reject with empty commentary', async () => {
    // An empty rejection gives the prompt rewriter nothing to work from — it would re-run the
    // prompt that was just rejected and produce the same document.
    renderModal(inReview);
    await userEvent.click(screen.getByRole('button', { name: /reject with commentary/i }));
    await userEvent.click(screen.getByRole('button', { name: /reject, revise tonight/i }));

    expect(await screen.findByText(/Say what is wrong with it/i)).toBeInTheDocument();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

describe('model routing preview', () => {
  it('names the model a research prompt will run on', () => {
    renderModal();
    expect(screen.getByText(/gemini-2\.5-pro/)).toBeInTheDocument();
  });

  it('promises no specific model for Hermes', async () => {
    renderModal();
    await userEvent.click(screen.getByText(/Hermes \(Mac\)/i));
    expect(screen.getByText(/pick its own backend on the Mac/i)).toBeInTheDocument();
  });
});
