#!/usr/bin/env node
/*
  Deletes E2E-created data for the test user from Firestore.
  Requires env FIREBASE_SERVICE_ACCOUNT (JSON) and uses collections: goals, stories, tasks, sprints.
*/
const admin = require('firebase-admin');

function getServiceAccount() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!json) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT');
  try {
    return JSON.parse(json);
  } catch (e) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
  }
}

async function run() {
  const svc = getServiceAccount();
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(svc),
      projectId: svc.project_id,
    });
  }
  const db = admin.firestore();

  const testUid = process.env.TEST_USER_UID || 'agentic-ai-test-user';
  const collections = ['goals', 'stories', 'tasks', 'sprints'];
  let total = 0;
  for (const col of collections) {
    const snap = await db.collection(col).where('ownerUid', '==', testUid).get();
    const batchSize = snap.size;
    if (batchSize === 0) continue;
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    total += batchSize;
    console.log(`Deleted ${batchSize} from ${col}`);
  }
  console.log(`Cleanup complete. Total deleted: ${total}`);
}

run().catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});

