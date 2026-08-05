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
  16: 'Business Experiments',
};

/** Legacy names still present in the data, mapped to their current theme id. */
const LEGACY_THEME_IDS = {
  Health: 1, Growth: 9, Wealth: 3, Tribe: 5, Home: 8, Career: 2, Learning: 4,
  Finance: 3, Financial: 3, General: 0, Work: 12, 'Work (Main Gig)': 12,
  'Main Gig': 12, 'Side Gig': 15, SideGig: 15, 'Side-Gig': 15, Sleep: 13, Random: 14,
  'Business Experiments': 16, Business: 16, Experiments: 16,
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
 * A folder already belonging to this entity, found anywhere in Drive by its ref prefix.
 *
 * findOrCreateFolder only matches an exact name inside one parent, which misses two real cases
 * and silently creates a duplicate in both:
 *   1. The folder exists but sits somewhere else — filed by hand, or created before the theme
 *      level existed, so `GR-92377 — …` is not under {Theme}/ where the exact search looks.
 *   2. The entity was renamed. buildFolderName then produces a different string, the exact search
 *      misses, and the original folder is orphaned with all its files still in it.
 *
 * The ref is the stable identity here — titles and locations are not — so adoption is keyed on it.
 * Drive's `contains` is a loose substring match, hence the startsWith filter: `GR-9` must not
 * adopt `GR-92377`'s folder.
 */
async function findFolderByRef(drive, ref) {
  if (!ref) return null;
  const escapedRef = String(ref).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  try {
    const res = await drive.files.list({
      q: `name contains '${escapedRef}' and mimeType='${FOLDER_MIME}' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
      pageSize: 10,
    });
    const match = (res.data.files || []).find((f) => String(f.name || '').startsWith(String(ref)));
    return match ? match.id : null;
  } catch (err) {
    // Adoption is an optimisation, not a requirement. A failed search must fall through to
    // creating the folder rather than failing the whole resolve.
    console.warn(`[driveHierarchy] ref search failed for ${ref}:`, err.message);
    return null;
  }
}

/**
 * The entity's folder id and its ref, without creating anything.
 *
 * The panel in the edit modals needs to know whether a folder exists in order to decide between
 * showing files and offering to create one. It cannot call ensureEntityFolder to find out —
 * that creates the folder as a side effect, which would mean every goal anyone merely opened
 * grew a Drive folder.
 */
async function lookupEntityFolder(uid, entityType, entityId) {
  const collection = entityType === 'goal' ? 'goals' : entityType === 'story' ? 'stories' : 'tasks';
  const db = admin.firestore();
  const snap = await db.collection(collection).doc(String(entityId)).get();
  if (!snap.exists) throw new Error(`${entityType} ${entityId} not found`);
  const data = snap.data();

  if (data.driveFolderId) {
    return { folderId: data.driveFolderId, ref: data.ref || null, adopted: false };
  }

  // No stored id, but a folder may still exist from a previous life. Report it so the UI can
  // offer "link this" rather than "create one", without writing anything yet.
  const drive = await getDriveClient(uid);
  const found = await findFolderByRef(drive, data.ref);
  return { folderId: found, ref: data.ref || null, adopted: Boolean(found) };
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

/**
 * The entity's folder: adopt an existing one found by ref, else the normal name-in-parent
 * resolve. Adoption deliberately does not move the folder under {Theme}/ — the files are where
 * the user put them, and silently relocating someone's Drive contents is a bigger intervention
 * than declining to make a second folder.
 */
async function adoptOrCreateFolder(drive, ref, name, parentId) {
  const adopted = await findFolderByRef(drive, ref);
  if (adopted) return adopted;
  return findOrCreateFolder(drive, name, parentId);
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
  const folderId = await adoptOrCreateFolder(drive, goal.ref, folderName, themeFolderId);
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
  const folderId = await adoptOrCreateFolder(drive, story.ref, folderName, parentFolderId);
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
        parentFolderId = await adoptOrCreateFolder(drive, story.ref, storyFolderName, storyParentId);
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
  const folderId = await adoptOrCreateFolder(drive, task.ref, folderName, parentFolderId);
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
  lookupEntityFolder,
  findFolderByRef,
  listFolder,
  getDriveClient,
  // Exported for the alignment tests and for anything that needs to predict a folder name
  // without touching Drive.
  buildFolderName,
  normaliseTheme,
  ROOT_FOLDER_NAME,
};
