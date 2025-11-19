#!/usr/bin/env node
/*
  Admin runner for task deduplication, mirroring Cloud Function logic.
  Usage:
    node scripts/dedupe-now-admin.js --uid <UID> --serviceAccount /abs/path/to/sa.json [--dryRun] [--hardDelete] [--includeTitleDedupe=false] [--titleScope=list|global]
*/

const fs = require('fs');
const path = require('path');
let admin;
try { admin = require('firebase-admin'); }
catch (e) { admin = require(path.join(process.cwd(), 'functions/node_modules/firebase-admin')); }

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      if (a.includes('=')) {
        const [k, v] = a.slice(2).split('=');
        args[k] = v;
      } else {
        const k = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) { args[k] = next; i++; }
        else { args[k] = true; }
      }
    }
  }
  return args;
}

const MS_IN_DAY = 24 * 60 * 60 * 1000;
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

function normalizeTitle(s) {
  if (!s) return '';
  let str = String(s).toLowerCase();
  str = str.replace(/https?:\/\/\S+/g, ' ');
  str = str.replace(/www\.[^\s]+/g, ' ');
  str = str.replace(/[\[\]{}()"'`“”‘’.,!?;:<>_~*^#%\\/\\|+-=]/g, ' ');
  str = str.replace(/\s+/g, ' ').trim();
  return str;
}
function textHasUrl(s) { if (!s) return false; const str = String(s); return /https?:\/\/\S+/.test(str) || /www\.[^\s]+/.test(str); }
function resolveListKey(task) {
  const id = task.reminderListId || task.listId || null;
  const name = task.reminderListName || task.listName || null;
  if (id) return `id:${String(id).toLowerCase()}`;
  if (name) return `name:${String(name).toLowerCase()}`;
  return 'none';
}
function dueMs(task) { return toMillis(task.dueDate || task.dueDateMs || task.targetDate); }
const DUE_CLOSE_MS = 36 * 60 * 60 * 1000;
function isDone(task) { const s = String(task.status ?? '').toLowerCase(); return s === 'done' || s === 'complete' || Number(task.status) === 2 || task.deleted === true; }

function renderBar(done, total, label) {
  const width = Math.max(10, Math.min(40, Number(process.env.PROGRESS_WIDTH || 40)));
  const pct = total > 0 ? Math.min(1, done / total) : 1;
  const filled = Math.round(pct * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  const pctStr = String(Math.floor(pct * 100)).padStart(3, ' ');
  const line = `[${bar}] ${pctStr}% ${done}/${total} ${label || ''}`.trimEnd();
  process.stdout.write(`\r${line}`);
}

async function dedupe({ db, uid, dryRun, hardDelete, includeTitleDedupe, titleOnly, strongOnly, limitWrites, titleScope = 'list' }) {
  const tasksSnap = await db.collection('tasks').where('ownerUid', '==', uid).get();
  const taskDocs = tasksSnap.docs.map(doc => ({ id: doc.id, ref: doc.ref, data: doc.data() || {} }));
  if (!taskDocs.length) return { ok: true, processed: 0, duplicatesResolved: 0, groups: [] };

  const taskById = new Map(taskDocs.map(doc => [doc.id, { id: doc.id, ...doc.data }]));
  const keyMap = new Map();
  const addKey = (key, taskId) => { if (!key || !taskId) return; const k = key.toLowerCase(); if (!keyMap.has(k)) keyMap.set(k, new Set()); keyMap.get(k).add(taskId); };

  for (const doc of taskDocs) {
    const data = doc.data; const id = doc.id;
    const reminderKey = data.reminderId ? `reminder:${String(data.reminderId).trim().toLowerCase()}` : null;
    const refValue = data.ref || data.reference || null; const refKey = refValue ? `ref:${String(refValue).trim().toLowerCase()}` : null;
    const sourceRefKey = data.sourceRef ? `sourceref:${String(data.sourceRef).trim().toLowerCase()}` : null;
    const externalKey = data.taskId ? `external:${String(data.taskId).trim().toLowerCase()}` : null;
    const iosKey = data.iosReminderId ? `ios:${String(data.iosReminderId).trim().toLowerCase()}` : null;
    const combo = []; if (reminderKey) combo.push(reminderKey.split(':')[1]); if (refKey) combo.push(refKey.split(':')[1]); if (sourceRefKey) combo.push(sourceRefKey.split(':')[1]); if (combo.length>=2) addKey(`combo:${combo.join('|')}`, id);
    [reminderKey, refKey, sourceRefKey, externalKey, iosKey].forEach(k => addKey(k, id));
  }

  const signatureMap = new Map();
  for (const [key, idSet] of keyMap.entries()) {
    const ids = Array.from(idSet); if (ids.length < 2) continue;
    const sorted = ids.slice().sort(); const signature = sorted.join('|');
    if (!signatureMap.has(signature)) signatureMap.set(signature, { ids: sorted, keys: new Set([key]) });
    else signatureMap.get(signature).keys.add(key);
  }

  const groups = Array.from(signatureMap.values());
  const strongClaimedIds = new Set();
  for (const g of groups) { (g.ids||[]).forEach(id => strongClaimedIds.add(id)); }

  const canonicalNotes = new Map();
  const duplicateUpdates = [];
  const summary = [];
  const duplicateReminderMappings = [];

  for (const group of groups) {
    if (titleOnly) break; // skip strong-key processing when titleOnly
    const tasks = group.ids.map(id => taskById.get(id)).filter(Boolean);
    if (tasks.length < 2) continue;
    const canonical = tasks.slice().sort((a,b)=>{
      const delDiff=(a.deleted?1:0)-(b.deleted?1:0); if(delDiff!==0) return delDiff;
      const sa=String(a.status??'').toLowerCase(), sb=String(b.status??'').toLowerCase();
      const da=(sa==='done'||sa==='complete'||Number(a.status)===2), dbb=(sb==='done'||sb==='complete'||Number(b.status)===2);
      if(da!==dbb) return da-dbb;
      const ca=toMillis(a.reminderCreatedAt)??toMillis(a.createdAt)??toMillis(a.serverUpdatedAt)??Number.MAX_SAFE_INTEGER;
      const cb=toMillis(b.reminderCreatedAt)??toMillis(b.createdAt)??toMillis(b.serverUpdatedAt)??Number.MAX_SAFE_INTEGER;
      if(ca!==cb) return ca-cb; return String(a.id).localeCompare(String(b.id));
    })[0];
    const duplicates = tasks.filter(t=>t.id!==canonical.id); if(!duplicates.length) continue;
    let selected = duplicates;
    if (limitWrites && Number.isFinite(limitWrites) && limitWrites > 0) {
      const remaining = Math.max(0, limitWrites - duplicateUpdates.length);
      if (remaining <= 0) break;
      selected = duplicates.slice(0, remaining);
    }
    if (!selected.length) continue;
    summary.push({ kept: canonical.id, removed: selected.map(d=>d.id), keys: Array.from(group.keys) });
    const canonicalRefValue = canonical.ref || canonical.reference || canonical.displayId || canonical.id;
    selected.forEach(dup=>{
      duplicateUpdates.push({ id: dup.id, data: { duplicateOf: canonical.id, duplicateKey: Array.from(group.keys).join(','), duplicateResolvedAt: admin.firestore.FieldValue.serverTimestamp(), reminderSyncDirective:'complete', syncState:'dirty', status:2, deleted:true, serverUpdatedAt: Date.now() } });
      duplicateReminderMappings.push({ duplicateId: dup.id, canonicalId: canonical.id, canonicalRef: canonicalRefValue, canonicalTitle: canonical.title || canonicalRefValue });
    });
    if(!canonicalNotes.has(canonical.id)) canonicalNotes.set(canonical.id, { children:new Set(), keys:new Set() });
    const note=canonicalNotes.get(canonical.id); selected.forEach(dup=>note.children.add(dup.id)); Array.from(group.keys).forEach(k=>note.keys.add(k));
    if (limitWrites && Number.isFinite(limitWrites) && limitWrites > 0 && duplicateUpdates.length >= limitWrites) break;
  }

  // Title-based second pass
  const titleSummary=[]; const titleCanonicalNotes=new Map();
  if (includeTitleDedupe && !strongOnly) {
    const titleBuckets=new Map();
    for (const doc of taskDocs) {
      const t={ id:doc.id, ...(doc.data||{}) };
      if (strongClaimedIds.has(t.id)) continue;
      const norm=normalizeTitle(t.title||t.name||t.task||''); if(!norm||norm.length<8) continue; if(textHasUrl(t.title||t.name||t.task||'')) continue;
      const listKey = titleScope === 'global' ? 'global' : resolveListKey(t);
      const bucketKey=`${norm}||${listKey}`;
      if(!titleBuckets.has(bucketKey)) titleBuckets.set(bucketKey, []);
      titleBuckets.get(bucketKey).push(t);
    }
    for (const [bucketKey, items] of titleBuckets.entries()) {
      if (items.length < 2) continue;
      const noneDue=[], withDue=[]; for(const t of items){ const d=dueMs(t); if(d==null) noneDue.push(t); else withDue.push({t,d}); }
      const subgroups=[]; if(noneDue.length>1) subgroups.push({ dueBucket:'none', tasks:noneDue.slice() });
      if(withDue.length){ withDue.sort((a,b)=>a.d-b.d); let startIdx=0; for(let i=1;i<=withDue.length;i++){ const start=withDue[startIdx]; const curr=withDue[i]||null; if(!curr||(curr.d-start.d)>DUE_CLOSE_MS){ const slice=withDue.slice(startIdx,i).map(x=>x.t); if(slice.length>1){ const day=toDayKey(new Date(start.d)); subgroups.push({ dueBucket:day, tasks:slice }); } startIdx=i; } } }
      const [normTitle, listKey]=bucketKey.split('||');
      for(const sg of subgroups){ const tasks=sg.tasks; const allDone=tasks.every(isDone); const alreadyMarked=tasks.filter(x=>x.duplicateOf||x.duplicateKey).length; if(allDone&&alreadyMarked<2) continue;
        const canonical=tasks.slice().sort((a,b)=>{ const dd=(a.deleted?1:0)-(b.deleted?1:0); if(dd!==0) return dd; const sa=String(a.status??'').toLowerCase(), sb=String(b.status??'').toLowerCase(); const da=(sa==='done'||sa==='complete'||Number(a.status)===2), dbb=(sb==='done'||sb==='complete'||Number(b.status)===2); if(da!==dbb) return da-dbb; const ca=toMillis(a.reminderCreatedAt)??toMillis(a.createdAt)??toMillis(a.serverUpdatedAt)??Number.MAX_SAFE_INTEGER; const cb=toMillis(b.reminderCreatedAt)??toMillis(b.createdAt)??toMillis(b.serverUpdatedAt)??Number.MAX_SAFE_INTEGER; if(ca!==cb) return ca-cb; return String(a.id).localeCompare(String(b.id)); })[0];
        const duplicates=tasks.filter(t=>t.id!==canonical.id); if(!duplicates.length) continue;
        const listPart = titleScope === 'global'
          ? 'global'
          : (listKey.startsWith('id:')||listKey.startsWith('name:') ? listKey.slice(listKey.indexOf(':')+1) : listKey);
        const dupKeyStable=`title:${normTitle}|list:${listPart}|dueBucket:${sg.dueBucket}`;
        titleSummary.push({ kept: canonical.id, removed: duplicates.map(d=>d.id), keys:[dupKeyStable], reason:'duplicateTitle' });
        const canonicalRefValue = canonical.ref || canonical.reference || canonical.displayId || canonical.id;
        duplicates.forEach(dup=>{ duplicateUpdates.push({ id:dup.id, data:{ duplicateOf: canonical.id, duplicateKey: dupKeyStable, duplicateReason:'duplicateTitle', duplicateResolvedAt: admin.firestore.FieldValue.serverTimestamp(), reminderSyncDirective:'complete', syncState:'dirty', status:2, deleted:true, serverUpdatedAt: Date.now() } }); duplicateReminderMappings.push({ duplicateId:dup.id, canonicalId:canonical.id, canonicalRef:canonicalRefValue, canonicalTitle: canonical.title || canonicalRefValue }); });
        if(!titleCanonicalNotes.has(canonical.id)) titleCanonicalNotes.set(canonical.id, { children:new Set(), keys:new Set() });
        const note=titleCanonicalNotes.get(canonical.id); duplicates.forEach(dup=>note.children.add(dup.id)); note.keys.add(dupKeyStable);
      }
    }
  }

  for (const [cid, info] of titleCanonicalNotes.entries()) {
    if (!canonicalNotes.has(cid)) canonicalNotes.set(cid, { children:new Set(), keys:new Set() });
    const dest=canonicalNotes.get(cid); info.children.forEach(v=>dest.children.add(v)); info.keys.forEach(v=>dest.keys.add(v));
  }

  const allSummaries = summary.concat(titleSummary);

  if (dryRun) {
    const reasonCounts = allSummaries.reduce((acc,g)=>{const r=g.reason||'strongKey'; acc[r]=(acc[r]||0)+1; return acc;},{});
    return { ok:true, dryRun:true, processed: taskDocs.length, duplicatesResolved: duplicateUpdates.length, groups: allSummaries, reasonCounts };
  }

  // writes with progress bar
  const bulk = db.bulkWriter();
  const writePromises = [];
  const canonicalEntries = Array.from(canonicalNotes.entries()).filter(([,info]) => info.children && info.children.size);
  const totalOps = duplicateUpdates.length + canonicalEntries.length;
  let doneOps = 0;
  const showProgress = process.stdout.isTTY;
  const bump = () => { doneOps++; if (showProgress) renderBar(doneOps, totalOps, 'writes'); };
  if (showProgress) renderBar(0, totalOps, 'writes');

  for (const update of duplicateUpdates) {
    const ref = db.collection('tasks').doc(update.id);
    const p = hardDelete ? bulk.delete(ref) : bulk.set(ref, update.data, { merge: true });
    writePromises.push(p.then(bump).catch((e) => { console.error(`\n[write] failed ${update.id}:`, e?.message || e); bump(); }));
  }
  for (const [canonicalId, info] of canonicalEntries) {
    const ref = db.collection('tasks').doc(canonicalId);
    const payload = { duplicateChildren: admin.firestore.FieldValue.arrayUnion(...Array.from(info.children)), duplicateResolvedAt: admin.firestore.FieldValue.serverTimestamp(), duplicateKey: Array.from(info.keys).join(','), duplicateOf: admin.firestore.FieldValue.delete(), deleted: false };
    const p = bulk.set(ref, payload, { merge: true });
    writePromises.push(p.then(bump).catch((e) => { console.error(`\n[canonical] failed ${canonicalId}:`, e?.message || e); bump(); }));
  }

  await Promise.all(writePromises);
  await bulk.close();
  if (showProgress) process.stdout.write('\n');

  if (duplicateReminderMappings.length) {
    const updates=[];
    let done = 0;
    const label = 'reminders';
    const show = process.stdout.isTTY;
    if (show) renderBar(0, duplicateReminderMappings.length, label);
    for (const m of duplicateReminderMappings) {
      try {
        const snap = await db.collection('reminders').where('taskId','==',m.duplicateId).get();
        const promises = [];
        snap.forEach((doc)=>{
          const reminderData = doc.data() || {}; const existing = reminderData.note || '';
          const mergeNote=`Merged into ${m.canonicalRef || m.canonicalId}`;
          const note = existing.includes(mergeNote) ? existing : `${existing}\n${mergeNote}`.trim();
          promises.push(doc.ref.set({ status:'completed', completedAt: admin.firestore.FieldValue.serverTimestamp(), note, syncState:'dirty', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge:true }));
        });
        await Promise.all(promises);
      } catch {}
      done++; if (show) renderBar(done, duplicateReminderMappings.length, label);
    }
    if (show) process.stdout.write('\n');
  }

  // activity
  const activityRef = db.collection('activity_stream').doc();
  const reasonCounts = allSummaries.reduce((acc,g)=>{const r=g.reason||'strongKey'; acc[r]=(acc[r]||0)+1; return acc;},{});
  await activityRef.set({ id: activityRef.id, entityId: `tasks_${uid}`, entityType:'task', activityType:'deduplicate_tasks', userId: uid, actor: 'AdminScript', description: `Resolved ${duplicateUpdates.length} duplicate tasks across ${allSummaries.length} groups`, metadata: { groups: allSummaries, hardDelete, reasonCounts }, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });

  return { ok:true, processed: taskDocs.length, duplicatesResolved: duplicateUpdates.length, groups: allSummaries, reasonCounts };
}

async function main() {
  const args = parseArgs(process.argv);
  const uid = String(args.uid || '').trim();
  if (!uid) { console.error('Error: --uid <UID> required'); process.exit(1); }
  const saPath = String(args.serviceAccount || path.join(process.env.HOME||'', '.secrets/bob/bob20250810-service-account.json'));
  if (!fs.existsSync(saPath)) { console.error(`Error: SA not found at ${saPath}`); process.exit(1); }
  const dryRun = args.dryRun === true || String(args.dryRun||'').toLowerCase() === 'true';
  const hardDelete = args.hardDelete === true || String(args.hardDelete||'').toLowerCase() === 'true';
  const includeTitleDedupe = args.includeTitleDedupe !== 'false';
  const titleOnly = args.titleOnly === true || String(args.titleOnly || '').toLowerCase() === 'true';
  const strongOnly = args.strongOnly === true || String(args.strongOnly || '').toLowerCase() === 'true';
  const limitWrites = args.limitWrites ? Number(args.limitWrites) : 0;
  const titleScope = args.titleScope === 'global' ? 'global' : 'list';

  const sa = require(saPath);
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'bob20250810' });
  const db = admin.firestore();
  const res = await dedupe({ db, uid, dryRun, hardDelete, includeTitleDedupe, titleOnly, strongOnly, limitWrites, titleScope });
  console.log(JSON.stringify(res, null, 2));
}

main().catch(err => { console.error(err?.message || String(err)); process.exit(1); });
