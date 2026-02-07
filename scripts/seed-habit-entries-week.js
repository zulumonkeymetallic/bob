#!/usr/bin/env node
/*
 Seed habit entries for the last N days in the current week.

 Usage:
   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/sa.json \
   node scripts/seed-habit-entries-week.js [--project bob20250810] [--uid <ownerUid>] [--days 4] [--dry-run]
*/

const admin = require('firebase-admin');

function init() {
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || undefined,
    });
  }
}

function arg(name, def = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  return (v && !v.startsWith('--')) ? v : true;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeekMonday(date) {
  const d = startOfDay(date);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : (1 - day); // move to Monday
  d.setDate(d.getDate() + diff);
  return d;
}

function toDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

async function main() {
  init();
  const db = admin.firestore();
  const targetUid = arg('uid', null);
  const dryRun = arg('dry-run', false) === true || String(arg('dry-run', false)).toLowerCase() === 'true';
  const days = Math.max(1, Math.min(14, Number(arg('days', 4)) || 4));

  const today = startOfDay(new Date());
  const weekStart = startOfWeekMonday(today);

  const dates = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (d < weekStart) break;
    dates.push(startOfDay(d));
  }
  dates.sort((a, b) => a.getTime() - b.getTime());

  console.log(`🔧 Seed habit entries (days=${dates.length}, weekStart=${weekStart.toISOString().slice(0,10)}, dryRun=${!!dryRun}, ownerUid=${targetUid || 'ALL'})`);

  let habitsQuery = db.collection('habits');
  if (targetUid) habitsQuery = habitsQuery.where('ownerUid', '==', targetUid);
  const habitsSnap = await habitsQuery.get();

  let created = 0;
  let skipped = 0;

  const batchSize = 400;
  let pending = [];

  for (const habitDoc of habitsSnap.docs) {
    const habit = habitDoc.data() || {};
    const ownerUid = habit.ownerUid || null;
    if (!ownerUid) continue;

    for (const day of dates) {
      const dayKey = toDayKey(day);
      const entryRef = habitDoc.ref.collection('habitEntries').doc(dayKey);
      const exists = await entryRef.get();
      if (exists.exists) {
        skipped++;
        continue;
      }
      const payload = {
        id: dayKey,
        habitId: habitDoc.id,
        ownerUid,
        date: day.getTime(),
        value: 1,
        isCompleted: true,
        notes: '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      pending.push({ ref: entryRef, payload });

      if (!dryRun && pending.length >= batchSize) {
        const batch = db.batch();
        for (const p of pending) batch.set(p.ref, p.payload, { merge: true });
        await batch.commit();
        created += pending.length;
        pending = [];
      }
    }
  }

  if (!dryRun && pending.length) {
    const batch = db.batch();
    for (const p of pending) batch.set(p.ref, p.payload, { merge: true });
    await batch.commit();
    created += pending.length;
  }

  console.log(`Created ${created} habit entries, skipped existing ${skipped}.`);
  if (dryRun) console.log('Dry run complete.');
  else console.log('✅ Seed complete.');
}

main().catch((e) => {
  console.error('Seed failed:', e?.message || e);
  process.exit(1);
});
