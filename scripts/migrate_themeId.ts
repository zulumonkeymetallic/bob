/*
  Migrate string theme -> numeric themeId.
  Usage:
    ts-node scripts/migrate_themeId.ts --project tsconfig.json --dry-run
    ts-node scripts/migrate_themeId.ts --apply

  Requires Firebase Admin credentials (see FIREBASE_ADMIN_SETUP.md).
*/

import * as admin from 'firebase-admin';

type Mode = 'dry' | 'apply';

interface MappingEntry {
  fromLabel: string;
  toId: number;
}

const args = process.argv.slice(2);
const mode: Mode = args.includes('--apply') ? 'apply' : 'dry';

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

async function loadThemeMappings(): Promise<MappingEntry[]> {
  // One-time mapping can be authored here or loaded from Firestore `themes` collection
  // Example default mapping for common themes
  return [
    { fromLabel: 'Health', toId: 1 },
    { fromLabel: 'Growth', toId: 2 },
    { fromLabel: 'Wealth', toId: 3 },
    { fromLabel: 'Tribe', toId: 4 },
    { fromLabel: 'Home', toId: 5 },
  ];
}

async function migrateCollection(collection: string, labelField = 'theme') {
  const db = admin.firestore();
  const mappings = await loadThemeMappings();
  const mapLower = new Map(mappings.map(m => [m.fromLabel.toLowerCase(), m.toId]));

  const snap = await db.collection(collection).get();
  let updated = 0;
  for (const doc of snap.docs) {
    const data = doc.data() as any;
    const label = (data[labelField] ?? '').toString();
    const hasId = typeof data.themeId === 'number';
    if (!label || hasId) continue;

    const id = mapLower.get(label.toLowerCase());
    if (!id) {
      console.warn(`[skip] ${collection}/${doc.id} unknown theme label '${label}'`);
      continue;
    }

    console.log(`[map] ${collection}/${doc.id} '${label}' -> ${id}`);
    if (mode === 'apply') {
      await doc.ref.update({ themeId: id, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      updated++;
    }
  }

  console.log(`Done ${collection}: ${mode === 'apply' ? 'updated' : 'would update'} ${updated} docs.`);
}

async function main() {
  initAdmin();
  console.log(`Running theme migration in '${mode}' mode.`);
  await migrateCollection('goals');
  await migrateCollection('stories');
  await migrateCollection('tasks');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

