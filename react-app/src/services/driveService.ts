/**
 * driveService — the client half of functions/driveHierarchy.js.
 *
 * Two calls, matching the two callables: resolve an entity's Drive folder (creating it and the
 * theme/goal/story chain above it on demand), and list what is inside a folder.
 *
 * Nothing here builds folder paths or names. The hierarchy is defined server-side precisely so
 * that the web app, the Cloud Functions and Hermes' bob_file_organiser.py cannot drift into
 * separate folder trees — which is exactly what happened when two of them each had their own
 * naming rule. If you need to know where something lives, ask the server.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

export type DriveEntityType = 'goal' | 'story' | 'task';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  iconLink: string | null;
  webViewLink: string | null;
  modifiedTime: string | null;
  size: number | null;
}

export interface DriveListing {
  files: DriveFile[];
  nextPageToken: string | null;
}

/** Drive's own URL for a folder, for the "open in Drive" escape hatch. */
export const driveFolderUrl = (folderId: string) =>
  `https://drive.google.com/drive/folders/${folderId}`;

/**
 * Thrown when Google is not connected, as opposed to a genuine failure. The UI needs to tell
 * the user to reconnect rather than showing "something went wrong" — the server maps this to
 * `failed-precondition` for the same reason.
 */
export class DriveNotConnectedError extends Error {}

/** Codes Firebase hands back as the whole message, which say nothing to a user. */
const OPAQUE_MESSAGES = new Set(['internal', 'unknown', 'not-found', 'unavailable', 'cancelled']);

const normalise = (err: any): Error => {
  const code = String(err?.code || '').replace(/^functions\//, '');
  const message = String(err?.message || '').trim();

  if (code === 'failed-precondition' || /not connected|not configured/i.test(message)) {
    return new DriveNotConnectedError(
      'Google Drive is not connected. Reconnect Google in Settings → Integrations to use files.',
    );
  }

  /**
   * A callable that is not deployed fails its CORS preflight, and the SDK surfaces that as a
   * bare "internal" — indistinguishable from a server crash, and exactly what you get between
   * merging these functions and running ./build web. Say so, rather than showing the user the
   * word "internal".
   */
  if (
    code === 'not-found'
    || /preflight|access control checks|failed to fetch|cors/i.test(message)
  ) {
    return new Error('The Drive service is not reachable — the Cloud Function may not be deployed yet.');
  }

  if (!message || OPAQUE_MESSAGES.has(message.toLowerCase())) {
    return new Error(
      'The Drive service failed and did not say why. It may not be deployed yet; otherwise check the Firebase function logs.',
    );
  }

  return new Error(message);
};

/** The entity's folder id, creating the folder (and its parents) if it does not exist yet. */
export async function ensureDriveFolder(
  entityType: DriveEntityType,
  entityId: string,
): Promise<{ folderId: string; webViewLink: string }> {
  try {
    const callable = httpsCallable<
      { entityType: DriveEntityType; entityId: string },
      { ok: boolean; folderId: string; webViewLink: string }
    >(functions, 'ensureDriveFolder');
    const res = await callable({ entityType, entityId });
    return { folderId: res.data.folderId, webViewLink: res.data.webViewLink };
  } catch (err) {
    throw normalise(err);
  }
}

export interface DriveLookup {
  /** null when no folder exists yet — the caller should offer to create one. */
  folderId: string | null;
  ref: string | null;
  /** True when the folder was found by ref rather than read from `driveFolderId`. */
  adopted: boolean;
  webViewLink: string | null;
}

/**
 * Whether this entity has a folder, without creating one.
 *
 * The panel renders on every modal open, so it must not call ensureDriveFolder to find out —
 * that creates the folder as a side effect and would grow a Drive tree for every item merely
 * opened. Creation stays an explicit user action.
 */
export async function lookupDriveFolder(
  entityType: DriveEntityType,
  entityId: string,
): Promise<DriveLookup> {
  try {
    const callable = httpsCallable<
      { entityType: DriveEntityType; entityId: string },
      { ok: boolean } & DriveLookup
    >(functions, 'lookupDriveFolder');
    const res = await callable({ entityType, entityId });
    return {
      folderId: res.data.folderId ?? null,
      ref: res.data.ref ?? null,
      adopted: Boolean(res.data.adopted),
      webViewLink: res.data.webViewLink ?? null,
    };
  } catch (err) {
    throw normalise(err);
  }
}

/** One level of a folder — sub-folders first, then files by most recently modified. */
export async function listDriveFolder(
  folderId: string,
  opts: { pageToken?: string | null; pageSize?: number } = {},
): Promise<DriveListing> {
  try {
    const callable = httpsCallable<
      { folderId: string; pageToken?: string | null; pageSize?: number },
      { ok: boolean; files: DriveFile[]; nextPageToken: string | null }
    >(functions, 'listDriveFolder');
    const res = await callable({
      folderId,
      pageToken: opts.pageToken ?? null,
      pageSize: opts.pageSize ?? 100,
    });
    return { files: res.data.files || [], nextPageToken: res.data.nextPageToken ?? null };
  } catch (err) {
    throw normalise(err);
  }
}

/** Bytes to something readable. Drive omits size for native Docs/Sheets, hence the null case. */
export function formatFileSize(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
