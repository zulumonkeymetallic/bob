#!/usr/bin/env node
/*
  Status Normalization Migration
  - Maps string/synonym statuses to canonical numeric values
  - Tasks: 0=todo,1=in-progress,2=done,3=blocked
  - Stories: 0=backlog,2=in-progress,4=done (planned/testing -> nearest)
  Usage:
    node scripts/migrate-status-normalization.js --entity=task|story|both --dry-run
*/

const admin = require('firebase-admin');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { entity: 'both', dry: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--entity=')) out.entity = a.split('=')[1];
    else if (a === '--dry-run' || a === '--dry') out.dry = true;
  }
  return out;
}

function mapTaskStatus(v) {
  if (typeof v === 'number') {
    if (v === 0 || v === 1 || v === 2 || v === 3) return v;
    return null;
  }
  const s = String(v || '').trim().toLowerCase().replace(/_/g, '-');
  if (!s) return null;
  if (['todo', 'backlog', 'planned', 'new'].includes(s)) return 0;
  if (['in-progress', 'in progress', 'active', 'doing'].includes(s)) return 1;
  if (['done', 'complete', 'completed', 'closed', 'finished'].includes(s)) return 2;
  if (['blocked', 'paused', 'on-hold', 'onhold', 'stalled', 'waiting'].includes(s)) return 3;
  return null;
}

function mapStoryStatus(v) {
  if (typeof v === 'number') {
    if (v === 0 || v === 2 || v === 4) return v;
    // squeeze to nearest canonical
    if (v === 1) return 0;
    if (v === 3) return 2;
    return null;
  }
  const s = String(v || '').trim().toLowerCase().replace(/_/g, '-');
  if (!s) return null;
  if (['backlog', 'todo', 'planned', 'new'].includes(s)) return 0;
  if (['in-progress', 'in progress', 'active', 'wip', 'testing', 'qa', 'review'].includes(s)) return 2;
  if (['done', 'complete', 'completed', 'closed', 'finished'].includes(s)) return 4;
  return null;
}

async function main() {
  const { entity, dry } = parseArgs();
  if (!admin.apps.length) {
    try {
      admin.initializeApp();
    } catch (e) {
      console.error('Failed to init Firebase Admin. Ensure ADC or GOOGLE_APPLICATION_CREDENTIALS is set.');
      process.exit(1);
    }
  }
  const db = admin.firestore();

  const targets = [];
  if (entity === 'task' || entity === 'both') targets.push({ col: 'tasks', map: mapTaskStatus });
  if (entity === 'story' || entity === 'both') targets.push({ col: 'stories', map: mapStoryStatus });

  let totalDocs = 0, toUpdate = 0;
  for (const t of targets) {
    const snap = await db.collection(t.col).get();
    totalDocs += snap.size;
    snap.docs.forEach(d => {
      const s = d.data().status;
      const m = t.map(s);
      if (m !== null && m !== s) toUpdate++;
    });
  }
  console.log(`[dry=${dry}] Scanned ${totalDocs} docs; ${toUpdate} need updates.`);

  if (dry) return;

  for (const t of targets) {
    const snap = await db.collection(t.col).get();
    const batch = db.batch();
    let count = 0;
    for (const d of snap.docs) {
      const s = d.data().status;
      const m = t.map(s);
      if (m !== null && m !== s) {
        batch.set(d.ref, { status: m, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        count++;
      }
      if (count && count % 400 === 0) { await batch.commit(); }
    }
    if (count) await batch.commit();
    console.log(`Updated ${count} ${t.col} documents`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

