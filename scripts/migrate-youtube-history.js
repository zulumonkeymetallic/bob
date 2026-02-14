#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const args = process.argv.slice(2);
const getArg = (name) => {
  const prefix = `--${name}=`;
  const direct = args.find((a) => a.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1) return args[idx + 1];
  return null;
};

const hasFlag = (name) => args.includes(`--${name}`);

const serviceAccountPath = getArg('serviceAccount');
const projectId = getArg('project') || 'bob20250810';
const uid = getArg('uid');
const apply = hasFlag('apply');

if (!serviceAccountPath || !uid) {
  console.error('Usage: node scripts/migrate-youtube-history.js --serviceAccount=/abs/path.json --uid=<uid> [--project=bob20250810] [--apply]');
  process.exit(1);
}

const resolvedPath = path.resolve(serviceAccountPath);
if (!fs.existsSync(resolvedPath)) {
  console.error(`Service account not found at ${resolvedPath}`);
  process.exit(1);
}

const serviceAccount = require(resolvedPath);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId,
});

const db = admin.firestore();

const isHistoryDoc = (data) => {
  if (!data) return false;
  const list = String(data.list || '').toLowerCase();
  if (list === 'history') return true;
  if (data.watchLater === false) return true;
  if (data.watchedAt || data.watchedAtMs) return true;
  return false;
};

const run = async () => {
  console.log(`Scanning youtube docs for uid=${uid} (apply=${apply ? 'yes' : 'no'})`);
  const snap = await db.collection('youtube').where('ownerUid', '==', uid).get();
  const docs = snap.docs;
  console.log(`Found ${docs.length} youtube docs.`);

  const historyDocs = docs.filter((d) => isHistoryDoc(d.data()));
  console.log(`History candidates: ${historyDocs.length}`);

  let moved = 0;
  let skipped = 0;

  for (let i = 0; i < historyDocs.length; i += 400) {
    const batch = db.batch();
    const slice = historyDocs.slice(i, i + 400);
    slice.forEach((docSnap) => {
      const data = docSnap.data();
      const targetRef = db.collection('youtube_history').doc(docSnap.id);
      batch.set(targetRef, {
        ...data,
        migratedFrom: 'youtube',
        migratedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      if (apply) {
        batch.delete(docSnap.ref);
      }
      moved += 1;
    });
    await batch.commit();
  }

  skipped = docs.length - historyDocs.length;

  console.log(`Moved ${moved} docs to youtube_history.${apply ? ' Deleted originals.' : ' Originals kept (dry run).'} `);
  console.log(`Skipped ${skipped} non-history docs.`);
};

run().then(() => {
  console.log('Done.');
  process.exit(0);
}).catch((err) => {
  console.error('Migration failed', err);
  process.exit(1);
});
