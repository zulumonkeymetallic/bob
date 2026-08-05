import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WorkAreaLinks from './WorkAreaLinks';

/**
 * Goals ▸ Stories ▸ Tasks is one hierarchy read at three depths. The page you are on is the
 * heading, so it must not also appear as a link beside itself.
 */

const renderAt = (current: 'goals' | 'stories' | 'tasks') =>
  render(
    <MemoryRouter>
      <WorkAreaLinks current={current} />
    </MemoryRouter>,
  );

describe('WorkAreaLinks', () => {
  it('links the two sibling lists and omits the current one', () => {
    renderAt('goals');
    expect(screen.getByRole('link', { name: 'Stories' })).toHaveAttribute('href', '/stories');
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '/tasks');
    expect(screen.queryByRole('link', { name: 'Goals' })).toBeNull();
  });

  it('works from Stories', () => {
    renderAt('stories');
    expect(screen.getByRole('link', { name: 'Goals' })).toHaveAttribute('href', '/goals');
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '/tasks');
    expect(screen.queryByRole('link', { name: 'Stories' })).toBeNull();
  });

  it('works from Tasks', () => {
    renderAt('tasks');
    expect(screen.getByRole('link', { name: 'Goals' })).toHaveAttribute('href', '/goals');
    expect(screen.getByRole('link', { name: 'Stories' })).toHaveAttribute('href', '/stories');
    expect(screen.queryByRole('link', { name: 'Tasks' })).toBeNull();
  });

  it('renders real anchors, so cmd-click and middle-click open a new tab', () => {
    renderAt('goals');
    screen.getAllByRole('link').forEach((link) => {
      expect(link.tagName).toBe('A');
    });
  });
});
