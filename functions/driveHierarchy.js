const admin = require('firebase-admin');
const { google } = require('googleapis');

const GOOGLE_REGION = 'europe-west2';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

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

function buildFolderName(ref, title) {
  const safeTitle = String(title || 'Untitled').replace(/[/\\]/g, ' ').slice(0, 80).trim();
  return ref ? `${ref} — ${safeTitle}` : safeTitle;
}

async function ensureGoalFolderWithDrive(drive, db, goalId) {
  const goalSnap = await db.collection('goals').doc(goalId).get();
  if (!goalSnap.exists) throw new Error(`Goal ${goalId} not found`);
  const goal = goalSnap.data();
  if (goal.driveFolderId) return goal.driveFolderId;

  const folderName = buildFolderName(goal.ref, goal.title);
  const folderId = await findOrCreateFolder(drive, folderName, null);
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
    parentFolderId = await findOrCreateFolder(drive, 'BOB — Unlinked Stories', null);
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
        if (!storyParentId) storyParentId = await findOrCreateFolder(drive, 'BOB — Unlinked Stories', null);
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
    parentFolderId = await findOrCreateFolder(drive, 'BOB — Unlinked Tasks', null);
  }

  const folderName = buildFolderName(task.ref, task.title);
  const folderId = await findOrCreateFolder(drive, folderName, parentFolderId);
  await db.collection('tasks').doc(taskId).set(
    { driveFolderId: folderId, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
  return folderId;
}

module.exports = { ensureGoalFolder, ensureStoryFolder, ensureTaskFolder, getDriveClient };
