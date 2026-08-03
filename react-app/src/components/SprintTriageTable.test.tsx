import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SprintTriageTable from './SprintTriageTable';
import type { Goal, Story, Task } from '../types';

/**
 * The triage list is where a sprint gets read, not just clicked through — so the two columns
 * that carry the actual meaning of an item (its title and its acceptance criteria) have to be
 * legible in full. Titles used to be clipped to one line with an ellipsis, which meant hovering
 * every row to find out what it said, and acceptance criteria were not shown at all.
 */

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  updateDoc: jest.fn().mockResolvedValue(undefined),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  serverTimestamp: jest.fn(),
  collection: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  onSnapshot: jest.fn(() => () => {}),
}));

jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => async () => ({ data: {} })) }));
jest.mock('../firebase', () => ({ db: {}, functions: {} }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ currentUser: { uid: 'u1' } }) }));
jest.mock('../contexts/SidebarContext', () => ({ useSidebar: () => ({ showSidebar: jest.fn() }) }));
jest.mock('../hooks/useThemeAwareColors', () => ({
  useThemeAwareColors: () => ({ backgrounds: { surface: '#fff' } }),
}));
jest.mock('./DeferItemModal', () => () => null);

const LONG_TITLE =
  'Rebuild the nightly orchestration chain so rollover, projected due dates and criticality scoring run in one pass';

const story = {
  id: 's1',
  ref: 'ST-11111',
  title: LONG_TITLE,
  description: 'A long description that also needs to be readable in full rather than clipped.',
  status: 1,
  sprintId: 'sp1',
  acceptanceCriteria: [
    'Rollover runs before projected due dates are computed',
    'Criticality scoring sees the post-rollover state',
  ],
} as unknown as Story;

const task = {
  id: 't1',
  ref: 'TK-22222',
  title: 'A task with no acceptance criteria of its own',
  status: 0,
  sprintId: 'sp1',
} as unknown as Task;

const renderTable = (props: Partial<React.ComponentProps<typeof SprintTriageTable>> = {}) =>
  render(
    <SprintTriageTable
      stories={[story]}
      tasks={[task]}
      goals={[] as Goal[]}
      sprints={[{ id: 'sp1', name: 'Sprint 1' }]}
      filterSprintId="sp1"
      onEditStory={jest.fn()}
      onEditTask={jest.fn()}
      {...props}
    />,
  );

describe('SprintTriageTable', () => {
  it('renders the full title, wrapped rather than clipped', () => {
    renderTable();
    const title = screen.getByText(LONG_TITLE);
    expect(title).toBeInTheDocument();
    // The clipping trio. `nowrap` plus `ellipsis` is exactly what made a long title
    // unreadable without hovering for the tooltip.
    expect(title).toHaveStyle({ whiteSpace: 'pre-wrap' });
    expect(title).not.toHaveStyle({ textOverflow: 'ellipsis' });
  });

  it('shows an acceptance criteria column with every criterion visible', () => {
    renderTable();
    expect(screen.getByText('Acceptance criteria')).toBeInTheDocument();
    expect(screen.getByText('Rollover runs before projected due dates are computed')).toBeInTheDocument();
    expect(screen.getByText('Criticality scoring sees the post-rollover state')).toBeInTheDocument();
  });

  it('edits acceptance criteria as one criterion per line', async () => {
    const { updateDoc } = require('firebase/firestore');
    renderTable();

    await userEvent.click(screen.getByText('Rollover runs before projected due dates are computed'));
    const box = await screen.findByRole('textbox');
    // Pre-populated with the existing criteria, newline separated — editing must not start
    // from an empty box and silently discard what was there.
    expect(box).toHaveValue(
      'Rollover runs before projected due dates are computed\nCriticality scoring sees the post-rollover state',
    );

    await userEvent.clear(box);
    await userEvent.type(box, 'First criterion{enter}Second criterion');
    await userEvent.tab();

    expect(updateDoc).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ acceptanceCriteria: ['First criterion', 'Second criterion'] }),
    );
  });

  it('hides the acceptance criteria column in the compact iPad layout', () => {
    // compactColumns exists because three Kanban columns plus a wide table does not fit
    // iPad landscape. A new column must respect that, not quietly reintroduce the scroll.
    renderTable({ compactColumns: true });
    expect(screen.queryByText('Acceptance criteria')).not.toBeInTheDocument();
  });
});
