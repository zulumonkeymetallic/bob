/**
 * driveHierarchy — the ONE definition of where a goal, story or task's files live in Drive.
 *
 * Canonical, deliberately: Hermes' bob_file_organiser.py used to compute its own paths with a
 * different naming rule (`GR-123 slugified-title`, 45 chars) and a different shape (theme at
 * the top, but goals nested under it), while this module used `GR-123 — Plain Title` with goals
 * at the Drive root. Two conventions meant two parallel folder trees for the same work. The
 * organiser now reads `driveFolderId` from the Firestore doc this module writes, and only falls
 * back to building a path when the field is absent — so there is one tree and one naming rule,
 * defined here.
 *
 * Shape:
 *   BOB-Files/{Theme}/{GR-REF — Goal title}/{ST-REF — Story title}/{TK-REF — Task title}
 *
 * The theme level is not decoration: without it every goal folder sits loose at the Drive root,
 * which for a real account is 120+ top-level folders.
 *
 * The resolved folder id is written back onto the entity as `driveFolderId`, which is what
 * makes this usable from the web app at all — nothing else can find a folder by name reliably
 * once titles are edited.
 */
const admin = require('firebase-admin');
const { google } = require('googleapis');

const GOOGLE_REGION = 'europe-west2';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Everything BOB files lives under this single root, not at the Drive root. */
const ROOT_FOLDER_NAME = 'BOB-Files';
const UNLINKED_STORIES_THEME = 'Unlinked Stories';
const UNLINKED_TASKS_THEME = 'Unlinked Tasks';

/**
 * Canonical theme id → label, matching react-app/src/constants/globalThemes.ts and the same
 * table in bob_file_organiser.py. Several write paths store the raw numeric id rather than a
 * label, so a folder name would otherwise read "1" instead of "Health & Fitness".
 */
const THEME_ID_LABELS = {
  0: 'General', 1: 'Health & Fitness', 2: 'Career & Professional',
  3: 'Finance & Wealth', 4: 'Learning & Education', 5: 'Family & Relationships',
  6: 'Hobbies & Interests', 7: 'Travel & Adventure', 8: 'Home & Living',
  9: 'Spiritual & Personal Growth', 10: 'Chores', 11: 'Rest & Recovery',
  12: 'Work (Main Gig)', 13: 'Sleep', 14: 'Random', 15: 'Side Gig',
};

/** Legacy names still present in the data, mapped to their current theme id. */
const LEGACY_THEME_IDS = {
  Health: 1, Growth: 9, Wealth: 3, Tribe: 5, Home: 8, Career: 2, Learning: 4,
  Finance: 3, Financial: 3, General: 0, Work: 12, 'Work (Main Gig)': 12,
  'Main Gig': 12, 'Side Gig': 15, SideGig: 15, 'Side-Gig': 15, Sleep: 13, Random: 14,
};

/** A theme value of any shape (id, numeric string, name, legacy name) to its folder label. */
function normaliseTheme(raw) {
  if (raw === null || raw === undefined || raw === '') return 'General';
  if (typeof raw === 'number') return THEME_ID_LABELS[raw] || 'General';
  const s = String(raw).trim();
  if (!s) return 'General';
  if (/^\d+$/.test(s)) return THEME_ID_LABELS[Number(s)] || 'General';
  if (Object.values(THEME_ID_LABELS).includes(s)) return s;
  const legacyId = LEGACY_THEME_IDS[s];
  return legacyId !== undefined ? THEME_ID_LABELS[legacyId] : s;
}

function buildRedirectUri() {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
  if (!projectId) return null;
  return `https://${GOOGLE_REGION}-${projectId}.cloudfunctions.net/oauthCallback`;
}

async function getOAuth2Client(uid) {
  const db = admin.firestore();
  const [tokenSnap, userSnap] = await Promise.all([
    db.collection('tokens').doc(uid).get().catch(() => null),
    db.collection('users').doc(uid).get().catch(() => null),
  ]);
  const tokenData = tokenSnap?.exists ? (tokenSnap.data() || {}) : {};
  const userData = userSnap?.exists ? (userSnap.data() || {}) : {};
  const refreshToken = String(
    tokenData.refresh_token ||
    tokenData.googleCalendarTokens?.refresh_token ||
    userData.googleCalendarTokens?.refresh_token ||
    ''
  ).trim();
  if (!refreshToken) throw new Error('Google not connected — reconnect Google Calendar to enable Drive hierarchy');

  const clientId = String(process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const redirectUri = buildRedirectUri();
  if (!clientId || !clientSecret) throw new Error('Google OAuth not configured');

  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

async function getDriveClient(uid) {
  const auth = await getOAuth2Client(uid);
  return google.drive({ version: 'v3', auth });
}

async function findOrCreateFolder(drive, name, parentId) {
  const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = parentId
    ? `name='${escapedName}' and mimeType='${FOLDER_MIME}' and '${parentId}' in parents and trashed=false`
    : `name='${escapedName}' and mimeType='${FOLDER_MIME}' and 'root' in parents and trashed=false`;

  const listRes = await drive.files.list({ q, fields: 'files(id)', spaces: 'drive', pageSize: 1 });
  if (listRes.data.files?.length > 0) return listRes.data.files[0].id;

  const createRes = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: 'id',
  });
  return createRes.data.id;
}

/**
 * `GR-1T1033 — Get to 12% body fat`.
 *
 * Em dash separator and the title left readable rather than slugified: these are folders a
 * human browses in Drive, not URL segments. Slashes become spaces because Drive treats them as
 * path separators in search queries. 80 chars keeps the name usable in Drive's UI.
 *
 * Hermes matches this exactly — see build_folder_name in bob_file_organiser.py.
 */
function buildFolderName(ref, title) {
  const safeTitle = String(title || 'Untitled').replace(/[/\\]/g, ' ').slice(0, 80).trim();
  return ref ? `${ref} — ${safeTitle}` : safeTitle;
}

/** BOB-Files, created at the Drive root once. */
async function ensureRootFolder(drive) {
  return findOrCreateFolder(drive, ROOT_FOLDER_NAME, null);
}

/** BOB-Files/{Theme} — the level that stops 120 goal folders landing at the Drive root. */
async function ensureThemeFolder(drive, theme) {
  const rootId = await ensureRootFolder(drive);
  return findOrCreateFolder(drive, normaliseTheme(theme), rootId);
}

async function ensureGoalFolderWithDrive(drive, db, goalId) {
  const goalSnap = await db.collection('goals').doc(goalId).get();
  if (!goalSnap.exists) throw new Error(`Goal ${goalId} not found`);
  const goal = goalSnap.data();
  if (goal.driveFolderId) return goal.driveFolderId;

  const themeFolderId = await ensureThemeFolder(drive, goal.theme);
  const folderName = buildFolderName(goal.ref, goal.title);
  const folderId = await findOrCreateFolder(drive, folderName, themeFolderId);
  await db.collection('goals').doc(goalId).set(
    { driveFolderId: folderId, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
  return folderId;
}

async function ensureGoalFolder(uid, goalId) {
  const db = admin.firestore();
  const drive = await getDriveClient(uid);
  return ensureGoalFolderWithDrive(drive, db, goalId);
}

async function ensureStoryFolder(uid, storyId) {
  const db = admin.firestore();
  const storySnap = await db.collection('stories').doc(storyId).get();
  if (!storySnap.exists) throw new Error(`Story ${storyId} not found`);
  const story = storySnap.data();
  if (story.driveFolderId) return story.driveFolderId;

  const drive = await getDriveClient(uid);

  let parentFolderId = null;
  if (story.goalId) {
    parentFolderId = await ensureGoalFolderWithDrive(drive, db, story.goalId).catch((e) => {
      console.warn(`[driveHierarchy] ensureGoalFolder failed for ${story.goalId}:`, e.message);
      return null;
    });
  }
  if (!parentFolderId) {
    parentFolderId = await ensureThemeFolder(drive, UNLINKED_STORIES_THEME);
  }

  const folderName = buildFolderName(story.ref, story.title);
  const folderId = await findOrCreateFolder(drive, folderName, parentFolderId);
  await db.collection('stories').doc(storyId).set(
    { driveFolderId: folderId, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
  return folderId;
}

async function ensureTaskFolder(uid, taskId) {
  const db = admin.firestore();
  const taskSnap = await db.collection('tasks').doc(taskId).get();
  if (!taskSnap.exists) throw new Error(`Task ${taskId} not found`);
  const task = taskSnap.data();
  if (task.driveFolderId) return task.driveFolderId;

  const drive = await getDriveClient(uid);

  let parentFolderId = null;
  if (task.parentId && task.parentType === 'story') {
    const storySnap = await db.collection('stories').doc(task.parentId).get().catch(() => null);
    if (storySnap?.exists) {
      const story = storySnap.data();
      if (story.driveFolderId) {
        parentFolderId = story.driveFolderId;
      } else {
        // Build story folder without re-fetching drive client
        let storyParentId = null;
        if (story.goalId) {
          storyParentId = await ensureGoalFolderWithDrive(drive, db, story.goalId).catch(() => null);
        }
        if (!storyParentId) storyParentId = await ensureThemeFolder(drive, UNLINKED_STORIES_THEME);
        const storyFolderName = buildFolderName(story.ref, story.title);
        parentFolderId = await findOrCreateFolder(drive, storyFolderName, storyParentId);
        await db.collection('stories').doc(task.parentId).set(
          { driveFolderId: parentFolderId, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
      }
    }
  }
  if (!parentFolderId) {
    parentFolderId = await ensureThemeFolder(drive, UNLINKED_TASKS_THEME);
  }

  const folderName = buildFolderName(task.ref, task.title);
  const folderId = await findOrCreateFolder(drive, folderName, parentFolderId);
  await db.collection('tasks').doc(taskId).set(
    { driveFolderId: folderId, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
  return folderId;
}

/** Dispatch by entity type, so callers do not repeat this switch. */
async function ensureEntityFolder(uid, entityType, entityId) {
  if (entityType === 'goal') return ensureGoalFolder(uid, entityId);
  if (entityType === 'story') return ensureStoryFolder(uid, entityId);
  if (entityType === 'task') return ensureTaskFolder(uid, entityId);
  throw new Error(`Unsupported entity type: ${entityType}`);
}

/**
 * Files and sub-folders directly inside a folder, for the in-app browser.
 *
 * Non-recursive by design: the hierarchy IS the navigation, so a flat recursive dump would
 * throw away the structure the rest of this module exists to maintain.
 */
async function listFolder(uid, folderId, { pageSize = 100, pageToken = null } = {}) {
  const drive = await getDriveClient(uid);
  const res = await drive.files.list({
    q: `'${String(folderId).replace(/'/g, "\\'")}' in parents and trashed=false`,
    fields: 'nextPageToken, files(id, name, mimeType, iconLink, webViewLink, modifiedTime, size)',
    orderBy: 'folder,modifiedTime desc',
    spaces: 'drive',
    pageSize,
    ...(pageToken ? { pageToken } : {}),
  });
  return {
    files: (res.data.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      isFolder: f.mimeType === FOLDER_MIME,
      iconLink: f.iconLink || null,
      webViewLink: f.webViewLink || null,
      modifiedTime: f.modifiedTime || null,
      size: f.size ? Number(f.size) : null,
    })),
    nextPageToken: res.data.nextPageToken || null,
  };
}

module.exports = {
  ensureGoalFolder,
  ensureStoryFolder,
  ensureTaskFolder,
  ensureEntityFolder,
  listFolder,
  getDriveClient,
  // Exported for the alignment tests and for anything that needs to predict a folder name
  // without touching Drive.
  buildFolderName,
  normaliseTheme,
  ROOT_FOLDER_NAME,
};
