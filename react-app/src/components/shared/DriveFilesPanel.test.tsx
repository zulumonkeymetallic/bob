import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DriveFilesPanel from './DriveFilesPanel';

/**
 * The behaviour worth pinning here is the one that is easy to regress into something expensive:
 * the panel must NOT create a Drive folder just by rendering. It sits in every edit modal, so an
 * ensureDriveFolder call on mount would grow the BOB-Files tree for every goal, story and task
 * anyone opened — and because it would look like it was working, nobody would notice until Drive
 * was full of empty folders.
 */

const mockEnsure = jest.fn();
const mockLookup = jest.fn();
const mockList = jest.fn();

jest.mock('../../services/driveService', () => ({
  ensureDriveFolder: (...args: any[]) => mockEnsure(...args),
  lookupDriveFolder: (...args: any[]) => mockLookup(...args),
  listDriveFolder: (...args: any[]) => mockList(...args),
  driveFolderUrl: (id: string) => `https://drive.google.com/drive/folders/${id}`,
  formatFileSize: (n: number | null) => (n == null ? '' : `${n} B`),
  DriveNotConnectedError: class extends Error {},
}));

beforeEach(() => {
  mockEnsure.mockResolvedValue({ folderId: 'NEW_FOLDER', webViewLink: 'https://drive/NEW_FOLDER' });
  mockLookup.mockResolvedValue({ folderId: null, ref: 'GR-92377', adopted: false, webViewLink: null });
  mockList.mockResolvedValue({ files: [], nextPageToken: null });
});

const renderPanel = (props: Partial<React.ComponentProps<typeof DriveFilesPanel>> = {}) =>
  render(
    <DriveFilesPanel
      entityType="goal"
      entityId="goal-1"
      entityLabel="GR-92377"
      {...props}
    />,
  );

test('does not create a folder on render', async () => {
  renderPanel();
  await waitFor(() => expect(mockLookup).toHaveBeenCalledWith('goal', 'goal-1'));
  expect(mockEnsure).not.toHaveBeenCalled();
  expect(mockList).not.toHaveBeenCalled();
});

test('offers to create when no folder exists, and creates only on click', async () => {
  renderPanel();
  const button = await screen.findByRole('button', { name: /create drive folder/i });
  expect(mockEnsure).not.toHaveBeenCalled();

  await userEvent.click(button);

  await waitFor(() => expect(mockEnsure).toHaveBeenCalledWith('goal', 'goal-1'));
  await waitFor(() => expect(mockList).toHaveBeenCalledWith('NEW_FOLDER'));
});

test('offers to link, not create, when a folder was found by ref', async () => {
  mockLookup.mockResolvedValue({
    folderId: 'FOUND_BY_REF', ref: 'GR-92377', adopted: true, webViewLink: null,
  });
  renderPanel();

  expect(await screen.findByRole('button', { name: /link existing folder/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /create drive folder/i })).not.toBeInTheDocument();
  // An adopted match is a candidate only — nothing is listed or written until the user links it.
  expect(mockList).not.toHaveBeenCalled();
});

test('lists files when the entity already has a linked folder', async () => {
  mockLookup.mockResolvedValue({
    folderId: 'LINKED', ref: 'GR-92377', adopted: false, webViewLink: 'https://drive/LINKED',
  });
  mockList.mockResolvedValue({
    files: [{
      id: 'f1', name: 'Experiment brief.gdoc', mimeType: 'application/vnd.google-apps.document',
      isFolder: false, iconLink: null, webViewLink: 'https://docs/f1', modifiedTime: null, size: null,
    }],
    nextPageToken: null,
  });

  renderPanel();

  expect(await screen.findByText('Experiment brief.gdoc')).toBeInTheDocument();
  expect(mockEnsure).not.toHaveBeenCalled();
});

test('an unsaved entity is told to save rather than shown a create button', async () => {
  renderPanel({ entityId: null });
  expect(await screen.findByText(/save this item to give it a drive folder/i)).toBeInTheDocument();
  expect(mockLookup).not.toHaveBeenCalled();
});
