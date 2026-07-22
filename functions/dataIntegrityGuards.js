'use strict';

const admin = require('firebase-admin');
const { onDocumentWritten, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { deleteGoogleCalendarEvent } = require('./calendarSync');

if (!admin.apps.length) admin.initializeApp();

const GOOGLE_OAUTH_CLIENT_ID = defineSecret('GOOGLE_OAUTH_CLIENT_ID');
const GOOGLE_OAUTH_CLIENT_SECRET = defineSecret('GOOGLE_OAUTH_CLIENT_SECRET');

// Targeted delete for specific, already-identified Google Calendar event ids — for when
// the general-purpose cleanupOrphanedCalendarEventsNow sweep (which scans a 111-day
// window of every event on the calendar) is too slow to finish inside its timeout, or
// when the zombie events are already known from a direct Firestore audit. Auth'd callers
// can only delete their own events (uid comes from the auth context, not the request).
exports.deleteGoogleCalendarEventsNow = onCall({ secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET] }, async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
  const eventIds = Array.isArray(req?.data?.eventIds) ? req.data.eventIds.filter(Boolean) : [];
  if (eventIds.length === 0) throw new HttpsError('invalid-argument', 'eventIds required');
  const results = [];
  for (const eventId of eventIds) {
    const result = await deleteGoogleCalendarEvent(uid, eventId);
    results.push({ eventId, ...result });
  }
  return { ok: true, results };
});

// ─── Duplicate manual-priority-rank guard ──────────────────────────────────
// Prevents two stories sharing the same userPriorityRank (1-5) within the same
// owner+persona, regardless of which client/script performed the write. EditStoryModal's
// own "auto-demote the previous holder" logic only guards saves made through that one
// modal — any other write path (AI mutation scripts, other UI, imports) could still slot
// a second story into an already-taken rank. This closes the gap at the data layer: the
// most recent write to claim a rank keeps it, and whichever other story was holding it
// gets demoted.
exports.enforceUniqueStoryPriorityRank = onDocumentWritten('stories/{storyId}', async (event) => {
  const after = event.data?.after?.data();
  if (!after) return; // deletion — nothing to enforce

  const rank = Number(after.userPriorityRank);
  if (!Number.isFinite(rank) || rank < 1 || rank > 5) return;

  const before = event.data?.before?.data() || null;
  const beforeRank = before ? Number(before.userPriorityRank) : null;
  if (before && beforeRank === rank) return; // unchanged — already reconciled on a prior write

  const storyId = event.params.storyId;
  const ownerUid = after.ownerUid;
  if (!ownerUid) return;
  const persona = String(after.persona || 'personal');

  try {
    const db = admin.firestore();
    const conflictSnap = await db.collection('stories')
      .where('ownerUid', '==', ownerUid)
      .where('userPriorityRank', '==', rank)
      .get();

    const batch = db.batch();
    let demoted = 0;
    for (const doc of conflictSnap.docs) {
      if (doc.id === storyId) continue;
      const data = doc.data();
      if (String(data.persona || 'personal') !== persona) continue;
      if (Number(data.status) >= 4) continue; // done stories aren't holding a live slot
      batch.update(doc.ref, {
        userPriorityFlag: false,
        userPriorityRank: null,
        userPriorityFlagAt: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      demoted += 1;
    }
    if (demoted > 0) {
      await batch.commit();
      console.log(`[enforceUniqueStoryPriorityRank] rank ${rank}: demoted ${demoted} conflicting stor${demoted === 1 ? 'y' : 'ies'}, winner ${storyId}`);
    }
  } catch (e) {
    console.error('[enforceUniqueStoryPriorityRank] failed', storyId, e?.message || e);
  }
});

// ─── Calendar cleanup on task/story deletion ───────────────────────────────
// Deleting a task/story never cascaded to its calendar_blocks. The nightly forward
// planner only sweeps *future* sprint_forward_plan blocks before regenerating, so any
// block already pushed to Google Calendar — or one whose date had already passed by the
// time the task was deleted — was orphaned permanently: the real GCal event stayed on
// the calendar forever, referencing an entity that no longer exists (confirmed live,
// 2026-07-22: "Get Colm a bottle of whiskey" and "Ask for a trend of my 5K/10K times"
// both kept re-appearing on the calendar for tasks deleted weeks earlier). This deletes
// every calendar_blocks doc tied to the deleted entity and, for any that already made it
// to Google Calendar, deletes the real event too — regardless of the block's "source"
// field, unlike onCalendarBlockWrite's general-purpose cleanup guard, because here we
// have direct proof (the owning task/story) that removal is intended.
async function cleanupCalendarBlocksForEntity(field, entityId, fallbackOwnerUid) {
  const db = admin.firestore();
  const snap = await db.collection('calendar_blocks').where(field, '==', entityId).get();
  if (snap.empty) return { removed: 0, gcalDeleted: 0 };

  let removed = 0;
  let gcalDeleted = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const googleEventId = data.googleEventId;
    const ownerUid = data.ownerUid || fallbackOwnerUid;
    await doc.ref.delete();
    removed += 1;
    if (googleEventId && ownerUid) {
      const result = await deleteGoogleCalendarEvent(ownerUid, googleEventId)
        .catch((e) => ({ ok: false, reason: e?.message || String(e) }));
      if (result?.ok) gcalDeleted += 1;
    }
  }
  return { removed, gcalDeleted };
}

exports.onTaskDeleteCleanupCalendar = onDocumentDeleted({ document: 'tasks/{taskId}', secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET] }, async (event) => {
  const data = event.data?.data() || {};
  const taskId = event.params.taskId;
  try {
    const result = await cleanupCalendarBlocksForEntity('taskId', taskId, data.ownerUid);
    if (result.removed > 0) {
      console.log(`[onTaskDeleteCleanupCalendar] task ${taskId}: removed ${result.removed} block(s), deleted ${result.gcalDeleted} GCal event(s)`);
    }
  } catch (e) {
    console.error('[onTaskDeleteCleanupCalendar] failed', taskId, e?.message || e);
  }
});

exports.onStoryDeleteCleanupCalendar = onDocumentDeleted({ document: 'stories/{storyId}', secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET] }, async (event) => {
  const data = event.data?.data() || {};
  const storyId = event.params.storyId;
  try {
    const result = await cleanupCalendarBlocksForEntity('storyId', storyId, data.ownerUid);
    if (result.removed > 0) {
      console.log(`[onStoryDeleteCleanupCalendar] story ${storyId}: removed ${result.removed} block(s), deleted ${result.gcalDeleted} GCal event(s)`);
    }
  } catch (e) {
    console.error('[onStoryDeleteCleanupCalendar] failed', storyId, e?.message || e);
  }
});

exports._cleanupCalendarBlocksForEntity = cleanupCalendarBlocksForEntity;
