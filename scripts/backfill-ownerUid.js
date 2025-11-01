#!/usr/bin/env node
/*
 Backfill ownerUid for content collections.
 Usage:
   GOOGLE_APPLICATION_CREDENTIALS=<path.json> node scripts/backfill-ownerUid.js [--project bob20250810]

 For each content collection, if a document is missing ownerUid and has userId, sets ownerUid = userId.
 Logs docs missing both fields.
*/

const admin = require('firebase-admin');

const CONTENT_COLLECTIONS = [
  'sprints',
  'stories',
  'tasks',
  'goals',
  'work_projects',
  'personal_lists',
  'themes',
  'chores',
  'routines',
  'blocks',
  'scheduled_instances',
  'resources',
  'trips',
  'theme_colors',
  // historically used collection name in this repo
  'travel',
];

function init() {
  try {
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || undefined });
    }
  } catch (e) {
    console.error('Failed to initialize Firebase Admin SDK:', e.message);
    process.exit(1);
  }
}

const assignArgIndex = process.argv.indexOf('--assign');
const ASSIGN_UID = assignArgIndex !== -1 ? String(process.argv[assignArgIndex + 1] || '').trim() : '';

async function backfillCollection(db, name) {
  const col = db.collection(name);
  let fixed = 0;
  let missing = 0;
  let scanned = 0;

  const batchSize = 400;
  const updates = [];

  const snap = await col.get();
  for (const doc of snap.docs) {
    scanned++;
    const d = doc.data() || {};
    const hasOwner = d.ownerUid != null && String(d.ownerUid).trim() !== '';
    const hasUser = d.userId != null && String(d.userId).trim() !== '';
    if (!hasOwner) {
      if (hasUser) {
        updates.push({ ref: doc.ref, ownerUid: String(d.userId) });
      } else if (ASSIGN_UID) {
        updates.push({ ref: doc.ref, ownerUid: ASSIGN_UID });
      } else {
        missing++;
      }
    }
  }

  // Commit in batches of 450 to stay under limits
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = admin.firestore().batch();
    const slice = updates.slice(i, i + batchSize);
    for (const u of slice) {
      batch.set(u.ref, { ownerUid: u.ownerUid }, { merge: true });
    }
    await batch.commit();
    fixed += slice.length;
    console.log(`  [${name}] committed ${Math.min(i + batchSize, updates.length)}/${updates.length}`);
  }

  return { name, scanned, fixed, missing };
}

async function main() {
  init();
  const db = admin.firestore();
  const projectId = (await admin.instanceId().app.options.projectId) || 'unknown';
  console.log(`🔧 Backfill ownerUid start (project: ${projectId})`);

  const results = [];
  for (const c of CONTENT_COLLECTIONS) {
    try {
      console.log(`→ Scanning ${c}…`);
      const r = await backfillCollection(db, c);
      console.log(`  ${c}: scanned=${r.scanned}, fixed=${r.fixed}, missingBoth=${r.missing}`);
      results.push(r);
    } catch (e) {
      console.error(`  ${c}: error:`, e.message);
    }
  }

  const total = results.reduce((a, r) => a + r.scanned, 0);
  const fixed = results.reduce((a, r) => a + r.fixed, 0);
  const missing = results.reduce((a, r) => a + r.missing, 0);
  console.log('✅ Backfill complete:', { total, fixed, missing, assignedFallback: ASSIGN_UID ? true : false });
}

main().catch((e) => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
