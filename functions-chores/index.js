const functionsV2 = require('firebase-functions/v2');
const httpsV2 = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const schedulerV2 = require('firebase-functions/v2/scheduler');
const firestoreV2 = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const { ensureBudget } = require('./utils/usageGuard');

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
function isSameDay(a, b) { return startOfDay(new Date(a)).getTime() === startOfDay(new Date(b)).getTime(); }

function inferTaskType(data) {
  const rawTitle = String(data?.title || '').toLowerCase();
  const rawList = String(data?.reminderListName || data?.reminderListId || '').toLowerCase();
  const tags = Array.isArray(data?.tags) ? data.tags.map((t) => String(t || '').toLowerCase().replace(/^#/, '')) : [];
  const note = String(data?.note || '').toLowerCase();
  const candidates = [rawTitle, rawList, note, ...tags];
  if (candidates.some((s) => s.includes('habit'))) return 'habit';
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
  const anchorMs = toMillis(task?.recurrenceAnchor || task?.dueDate || task?.createdAt || task?.lastDoneAt) || Date.now();
  const anchor = startOfDay(new Date(anchorMs));
  const current = startOfDay(new Date(date));
  const msDiff = current.getTime() - anchor.getTime();
  if (!freq) {
    const dueMs = toMillis(task?.dueDate || task?.dueDateMs || task?.targetDate);
    if (!dueMs) return false;
    return isSameDay(date, dueMs);
  }
  if (freq === 'daily') {
    const base = toMillis(task?.lastDoneAt) || anchorMs;
    const daysDiff = Math.floor((current.getTime() - startOfDay(new Date(base)).getTime()) / (24*60*60*1000));
    if (daysDiff < 0) return false;
    return daysDiff % interval === 0;
  }
  if (freq === 'weekly') {
    const allowedRaw = Array.isArray(task?.daysOfWeek)
      ? task.daysOfWeek
      : (Array.isArray(task?.repeatDaysOfWeek) ? task.repeatDaysOfWeek : []);
    const allowed = allowedRaw.map((d) => String(d || '').toLowerCase());
    const dayMatch = allowed.length ? allowed.includes(dayOfWeekKey(date)) : dayOfWeekKey(date) === dayOfWeekKey(anchor);
    if (!dayMatch) return false;
    const weeksDiff = Math.floor(msDiff / (7 * 24 * 60 * 60 * 1000));
    if (weeksDiff < 0) return false;
    return weeksDiff % interval === 0;
  }
  if (freq === 'monthly') {
    const base = new Date(anchorMs);
    if (current.getDate() !== base.getDate()) return false;
    const monthsDiff = (current.getFullYear() - base.getFullYear()) * 12 + (current.getMonth() - base.getMonth());
    if (monthsDiff < 0) return false;
    return monthsDiff % interval === 0;
  }
  if (freq === 'yearly') {
    const base = new Date(anchorMs);
    if (!(current.getMonth() === base.getMonth() && current.getDate() === base.getDate())) return false;
    const yearsDiff = current.getFullYear() - base.getFullYear();
    if (yearsDiff < 0) return false;
    return yearsDiff % interval === 0;
  }
  return false;
}

function hasTimeComponent(ms) {
  if (!ms) return false;
  const d = new Date(ms);
  return d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
}

function applyTimeOfDay(day, timeMs) {
  const base = new Date(timeMs);
  const d = new Date(day.getTime());
  d.setHours(base.getHours(), base.getMinutes(), 0, 0);
  return d.getTime();
}

const CHORE_TIMEZONE = 'Europe/London';

function extractZoneHourMinute(ms, timeZone = CHORE_TIMEZONE) {
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || '0');
  return { hour, minute };
}

function formatDueTime(ms) {
  const { hour, minute } = extractZoneHourMinute(ms);
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${hh}:${mm}`;
}

function classifyTimeOfDay(ms) {
  const { hour, minute } = extractZoneHourMinute(ms);
  const minutes = hour * 60 + minute;
  if (minutes >= (5 * 60) && minutes < (12 * 60)) return 'morning';
  if (minutes >= (12 * 60) && minutes < (17 * 60)) return 'afternoon';
  return 'evening';
}

function durationMinutesFromTask(task) {
  const points = Number(task?.points || 0);
  const estimateMin = Number(task?.estimateMin || 0);
  const choreMin = 10;
  if (estimateMin > 0) return Math.min(180, Math.max(choreMin, Math.round(estimateMin)));
  if (points > 0) return Math.min(240, Math.max(choreMin, Math.round(points * 60)));
  return choreMin;
}

function themeLabelFromValue(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    return value.label || value.name || value.title || '';
  }
  return '';
}

function isRecurringChoreTask(task) {
  const type = String(task?.type || task?.task_type || '').toLowerCase();
  if (!['chore', 'routine', 'habit', 'habitual'].includes(type)) return false;
  if (task?.repeatFrequency) return true;
  if (Number(task?.repeatInterval || 0) > 0) return true;
  if (Array.isArray(task?.daysOfWeek) && task.daysOfWeek.length > 0) return true;
  if (Array.isArray(task?.repeatDaysOfWeek) && task.repeatDaysOfWeek.length > 0) return true;
  return false;
}

function isTaskLocked(task) {
  if (!task) return false;
  if (task.dueDateLocked === true) return true;
  return String(task.dueDateReason || '').toLowerCase() === 'user';
}

function logPlacement(stage, payload) {
  if (String(process.env.CHORE_PLACEMENT_DEBUG || '').toLowerCase() !== 'true') return;
  try {
    console.log('[chore-placement]', JSON.stringify({ stage, ...payload }));
  } catch {
    console.log('[chore-placement]', stage);
  }
}

async function upsertChoreBlocksForTask(db, task, lookaheadDays = 28) {
  if (!task?.ownerUid || !task?.id) return { created: 0, updated: 0 };
  const ownerUid = task.ownerUid;
  const today = startOfDay(new Date());
  const snoozedUntil = toMillis(task?.snoozedUntil) || 0;
  let created = 0, updated = 0;
  let nextStartMs = null;
  const nowMs = Date.now();
  const durationMin = durationMinutesFromTask(task);
  const durationMs = durationMin * 60000;
  const taskDueMs = toMillis(task?.dueDate || task?.dueDateMs || task?.targetDate);
  const dueHasTime = hasTimeComponent(taskDueMs);
  const dayCtxCache = new Map();

  const loadDayCtx = async (dayStartMs, dayEndMs, dayKey) => {
    if (dayCtxCache.has(dayKey)) return dayCtxCache.get(dayKey);
    const snap = await db.collection('calendar_blocks')
      .where('ownerUid', '==', ownerUid)
      .where('start', '>=', dayStartMs)
      .where('start', '<=', dayEndMs)
      .get()
      .catch(() => ({ docs: [] }));
    const windows = [];
    const occupied = [];
    snap.docs.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const start = toMillis(data.start);
      const end = toMillis(data.end);
      if (!start || !end || end <= start) return;
      const source = String(data.source || data.entityType || data.entry_method || '').toLowerCase();
      const entityType = String(data.entityType || '').toLowerCase();
      const isChoreEvent = source === 'chore' || entityType === 'chore';
      const themeLabel = themeLabelFromValue(data.theme ?? data.theme_id ?? data.themeId ?? data.category ?? data.title ?? '');
      const isChoreTheme = String(themeLabel || '').toLowerCase().includes('chore');
      if (isChoreEvent) {
        occupied.push({ id: docSnap.id, start, end });
      } else if (isChoreTheme) {
        windows.push({ start, end });
      }
    });
    windows.sort((a, b) => a.start - b.start);
    occupied.sort((a, b) => a.start - b.start);
    const ctx = { windows, occupied };
    dayCtxCache.set(dayKey, ctx);
    return ctx;
  };

  const fitsInWindows = (startMs, endMs, windows) =>
    windows.some((w) => startMs >= w.start && endMs <= w.end);

  const overlapsAny = (startMs, endMs, occupied) =>
    occupied.some((o) => startMs < o.end && endMs > o.start);

  const findSlotInWindows = (windows, occupied, duration) => {
    for (const window of windows) {
      let cursor = window.start;
      for (const occ of occupied) {
        if (occ.end <= window.start || occ.start >= window.end) continue;
        if (cursor + duration <= occ.start) return cursor;
        cursor = Math.max(cursor, occ.end);
        if (cursor >= window.end) break;
      }
      if (cursor + duration <= window.end) return cursor;
    }
    return null;
  };

  const findSlotFromDay = async (startDay, existingDocId = null, preferredMs = null) => {
    for (const candidateDay of iterateNextDays(startDay, lookaheadDays)) {
      const candidateStartMs = startOfDay(candidateDay).getTime();
      if (snoozedUntil && candidateStartMs < startOfDay(new Date(snoozedUntil)).getTime()) continue;
      const candidateKey = toDayKey(candidateDay);
      const candidateEndMs = candidateStartMs + (24 * 60 * 60 * 1000) - 1;
      const candidateCtx = await loadDayCtx(candidateStartMs, candidateEndMs, candidateKey);
      if (!candidateCtx.windows.length) continue;
      const occupiedWithoutSelf = candidateCtx.occupied.filter((o) => o.id !== existingDocId);

      if (preferredMs && startOfDay(new Date(preferredMs)).getTime() === candidateStartMs) {
        const preferredEnd = preferredMs + durationMs;
        if (
          fitsInWindows(preferredMs, preferredEnd, candidateCtx.windows) &&
          !overlapsAny(preferredMs, preferredEnd, occupiedWithoutSelf)
        ) {
          return { startMs: preferredMs, endMs: preferredEnd, dayCtx: candidateCtx, occupiedWithoutSelf, day: candidateDay };
        }
      }

      const slot = findSlotInWindows(candidateCtx.windows, occupiedWithoutSelf, durationMs);
      if (slot != null) {
        return { startMs: slot, endMs: slot + durationMs, dayCtx: candidateCtx, occupiedWithoutSelf, day: candidateDay };
      }
    }
    return null;
  };

  for (const day of iterateNextDays(today, lookaheadDays)) {
    if (snoozedUntil && day.getTime() < startOfDay(new Date(snoozedUntil)).getTime()) continue;
    if (!shouldScheduleOnDay(task, day)) continue;
    const dayKey = toDayKey(day);
    const iso = toISODate(day);
    const docId = `chore_${task.id}_${dayKey}`;
    const ref = db.collection('calendar_blocks').doc(docId);
    const snap = await ref.get();
    const dayStartMs = startOfDay(day).getTime();
    const dayEndMs = dayStartMs + (24 * 60 * 60 * 1000) - 1;
    const dayCtx = await loadDayCtx(dayStartMs, dayEndMs, dayKey);
    if (!dayCtx.windows.length) {
      if (snap.exists) {
        await ref.delete();
        dayCtx.occupied = dayCtx.occupied.filter((o) => o.id !== docId);
      }
      logPlacement('no_windows', { taskId: task.id, dayKey, ownerUid });
      continue;
    }

    const occupiedWithoutSelf = dayCtx.occupied.filter((o) => o.id !== docId);
    let startMs = null;
    let endMs = null;

    if (snap.exists) {
      const existing = snap.data() || {};
      const existingStart = toMillis(existing.start);
      const existingEnd = toMillis(existing.end);
      if (existingStart && existingEnd &&
        fitsInWindows(existingStart, existingEnd, dayCtx.windows) &&
        !overlapsAny(existingStart, existingEnd, occupiedWithoutSelf)) {
        startMs = existingStart;
        endMs = existingEnd;
      }
    }

    if (startMs == null && taskDueMs && dueHasTime) {
      const preferred = applyTimeOfDay(day, taskDueMs);
      const preferredEnd = preferred + durationMs;
      if (fitsInWindows(preferred, preferredEnd, dayCtx.windows) &&
        !overlapsAny(preferred, preferredEnd, occupiedWithoutSelf)) {
        startMs = preferred;
        endMs = preferredEnd;
      }
    }

    if (startMs == null) {
      const slot = findSlotInWindows(dayCtx.windows, occupiedWithoutSelf, durationMs);
      if (slot != null) {
        startMs = slot;
        endMs = slot + durationMs;
      }
    }

    if (startMs == null) {
      const fallback = await findSlotFromDay(day, docId, taskDueMs && dueHasTime ? applyTimeOfDay(day, taskDueMs) : null);
      if (!fallback) {
        if (snap.exists) {
          await ref.delete();
          dayCtx.occupied = occupiedWithoutSelf;
        }
        logPlacement('unscheduled', { taskId: task.id, dayKey, ownerUid, reason: 'conflict_or_window' });
        continue;
      }
      startMs = fallback.startMs;
      endMs = fallback.endMs;
      logPlacement('fallback', {
        taskId: task.id,
        sourceDay: dayKey,
        targetDay: toDayKey(fallback.day),
        ownerUid,
      });
    }

    if (startMs >= nowMs && (nextStartMs == null || startMs < nextStartMs)) {
      nextStartMs = startMs;
    }

    const checklistLink = `/chores/checklist?date=${encodeURIComponent(iso)}&taskId=${encodeURIComponent(task.id)}`;
    const base = {
      ownerUid,
      entityType: 'chore',
      taskId: task.id,
      date: iso,
      title: task.title || 'Chore',
      status: 'planned',
      start: startMs,
      end: endMs,
      source: 'chore',
      syncToGoogle: false,
      deepLink: checklistLink,
      metadata: {
        frequency: task.repeatFrequency || null,
        interval: Number(task.repeatInterval || 1) || 1,
        daysOfWeek: Array.isArray(task.daysOfWeek)
          ? task.daysOfWeek
          : (Array.isArray(task.repeatDaysOfWeek) ? task.repeatDaysOfWeek : null),
      },
    };
    if (snap.exists) {
      const existing = snap.data() || {};
      const needsUpdate = existing.title !== base.title
        || existing.ownerUid !== ownerUid
        || existing.status === undefined
        || existing.start !== base.start
        || existing.end !== base.end
        || existing.syncToGoogle !== base.syncToGoogle
        || existing.deepLink !== base.deepLink;
      if (needsUpdate) {
        await ref.set({ ...existing, ...base, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        updated++;
      }
    } else {
      await ref.set({ ...base, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      created++;
    }
    dayCtx.occupied = [...occupiedWithoutSelf, { id: docId, start: base.start, end: base.end }];
    logPlacement('scheduled', {
      taskId: task.id,
      dayKey,
      ownerUid,
      afterCount: dayCtx.occupied.length,
      slotStart: base.start,
      slotEnd: base.end,
    });
  }

  if (nextStartMs && isRecurringChoreTask(task) && !isTaskLocked(task)) {
    const dueMs = toMillis(task?.dueDate || task?.dueDateMs || task?.targetDate);
    const nextDueTime = formatDueTime(nextStartMs);
    const nextTimeOfDay = classifyTimeOfDay(nextStartMs);
    const currentDueTime = String(task?.dueTime || '').trim();
    const currentTimeOfDay = String(task?.timeOfDay || '').trim().toLowerCase();
    const isMissing = !dueMs;
    const isFutureMismatch = !!dueMs && dueMs >= nowMs && Math.abs(dueMs - nextStartMs) > (5 * 60 * 1000);
    const isTimeMismatch = currentDueTime !== nextDueTime || currentTimeOfDay !== nextTimeOfDay;
    if (isMissing || isFutureMismatch || isTimeMismatch) {
      await db.collection('tasks').doc(task.id).set({
        dueDate: nextStartMs,
        dueTime: nextDueTime,
        timeOfDay: nextTimeOfDay,
        dueDateReason: 'chore_block',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        syncState: 'dirty',
      }, { merge: true });
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
  const isChoreLike = type === 'chore' || type === 'routine' || type === 'habit';
  if (isChoreLike && active) {
    const task = { id, ...(after || {}), ...(patch || {}) };
    await upsertChoreBlocksForTask(db, task, 28);
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
  await ensureBudget(db, 'archiveCompletedTasksNightly', { reads: 2000, writes: 500 });
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
  await ensureBudget(db, 'ensureChoreBlocksHourly', { reads: 2000, writes: 500 });
  let scanned = 0, created = 0, updated = 0;
  for (const t of ['chore','routine','habit']) {
    const snap = await db.collection('tasks').where('type', '==', t).where('status', '==', 0).get();
    for (const doc of snap.docs) { scanned++; const res = await upsertChoreBlocksForTask(db, { id: doc.id, ...(doc.data()||{}) }, 28); created += res.created; updated += res.updated; }
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
  const type = String(task?.type || '').toLowerCase(); if (type !== 'chore' && type !== 'routine' && type !== 'habit') throw new httpsV2.HttpsError('failed-precondition', 'Not a chore/routine/habit');
  const today = new Date();
  const todayKey = toDayKey(today);
  const todayIso = today.toISOString().slice(0, 10);
  const blockId = `chore_${taskId}_${todayKey}`;
  await db.collection('calendar_blocks').doc(blockId).set({
    ownerUid: uid,
    taskId,
    entityType: 'chore',
    status: 'done',
    source: 'chore',
    syncToGoogle: false,
    deepLink: `/chores/checklist?date=${encodeURIComponent(todayIso)}&taskId=${encodeURIComponent(taskId)}`,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
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
const { dailyEmailSummary } = require('./summary');
exports.dailyEmailSummary = dailyEmailSummary;
