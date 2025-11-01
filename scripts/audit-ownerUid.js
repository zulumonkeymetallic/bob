#!/usr/bin/env node
/*
 Audit ownerUid for content collections.
 Usage:
   GOOGLE_APPLICATION_CREDENTIALS=<path.json> node scripts/audit-ownerUid.js

 Prints counts of docs missing ownerUid per collection. Exits with nonzero code if any remain.
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
  'travel',
];

function init() {
  try {
    if (!admin.apps.length) admin.initializeApp();
  } catch (e) {
    console.error('Failed to initialize Firebase Admin SDK:', e.message);
    process.exit(1);
  }
}

async function auditCollection(db, name) {
  const col = db.collection(name);
  const snap = await col.get();
  let missingOwner = 0;
  let total = snap.size;
  const missingIds = [];
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    const hasOwner = d.ownerUid != null && String(d.ownerUid).trim() !== '';
    if (!hasOwner) {
      missingOwner++;
      missingIds.push({ id: doc.id, hasUserId: !!d.userId, createdAt: d.createdAt || d.created_at || null, title: d.title || d.name || null });
    }
  }
  return { name, total, missingOwner, missingIds };
}

async function main() {
  init();
  const db = admin.firestore();
  const results = [];
  for (const c of CONTENT_COLLECTIONS) {
    try {
      const r = await auditCollection(db, c);
      console.log(`${c.padEnd(24)} total=${String(r.total).padStart(5)} missingOwner=${String(r.missingOwner).padStart(5)}`);
      if (r.missingOwner > 0) {
        const list = r.missingIds.slice(0, 50).map(x => `${x.id}${x.hasUserId ? ' (userId present)' : ''}${x.title ? ' - '+x.title : ''}`).join(', ');
        console.log(`  ↳ Missing ownerUid in ${c}: ${list}`);
        if (r.missingIds.length > 50) console.log(`  ↳ ...and ${r.missingIds.length - 50} more`);
      }
      results.push(r);
    } catch (e) {
      console.error(`${c}: error:`, e.message);
    }
  }
  const remaining = results.reduce((a, r) => a + r.missingOwner, 0);
  if (remaining > 0) {
    console.error(`❌ Audit failed: ${remaining} docs missing ownerUid`);
    process.exit(2);
  }
  console.log('✅ Audit passed: all content docs have ownerUid');
}

main().catch((e) => { console.error(e); process.exit(1); });
