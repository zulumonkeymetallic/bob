const admin = require('firebase-admin');

admin.initializeApp({ credential: admin.credential.applicationDefault() });

const db = admin.firestore();
const auth = admin.auth();

async function countByOwner(collectionName, uid) {
  const snap = await db.collection(collectionName).where('ownerUid', '==', uid).limit(2000).get();
  return snap.size;
}

async function countByUserIdFallback(collectionName, uid) {
  const snap = await db.collection(collectionName).where('userId', '==', uid).limit(2000).get();
  return snap.size;
}

async function countMissingOwner(collectionName) {
  const snap = await db.collection(collectionName).limit(2000).get();
  let missing = 0;
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (!data.ownerUid) missing += 1;
  }
  return { scanned: snap.size, missingOwnerUid: missing };
}

async function topOwnerUidCounts(collectionName) {
  const snap = await db.collection(collectionName).limit(2000).get();
  const counts = new Map();
  for (const doc of snap.docs) {
    const owner = String((doc.data() || {}).ownerUid || 'MISSING');
    counts.set(owner, (counts.get(owner) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ownerUid, count]) => ({ ownerUid, count }));
}

async function main() {
  const email = process.argv[2] || 'jdonnelly@jc1.tech';
  const user = await auth.getUserByEmail(email);
  const uid = user.uid;

  const collections = ['sprints', 'goals', 'stories', 'tasks'];
  const result = {
    email,
    uid,
    countsForUid: {},
    countsByUserIdFallback: {},
    missingOwnerStats: {},
    topOwnerUids: {},
  };

  for (const c of collections) {
    result.countsForUid[c] = await countByOwner(c, uid);
    result.countsByUserIdFallback[c] = await countByUserIdFallback(c, uid);
    result.missingOwnerStats[c] = await countMissingOwner(c);
    result.topOwnerUids[c] = await topOwnerUidCounts(c);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
