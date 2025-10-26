const functionsV2 = require('firebase-functions/v2');
const httpsV2 = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const schedulerV2 = require('firebase-functions/v2/scheduler');
const firestoreV2 = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

functionsV2.setGlobalOptions({ region: 'europe-west2', maxInstances: 10 });
if (!admin.apps.length) admin.initializeApp();

function toDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
function toMillis(value) {
  if (!value && value !== 0) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toDate === 'function') {
    try { const d = value.toDate(); return d instanceof Date ? d.getTime() : null; } catch { return null; }
  }
  if (value && typeof value === 'object' && typeof value.seconds === 'number') {
    const seconds = Number(value.seconds);
    const nanos = Number(value.nanoseconds || value.nanos || 0);
    return seconds * 1000 + Math.round(nanos / 1e6);
  }
  return null;
}
function startOfDay(d) { const nd = new Date(d); nd.setHours(0,0,0,0); return nd; }
function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function dayOfWeekKey(date) { return ['sun','mon','tue','wed','thu','fri','sat'][date.getDay()]; }
function* iterateNextDays(startDate, count) { const d = new Date(startDate); for (let i=0;i<count;i++){ yield new Date(d.getTime()+i*24*60*60*1000);} }

function inferTaskType(data) {
  const rawTitle = String(data?.title || '').toLowerCase();
  const rawList = String(data?.reminderListName || data?.reminderListId || '').toLowerCase();
  const tags = Array.isArray(data?.tags) ? data.tags.map((t) => String(t || '').toLowerCase()) : [];
  const note = String(data?.note || '').toLowerCase();
  const candidates = [rawTitle, rawList, note, ...tags];
  if (candidates.some((s) => s.includes('routine'))) return 'routine';
  if (candidates.some((s) => s.includes('chore'))) return 'chore';
  return null;
}

function normaliseRecurrence(data) {
  const out = {}; let changed = false;
  const freq = data?.repeatFrequency;
  const interval = Number(data?.repeatInterval || 1) || 1;
  const days = Array.isArray(data?.daysOfWeek) ? data.daysOfWeek : null;
  if (!freq && data?.rrule) {
    const r = String(data.rrule).toUpperCase();
    if (r.includes('WEEKLY')) {
      out.repeatFrequency = 'weekly'; changed = true;
      const m = r.match(/BYDAY=([^;]+)/);
      if (m) { const map = { SU:'sun', MO:'mon', TU:'tue', WE:'wed', TH:'thu', FR:'fri', SA:'sat' }; out.daysOfWeek = m[1].split(',').map((s)=>map[s]||null).filter(Boolean); }
    } else if (r.includes('DAILY')) { out.repeatFrequency = 'daily'; changed = true; }
      else if (r.includes('MONTHLY')) { out.repeatFrequency = 'monthly'; changed = true; }
      else if (r.includes('YEARLY') || r.includes('ANNUAL')) { out.repeatFrequency = 'yearly'; changed = true; }
  }
  if (!('repeatInterval' in data) && interval !== 1) { out.repeatInterval = interval; changed = true; }
  if (freq && !['daily','weekly','monthly','yearly'].includes(freq)) { out.repeatFrequency = undefined; changed = true; }
  if (freq === 'weekly' && days && days.length) {
    const valid = ['sun','mon','tue','wed','thu','fri','sat'];
    const cleaned = days.map((d)=>String(d||'').toLowerCase()).filter((d)=>valid.includes(d));
    if (JSON.stringify(cleaned) !== JSON.stringify(days)) { out.daysOfWeek = cleaned; changed = true; }
  }
  return { changed, patch: out };
}

function shouldScheduleOnDay(task, date) {
  const freq = task?.repeatFrequency;
  const interval = Number(task?.repeatInterval || 1) || 1;
  if (!freq) return false;
  if (freq === 'daily') {
    const base = toMillis(task?.lastDoneAt) || toMillis(task?.createdAt) || Date.now();
    const daysDiff = Math.floor((startOfDay(date).getTime() - startOfDay(new Date(base)).getTime()) / (24*60*60*1000));
    return daysDiff % interval === 0;
  }
  if (freq === 'weekly') {
    const allowed = Array.isArray(task?.daysOfWeek) ? task.daysOfWeek : [];
    return allowed.includes(dayOfWeekKey(date));
  }
  if (freq === 'monthly') {
    const base = new Date(toMillis(task?.createdAt) || Date.now());
    return date.getDate() === base.getDate();
  }
  if (freq === 'yearly') {
    const base = new Date(toMillis(task?.createdAt) || Date.now());
    return date.getMonth() === base.getMonth() && date.getDate() === base.getDate();
  }
  return false;
}

async function upsertChoreBlocksForTask(db, task, lookaheadDays = 14) {
  if (!task?.ownerUid || !task?.id) return { created: 0, updated: 0 };
  const ownerUid = task.ownerUid;
  const today = startOfDay(new Date());
  const snoozedUntil = toMillis(task?.snoozedUntil) || 0;
  let created = 0, updated = 0;
  for (const day of iterateNextDays(today, lookaheadDays)) {
    if (snoozedUntil && day.getTime() < startOfDay(new Date(snoozedUntil)).getTime()) continue;
    if (!shouldScheduleOnDay(task, day)) continue;
    const dayKey = toDayKey(day);
    const iso = toISODate(day);
    const docId = `chore_${task.id}_${dayKey}`;
    const ref = db.collection('calendar_blocks').doc(docId);
    const snap = await ref.get();
  const base = {
      ownerUid,
      entityType: 'chore',
      taskId: task.id,
      date: iso,
      title: task.title || 'Chore',
      status: 'planned',
      start: startOfDay(day).getTime(),
      metadata: {
        frequency: task.repeatFrequency || null,
        interval: Number(task.repeatInterval || 1) || 1,
        daysOfWeek: Array.isArray(task.daysOfWeek) ? task.daysOfWeek : null,
      },
    };
    if (snap.exists) {
      const existing = snap.data() || {};
      const needsUpdate = existing.title !== base.title || existing.ownerUid !== ownerUid || existing.status === undefined || existing.start !== base.start;
      if (needsUpdate) {
        await ref.set({ ...existing, ...base, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        updated++;
      }
    } else {
      await ref.set({ ...base, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      created++;
    }
  }
  return { created, updated };
}

exports.onTaskWriteNormalize = firestoreV2.onDocumentWritten('tasks/{id}', async (event) => {
  const db = admin.firestore();
  const id = event?.params?.id;
  const before = event?.data?.before?.data() || null;
  const after = event?.data?.after?.data() || null;
  if (!after) return; // deleted
  const ref = event.data.after.ref;

  const patch = {};
  let needsPatch = false;

  const beforeStatus = Number(before?.status ?? null);
  const afterStatus = Number(after?.status ?? null);
  if ((beforeStatus !== 2) && (afterStatus === 2) && !after?.completedAt) {
    patch.completedAt = admin.firestore.FieldValue.serverTimestamp();
    needsPatch = true;
  }
  if (!after?.type) {
    const inferred = inferTaskType(after);
    if (inferred) { patch.type = inferred; patch.typeInferredAt = admin.firestore.FieldValue.serverTimestamp(); needsPatch = true; }
  }
  const { changed, patch: norm } = normaliseRecurrence(after);
  if (changed) { Object.assign(patch, norm); needsPatch = true; }
  if (needsPatch) {
    patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await ref.set(patch, { merge: true });
  }

  const type = String(after?.type || patch?.type || '').toLowerCase();
  const active = Number(afterStatus) !== 2;
  const isChoreLike = type === 'chore' || type === 'routine';
  if (isChoreLike && active) {
    const task = { id, ...(after || {}), ...(patch || {}) };
    await upsertChoreBlocksForTask(db, task, 14);
  }
  if ((beforeStatus !== 2) && (afterStatus === 2) && isChoreLike) {
    const today = startOfDay(new Date());
    const todayKey = toDayKey(today);
    const blockId = `chore_${id}_${todayKey}`;
    const blockRef = db.collection('calendar_blocks').doc(blockId);
    const snap = await blockRef.get();
    if (snap.exists) { await blockRef.set({ status: 'done', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }); }
    await ref.set({ lastDoneAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }
});

exports.archiveCompletedTasksNightly = schedulerV2.onSchedule('every day 02:30', async () => {
  const db = admin.firestore();
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const snap = await db.collection('tasks').where('status', '==', 2).where('completedAt', '<=', cutoff).get();
  let archived = 0, errors = 0;
  for (const doc of snap.docs) {
    try {
      const data = doc.data() || {};
      const archiveRef = db.collection('tasks_archive').doc(doc.id);
      const ttl = admin.firestore.Timestamp.fromMillis(Date.now() + 90 * 24 * 60 * 60 * 1000);
      await archiveRef.set({ ...data, sourceTaskId: doc.id, archivedAt: admin.firestore.FieldValue.serverTimestamp(), deleteAt: ttl }, { merge: true });
      await doc.ref.delete(); archived++;
    } catch (err) { console.error('[archiver] failed', { id: doc.id, error: err?.message || String(err) }); errors++; }
  }
  try {
    const activityRef = db.collection('activity_stream').doc();
    await activityRef.set({ id: activityRef.id, entityType: 'archiver', activityType: 'tasks_archived', description: `Archived ${archived} tasks (errors: ${errors})`, timestamp: admin.firestore.FieldValue.serverTimestamp() });
  } catch {}
});

exports.ensureChoreBlocksHourly = schedulerV2.onSchedule('every 1 hours', async () => {
  const db = admin.firestore();
  let scanned = 0, created = 0, updated = 0;
  for (const t of ['chore','routine']) {
    const snap = await db.collection('tasks').where('type', '==', t).where('status', '==', 0).get();
    for (const doc of snap.docs) { scanned++; const res = await upsertChoreBlocksForTask(db, { id: doc.id, ...(doc.data()||{}) }, 14); created += res.created; updated += res.updated; }
  }
  try {
    const activityRef = db.collection('activity_stream').doc();
    await activityRef.set({ id: activityRef.id, entityType: 'chore_blocks', activityType: 'ensure_blocks', description: `Ensured blocks: scanned=${scanned}, created=${created}, updated=${updated}`, timestamp: admin.firestore.FieldValue.serverTimestamp() });
  } catch {}
});

exports.completeChoreTask = httpsV2.onCall(async (req) => {
  const uid = req?.auth?.uid; if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const taskId = String(req?.data?.taskId || '').trim(); if (!taskId) throw new httpsV2.HttpsError('invalid-argument', 'taskId required');
  const db = admin.firestore();
  const taskRef = db.collection('tasks').doc(taskId);
  const snap = await taskRef.get(); if (!snap.exists) throw new httpsV2.HttpsError('not-found', 'Task not found');
  const task = snap.data() || {}; if (task.ownerUid !== uid) throw new httpsV2.HttpsError('permission-denied', 'Cannot modify this task');
  const type = String(task?.type || '').toLowerCase(); if (type !== 'chore' && type !== 'routine') throw new httpsV2.HttpsError('failed-precondition', 'Not a chore/routine');
  const todayKey = toDayKey(new Date()); const blockId = `chore_${taskId}_${todayKey}`;
  await db.collection('calendar_blocks').doc(blockId).set({ ownerUid: uid, taskId, entityType: 'chore', status: 'done', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  await taskRef.set({ lastDoneAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true };
});

exports.snoozeChoreTask = httpsV2.onCall(async (req) => {
  const uid = req?.auth?.uid; if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const taskId = String(req?.data?.taskId || '').trim(); const days = Math.max(1, Math.min(14, Number(req?.data?.days || 1)));
  if (!taskId) throw new httpsV2.HttpsError('invalid-argument', 'taskId required');
  const db = admin.firestore(); const taskRef = db.collection('tasks').doc(taskId);
  const snap = await taskRef.get(); if (!snap.exists) throw new httpsV2.HttpsError('not-found', 'Task not found');
  const task = snap.data() || {}; if (task.ownerUid !== uid) throw new httpsV2.HttpsError('permission-denied', 'Cannot modify this task');
  const until = startOfDay(new Date(Date.now() + days * 24 * 60 * 60 * 1000)).getTime();
  await taskRef.set({ snoozedUntil: until, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, snoozedUntil: until };
});

// ===== Email: test + raw (Brevo)
const { sendEmail } = require('./lib/email');
const BREVO_API_KEY = defineSecret('BREVO_API_KEY');

exports.sendTestEmail = httpsV2.onCall({ secrets: [BREVO_API_KEY] }, async (req) => {
  // Auth optional for testing, but recommended; enforce if needed:
  const to = String(req?.data?.to || '').trim();
  const subject = String(req?.data?.subject || 'BOB · Test Email');
  const from = req?.data?.from ? String(req.data.from).trim() : undefined;
  if (!to) throw new httpsV2.HttpsError('invalid-argument', 'to required');
  const html = `<p>This is a test email from BOB.</p><p>Sent at ${new Date().toISOString()}</p>`;
  const result = await sendEmail({ to, subject, html, from });
  return { ok: true, messageId: result?.messageId || null };
});

exports.sendRawEmail = httpsV2.onCall({ secrets: [BREVO_API_KEY] }, async (req) => {
  const to = req?.data?.to;
  const subject = req?.data?.subject || '(no subject)';
  const html = req?.data?.html || null;
  const text = req?.data?.text || null;
  const from = req?.data?.from || undefined;
  if (!to) throw new httpsV2.HttpsError('invalid-argument', 'to is required');
  if (!html && !text) throw new httpsV2.HttpsError('invalid-argument', 'html or text required');
  const result = await sendEmail({ to, subject, html, text, from });
  return { ok: true, messageId: result?.messageId || null };
});

// ===== Daily Email Summary (scheduled + on-demand)
const { dailyEmailSummary, sendDailySummaryNow } = require('./summary');
exports.dailyEmailSummary = dailyEmailSummary;
exports.sendDailySummaryNow = sendDailySummaryNow;
