/*
  Seed default calendar block templates.
  Usage:
    ts-node scripts/seed_block_templates.ts --apply
*/
import * as admin from 'firebase-admin';

const APPLY = process.argv.includes('--apply');

function initAdmin() {
  if (admin.apps.length) return;
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  } catch (e) {
    console.error('Firebase Admin init failed. Ensure credentials are configured.', e);
    process.exit(1);
  }
}

const templates = [
  { key: 'fitness', title: 'Fitness Block', durationMin: 60, themeId: 1 },
  { key: 'deep_work', title: 'Deep Work', durationMin: 90, themeId: 2 },
  { key: 'admin', title: 'Admin / Email', durationMin: 30, themeId: 5 },
];

async function main() {
  initAdmin();
  const db = admin.firestore();
  const col = db.collection('block_templates');

  for (const t of templates) {
    const ref = col.doc(t.key);
    if (APPLY) {
      await ref.set({ ...t, active: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      console.log(`[seed] upserted template '${t.key}'`);
    } else {
      console.log(`[dry-run] would upsert template '${t.key}'`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

