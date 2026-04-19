#!/usr/bin/env node

/**
 * Copy sanitized sample data from one user account to another.
 *
 * Usage:
 *   node scripts/copy-sanitized-demo-data.js \
 *     --source jdonnelly@jc1.tech \
 *     --target bobdemo@jc1.tech \
 *     --limit 20 \
 *     --monzo-limit 100
 *
 * Optional:
 *   --service-account /path/to/service-account.json
 *   --dry-run
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let admin;
try {
  admin = require('firebase-admin');
} catch (error) {
  admin = require(path.join(process.cwd(), 'functions/node_modules/firebase-admin'));
}

const DEFAULT_SERVICE_ACCOUNT = '/Users/jim/GitHub/secret/bob20250810-firebase-adminsdk-fbsvc-0f8ac23f94.json';
const DEFAULT_SOURCE = 'jdonnelly@jc1.tech';
const DEFAULT_TARGET = 'bobdemo@jc1.tech';
const DEFAULT_LIMIT = 20;
const DEFAULT_MONZO_LIMIT = 100;

const OWNER_KEYS = new Set(['ownerUid', 'userId', 'uid']);
const STRING_FIELDS_BY_COLLECTION = {
  goals: ['title', 'description', 'recentNote'],
  stories: ['title', 'description', 'acceptanceCriteria'],
  tasks: ['title', 'description', 'note', 'reminderNote'],
  chores: ['title', 'description'],
  habits: ['name', 'description'],
  monzo_transactions: ['description', 'merchant'],
  metrics_workouts: ['name'],
};

const SENSITIVE_TEXT_PATTERNS = [
  /\bjournal\b/i,
  /\btherapy\b/i,
  /\bconfidential\b/i,
  /\bprivate\b/i,
  /\bintimate\b/i,
  /\bsexual\b/i,
  /\brelationship\b/i,
  /\bmedical\b/i,
  /\bdiagnos/i,
  /\banxiety\b/i,
  /\bdepression\b/i,
  /\bpanic\b/i,
  /\bmum\b/i,
  /\bdad\b/i,
  /\bfamily\b/i,
  /\bpartner\b/i,
  /\bemma\b/i,
];

function getArg(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function parsePositiveInt(raw, fallback) {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeEmailLike(value) {
  if (!value) return value;
  if (value.includes('@')) return value.toLowerCase();
  const compact = value.toLowerCase().replace(/\s+/g, '');
  const m = compact.match(/^(.+)jc1\.tech$/);
  if (m && m[1]) {
    return `${m[1]}@jc1.tech`;
  }
  const mTypo = compact.match(/^(.+)jc\.tech$/);
  if (mTypo && mTypo[1]) {
    return `${mTypo[1]}@jc1.tech`;
  }
  return value.toLowerCase();
}

function deterministicDocId(targetUid, collectionName, sourceDocId) {
  const hash = crypto
    .createHash('sha1')
    .update(`${collectionName}:${sourceDocId}`)
    .digest('hex')
    .slice(0, 20);
  return `${targetUid}_seed_${hash}`;
}

function isPlainObject(value) {
  return value && Object.prototype.toString.call(value) === '[object Object]';
}

function rewriteOwnershipFields(value, sourceUid, targetUid) {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteOwnershipFields(item, sourceUid, targetUid));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const output = {};
  for (const [key, raw] of Object.entries(value)) {
    if (OWNER_KEYS.has(key) && typeof raw === 'string' && raw === sourceUid) {
      output[key] = targetUid;
      continue;
    }
    output[key] = rewriteOwnershipFields(raw, sourceUid, targetUid);
  }
  return output;
}

function sanitizeText(input, fallback) {
  if (typeof input !== 'string') return input;
  const compact = input.replace(/\s+/g, ' ').trim();
  if (!compact) return fallback;
  if (SENSITIVE_TEXT_PATTERNS.some((pattern) => pattern.test(compact))) {
    return fallback;
  }
  return compact;
}

function fallbackValue(collectionName, field, index) {
  const n = index + 1;
  if (collectionName === 'goals') {
    if (field === 'title') return `Demo Goal ${n}`;
    if (field === 'description') return `Demo goal description ${n}.`;
    if (field === 'recentNote') return `Progress note ${n}.`;
  }
  if (collectionName === 'stories') {
    if (field === 'title') return `Demo Story ${n}`;
    if (field === 'description') return `Demo story summary ${n}.`;
    if (field === 'acceptanceCriteria') return `Demo acceptance criteria ${n}.`;
  }
  if (collectionName === 'tasks') {
    if (field === 'title') return `Demo Task ${n}`;
    if (field === 'description') return `Demo task description ${n}.`;
    if (field === 'note' || field === 'reminderNote') return `Demo task note ${n}.`;
  }
  if (collectionName === 'chores') {
    if (field === 'title') return `Demo Chore ${n}`;
    if (field === 'description') return `Demo chore description ${n}.`;
  }
  if (collectionName === 'habits') {
    if (field === 'name') return `Demo Routine ${n}`;
    if (field === 'description') return `Demo routine description ${n}.`;
  }
  if (collectionName === 'monzo_transactions') {
    if (field === 'description') return `Card transaction ${n}`;
    if (field === 'merchant') return `Demo Merchant ${n}`;
  }
  if (collectionName === 'metrics_workouts') {
    if (field === 'name') return `Demo Workout ${n}`;
  }
  return `Demo item ${n}`;
}

function sanitizeDocument(collectionName, data, index) {
  const sanitized = { ...data };
  const fields = STRING_FIELDS_BY_COLLECTION[collectionName] || [];
  for (const field of fields) {
    if (typeof sanitized[field] === 'string') {
      sanitized[field] = sanitizeText(sanitized[field], fallbackValue(collectionName, field, index));
    }
  }
  return sanitized;
}

function rewriteLinkedIds(collectionName, data, goalIdMap, storyIdMap) {
  const patched = { ...data };

  if ((collectionName === 'stories' || collectionName === 'tasks' || collectionName === 'habits') && typeof patched.goalId === 'string') {
    patched.goalId = goalIdMap.get(patched.goalId) || patched.goalId;
  }
  if (collectionName === 'habits' && typeof patched.linkedGoalId === 'string') {
    patched.linkedGoalId = goalIdMap.get(patched.linkedGoalId) || patched.linkedGoalId;
  }
  if (collectionName === 'tasks' && typeof patched.storyId === 'string') {
    patched.storyId = storyIdMap.get(patched.storyId) || patched.storyId;
  }
  return patched;
}

function stampDemoMetadata(data, sourceUid, sourceDocId) {
  return {
    ...data,
    demoSeed: {
      sourceUid,
      sourceDocId,
      copiedBy: 'scripts/copy-sanitized-demo-data.js',
      copiedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  };
}

async function resolveUser(auth, label, refInput) {
  const rawRef = String(refInput || '').trim();
  if (!rawRef) {
    throw new Error(`Missing ${label} user reference`);
  }

  const normalized = normalizeEmailLike(rawRef);
  const candidates = [normalized];
  if (label === 'target' && normalized === 'bobdemo2@jc1.tech') {
    candidates.push('bobdemo@jc1.tech');
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.includes('@')) {
      try {
        const user = await auth.getUserByEmail(candidate);
        return {
          uid: user.uid,
          email: user.email || candidate,
          displayName: user.displayName || '',
        };
      } catch (error) {
        // Try the next candidate.
      }
      continue;
    }

    try {
      const user = await auth.getUser(candidate);
      return {
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || '',
      };
    } catch (error) {
      // Try the next candidate.
    }
  }

  throw new Error(`Unable to resolve ${label} user: ${rawRef}`);
}

async function fetchSourceDocs(db, collectionName, sourceUid, desiredCount) {
  const pullLimit = Math.max(desiredCount * 8, desiredCount);
  const seen = new Map();
  const ownerFields = ['ownerUid', 'userId', 'uid'];

  for (const ownerField of ownerFields) {
    try {
      const snap = await db
        .collection(collectionName)
        .where(ownerField, '==', sourceUid)
        .limit(pullLimit)
        .get();
      for (const doc of snap.docs) {
        if (!seen.has(doc.id)) seen.set(doc.id, doc);
      }
      if (seen.size >= desiredCount) break;
    } catch (error) {
      // Ignore query mismatch (for collections that don't carry this field).
    }
  }

  return Array.from(seen.values()).slice(0, desiredCount);
}

async function copyOwnerCollection({
  db,
  writer,
  collectionName,
  sourceUid,
  sourceEmail,
  targetUid,
  targetEmail,
  desiredCount,
  goalIdMap,
  storyIdMap,
  dryRun,
}) {
  const sourceDocs = await fetchSourceDocs(db, collectionName, sourceUid, desiredCount);
  const sourceRows = sourceDocs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
  const workingRows = [...sourceRows];
  while (workingRows.length < desiredCount && sourceRows.length > 0) {
    const template = sourceRows[workingRows.length % sourceRows.length];
    workingRows.push({
      id: `${template.id}_clone_${workingRows.length + 1}`,
      data: { ...template.data },
    });
  }

  let copied = 0;

  for (let index = 0; index < workingRows.length; index += 1) {
    const sourceDoc = workingRows[index];
    const original = sourceDoc.data;

    let transformed = rewriteOwnershipFields(original, sourceUid, targetUid);
    transformed = sanitizeDocument(collectionName, transformed, index);
    transformed = rewriteLinkedIds(collectionName, transformed, goalIdMap, storyIdMap);

    if (typeof transformed.ownerUid === 'string' || collectionName !== 'fitness_overview') {
      transformed.ownerUid = targetUid;
    }
    if (typeof transformed.userId === 'string') {
      transformed.userId = targetUid;
    }
    if (typeof transformed.uid === 'string' && transformed.uid === sourceUid) {
      transformed.uid = targetUid;
    }
    if (typeof transformed.ownerEmail === 'string') {
      transformed.ownerEmail = targetEmail || transformed.ownerEmail;
    }
    if (typeof transformed.userEmail === 'string') {
      transformed.userEmail = targetEmail || transformed.userEmail;
    }

    if (sourceEmail && typeof transformed.ownerEmail === 'string' && transformed.ownerEmail === sourceEmail && targetEmail) {
      transformed.ownerEmail = targetEmail;
    }

    transformed = stampDemoMetadata(transformed, sourceUid, sourceDoc.id);

    const targetDocId = deterministicDocId(targetUid, collectionName, sourceDoc.id);
    const ref = db.collection(collectionName).doc(targetDocId);
    if (!dryRun) {
      writer.set(ref, transformed, { merge: true });
    }

    if (collectionName === 'goals') {
      goalIdMap.set(sourceDoc.id, targetDocId);
    }
    if (collectionName === 'stories') {
      storyIdMap.set(sourceDoc.id, targetDocId);
    }

    copied += 1;
  }

  return {
    collection: collectionName,
    requested: desiredCount,
    available: sourceDocs.length,
    copied,
  };
}

async function copyUidScopedDoc({
  db,
  writer,
  collectionName,
  sourceUid,
  targetUid,
  dryRun,
}) {
  const sourceRef = db.collection(collectionName).doc(sourceUid);
  const sourceSnap = await sourceRef.get();
  if (!sourceSnap.exists) {
    return {
      collection: collectionName,
      requested: 1,
      available: 0,
      copied: 0,
    };
  }

  let transformed = rewriteOwnershipFields(sourceSnap.data() || {}, sourceUid, targetUid);
  transformed.ownerUid = targetUid;
  transformed = stampDemoMetadata(transformed, sourceUid, sourceUid);
  const targetRef = db.collection(collectionName).doc(targetUid);
  if (!dryRun) {
    writer.set(targetRef, transformed, { merge: true });
  }

  return {
    collection: collectionName,
    requested: 1,
    available: 1,
    copied: 1,
  };
}

async function main() {
  const serviceAccountPath = path.resolve(getArg('--service-account', DEFAULT_SERVICE_ACCOUNT));
  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(`Service account file not found: ${serviceAccountPath}`);
  }

  const sourceRef = getArg('--source', DEFAULT_SOURCE);
  const targetRef = getArg('--target', DEFAULT_TARGET);
  const limit = parsePositiveInt(getArg('--limit', DEFAULT_LIMIT), DEFAULT_LIMIT);
  const monzoLimit = parsePositiveInt(getArg('--monzo-limit', DEFAULT_MONZO_LIMIT), DEFAULT_MONZO_LIMIT);
  const dryRun = hasFlag('--dry-run');

  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  const auth = admin.auth();
  const db = admin.firestore();
  const writer = db.bulkWriter();
  writer.onWriteError((error) => {
    console.error(`Write error on ${error.documentRef?.path || 'unknown'}:`, error.message);
    return false;
  });

  const sourceUser = await resolveUser(auth, 'source', sourceRef);
  const targetUser = await resolveUser(auth, 'target', targetRef);

  console.log('Source:', sourceUser.email || sourceUser.uid, `(${sourceUser.uid})`);
  console.log('Target:', targetUser.email || targetUser.uid, `(${targetUser.uid})`);
  console.log('Dry run:', dryRun ? 'yes' : 'no');

  const goalIdMap = new Map();
  const storyIdMap = new Map();
  const results = [];

  const collectionPlan = [
    { collectionName: 'goals', desiredCount: limit },
    { collectionName: 'stories', desiredCount: limit },
    { collectionName: 'tasks', desiredCount: limit },
    { collectionName: 'chores', desiredCount: limit },
    { collectionName: 'habits', desiredCount: limit }, // routines equivalent
    { collectionName: 'metrics_workouts', desiredCount: limit }, // health workouts
    { collectionName: 'monzo_transactions', desiredCount: monzoLimit }, // finance
  ];

  for (const item of collectionPlan) {
    // Goals/stories copied first so linked references can be remapped in tasks/habits.
    const result = await copyOwnerCollection({
      db,
      writer,
      collectionName: item.collectionName,
      sourceUid: sourceUser.uid,
      sourceEmail: sourceUser.email || '',
      targetUid: targetUser.uid,
      targetEmail: targetUser.email || '',
      desiredCount: item.desiredCount,
      goalIdMap,
      storyIdMap,
      dryRun,
    });
    results.push(result);
  }

  const uidScopedCollections = ['fitness_overview', 'monzo_budget_summary', 'monzo_goal_alignment'];
  for (const collectionName of uidScopedCollections) {
    const result = await copyUidScopedDoc({
      db,
      writer,
      collectionName,
      sourceUid: sourceUser.uid,
      targetUid: targetUser.uid,
      dryRun,
    });
    results.push(result);
  }

  if (!dryRun) {
    await writer.close();
  }

  console.log('\nCopy summary:');
  for (const result of results) {
    console.log(
      `- ${result.collection}: requested=${result.requested}, available=${result.available}, copied=${result.copied}`
    );
  }

  const totalCopied = results.reduce((sum, row) => sum + row.copied, 0);
  console.log(`\nTotal copied: ${totalCopied}`);
}

main().catch((error) => {
  console.error('\nCopy failed:', error.message);
  process.exitCode = 1;
});
