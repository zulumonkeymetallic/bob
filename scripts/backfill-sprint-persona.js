#!/usr/bin/env node
/*
 Backfill persona on existing sprints so UI queries match.

 Usage:
   GOOGLE_APPLICATION_CREDENTIALS=<path.json> \
   node scripts/backfill-sprint-persona.js --uid <FIREBASE_UID> [--persona personal|work] [--force] [--dry-run] [--project <id>]

 Notes:
 - Requires Firebase Admin credentials (service account) via GOOGLE_APPLICATION_CREDENTIALS
 - By default only updates docs missing persona; use --force to overwrite existing values
 - Restrict to a single user with --uid; omit to scan all sprints (careful in multi-tenant projects)
*/

const admin = require('firebase-admin');

function getArg(flag, fallback = '') {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  if (!v || v.startsWith('--')) return fallback;
  return String(v);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function init() {
  try {
    if (!admin.apps.length) {
      const projectId = getArg('--project') || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT;
      admin.initializeApp(projectId ? { projectId } : undefined);
    }
  } catch (e) {
    console.error('Failed to initialize Firebase Admin SDK:', e.message);
    process.exit(1);
  }
}

async function run() {
  init();
  const db = admin.firestore();
  const auth = admin.auth();

  const targetUid = getArg('--uid');
  const targetPersona = getArg('--persona', 'personal');
  const force = hasFlag('--force');
  const dryRun = hasFlag('--dry-run');

  if (!targetUid) {
    console.warn('⚠️  No --uid provided. This will scan ALL sprints in the project.');
    console.warn('    Press Ctrl+C to abort, or re-run with --uid <FIREBASE_UID>');
  }

  let userInfo = null;
  try {
    if (targetUid) userInfo = await auth.getUser(targetUid);
  } catch {
    // ignore lookup errors; not strictly required
  }

  const projectId = (admin.app().options && admin.app().options.projectId) || 'unknown';
  console.log(`🔧 Backfilling persona on sprints (project: ${projectId})`);
  if (targetUid) console.log(`→ Restricting to ownerUid=${targetUid} (${userInfo?.email || 'email unknown'})`);
  console.log(`→ Persona to set: ${targetPersona}  (force=${force ? 'yes' : 'no'}, dry-run=${dryRun ? 'yes' : 'no'})`);

  let q = db.collection('sprints');
  if (targetUid) q = q.where('ownerUid', '==', targetUid);

  const snap = await q.get();
  console.log(`Found ${snap.size} sprint(s) to inspect.`);

  const updates = [];
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const current = data.persona;
    const needs = force ? current !== targetPersona : (current == null || String(current).trim() === '');
    if (needs) {
      updates.push({ ref: doc.ref, before: current, after: targetPersona, id: doc.id, name: data.name });
    }
  }

  if (updates.length === 0) {
    console.log('✅ Nothing to do. All sprints already have persona set as desired.');
    return;
  }

  console.log(`Will update ${updates.length} sprint(s):`);
  for (const u of updates.slice(0, 10)) {
    console.log(`  - ${u.id} (${u.name || 'unnamed'}): ${u.before || '<empty>'} -> ${u.after}`);
  }
  if (updates.length > 10) console.log(`  …and ${updates.length - 10} more`);

  if (dryRun) {
    console.log('🧪 Dry run only. No writes performed.');
    return;
  }

  const batchSize = 400;
  let committed = 0;
  for (let i = 0; i < updates.length; i += batchSize) {
    const slice = updates.slice(i, i + batchSize);
    const batch = db.batch();
    for (const u of slice) batch.set(u.ref, { persona: u.after }, { merge: true });
    await batch.commit();
    committed += slice.length;
    console.log(`  committed ${Math.min(i + batchSize, updates.length)}/${updates.length}`);
  }

  console.log(`✅ Backfill complete. Updated ${committed} sprint(s).`);
}

run().catch((e) => {
  console.error('Backfill failed:', e);
  process.exit(1);
});

