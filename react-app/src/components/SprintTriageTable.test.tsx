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
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'u1', email: 'jim@jc1.tech' } }),
}));

const mockAddNote = jest.fn();
jest.mock('../services/ActivityStreamService', () => ({
  ActivityStreamService: { addNote: (...args: any[]) => mockAddNote(...args) },
}));
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
  priority: 3,
  points: 5,
  goalId: 'g1',
  sprintId: 'sp1',
  acceptanceCriteria: [
    'Rollover runs before projected due dates are computed',
    'Criticality scoring sees the post-rollover state',
  ],
} as unknown as Story;

// No acceptanceCriteria and no parent — the row both shaded cells are asserted against.
const task = {
  id: 't1',
  ref: 'TK-22222',
  title: 'A task with no acceptance criteria of its own',
  status: 0,
  sprintId: 'sp1',
} as unknown as Task;

const goal = { id: 'g1', ref: 'GR-33333', title: 'Ship the nightly chain', status: 1 } as unknown as Goal;

const renderTable = (props: Partial<React.ComponentProps<typeof SprintTriageTable>> = {}) =>
  render(
    <SprintTriageTable
      stories={[story]}
      tasks={[task]}
      goals={[goal]}
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

describe('column order', () => {
  it('puts Parent directly after Title', () => {
    renderTable();
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(headers.indexOf('Parent')).toBe(headers.indexOf('Title') + 1);
  });

  it('puts Criticality directly after Status', () => {
    renderTable();
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(headers.indexOf('Criticality')).toBe(headers.indexOf('Status') + 1);
  });
});

describe('missing-data shading', () => {
  // Same red as ModernStoriesTable's data-quality columns — the two surfaces must mean the
  // same thing by the same colour, or the signal is worthless.
  const RED = 'rgba(239, 68, 68, 0.14)';

  const cellFor = (rowText: string, columnLabel: string) => {
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    const row = screen.getByText(rowText).closest('tr')!;
    return row.querySelectorAll('td')[headers.indexOf(columnLabel)];
  };

  it('shades the acceptance criteria cell when there are none', () => {
    renderTable();
    expect(cellFor(task.title, 'Acceptance criteria')).toHaveStyle({ backgroundColor: RED });
  });

  it('shades the parent cell when nothing parents the row', () => {
    renderTable();
    expect(cellFor(task.title, 'Parent')).toHaveStyle({ backgroundColor: RED });
  });

  it('leaves a fully-populated row unshaded', () => {
    renderTable();
    expect(cellFor(LONG_TITLE, 'Acceptance criteria')).not.toHaveStyle({ backgroundColor: RED });
    expect(cellFor(LONG_TITLE, 'Parent')).not.toHaveStyle({ backgroundColor: RED });
  });
});

describe('criticality, points and time of day', () => {
  const { updateDoc } = require('firebase/firestore');

  it('writes priority — not aiCriticalityScore — from the criticality dropdown', async () => {
    // aiCriticalityScore is the model's computed 0-100 score and is shown read-only in the AI
    // column. The editable field here is the human-set `priority`.
    renderTable();
    const select = screen.getAllByTitle(/^Criticality \(priority\)/)[0];
    await userEvent.selectOptions(select, '4');
    expect(updateDoc).toHaveBeenCalledWith(undefined, expect.objectContaining({ priority: 4 }));
  });

  it('clamps points to the entity ceiling', async () => {
    // A story tops out at 13; typing 99 must not persist 99. Rows sort by type ascending
    // ('story' < 'task'), so [0] is the story.
    renderTable();
    await userEvent.click(screen.getAllByTitle('Points')[0]);
    const input = await screen.findByRole('spinbutton');
    await userEvent.clear(input);
    await userEvent.type(input, '99');
    await userEvent.tab();
    expect(updateDoc).toHaveBeenCalledWith(undefined, expect.objectContaining({ points: 13 }));
  });

  it('writes timeOfDay, and clears it back to null for Any time', async () => {
    renderTable();
    const select = screen.getAllByTitle(/Time of day/)[0];
    await userEvent.selectOptions(select, 'morning');
    expect(updateDoc).toHaveBeenCalledWith(undefined, expect.objectContaining({ timeOfDay: 'morning' }));
  });
});

describe('status rendering', () => {
  it('renders in-progress as plain text, not a filled chip', () => {
    // An active sprint is mostly in-progress rows, so the chip was a wall of identical blue
    // boxes. Backlog and Done are the states worth spotting.
    renderTable();
    const inProgress = screen.getByTitle('In Progress');
    expect(inProgress).toHaveStyle({ backgroundColor: 'transparent', borderStyle: 'none' });
  });

  it('keeps the filled chip for backlog and done', () => {
    renderTable();
    // statusLabel returns the lane label, so a task on status 0 reads 'Backlog'.
    expect(screen.getByTitle('Backlog')).not.toHaveStyle({ backgroundColor: 'transparent' });
  });

  it('leaves in-progress editable despite losing the box', async () => {
    // Dropping the border must not cost the dropdown — the caret is what signals it is one.
    const { updateDoc } = require('firebase/firestore');
    renderTable();
    await userEvent.selectOptions(screen.getByTitle('In Progress'), '4');
    expect(updateDoc).toHaveBeenCalledWith(undefined, expect.objectContaining({ status: 4 }));
  });
});

describe('row alignment', () => {
  it('vertically centres the title and description', () => {
    // Acceptance criteria make rows tall; a short title pinned to the top of a five-line row
    // reads as belonging to nothing.
    const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    renderTable();
    const cols = headers();
    const row = screen.getByText(LONG_TITLE).closest('tr')!;
    const cells = row.querySelectorAll('td');
    expect(cells[cols.indexOf('Title')]).toHaveStyle({ verticalAlign: 'middle' });
    expect(cells[cols.indexOf('Description')]).toHaveStyle({ verticalAlign: 'middle' });
  });
});

describe('adding a note', () => {
  it('offers an add affordance when there is no note', () => {
    renderTable();
    expect(screen.getAllByText('Add note').length).toBeGreaterThan(0);
  });

  it('writes through ActivityStreamService so ownerUid and the note shape are right', async () => {
    // A hand-rolled addDoc that missed ownerUid would save without error and then never
    // appear — Firestore rules require it on create, and this table's own listener filters
    // on it.
    renderTable();
    await userEvent.click(screen.getAllByText('Add note')[0]);
    const box = await screen.findByPlaceholderText(/Add a note/);
    await userEvent.type(box, 'Blocked on the licensing quote');
    await userEvent.tab();

    expect(mockAddNote).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/^(story|task)$/),
      'Blocked on the licensing quote',
      'u1',
      'jim@jc1.tech',
      expect.any(String),
      expect.any(String),
      'human',
    );
  });

  it('does not write an empty note', async () => {
    renderTable();
    await userEvent.click(screen.getAllByText('Add note')[0]);
    const box = await screen.findByPlaceholderText(/Add a note/);
    await userEvent.type(box, '   ');
    await userEvent.tab();
    expect(mockAddNote).not.toHaveBeenCalled();
  });
});
