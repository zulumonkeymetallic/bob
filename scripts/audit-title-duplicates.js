#!/usr/bin/env node
/*
 Audit duplicate tasks by normalized title.

 Usage:
   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/sa.json node scripts/audit-title-duplicates.js --uid <UID> [--minCount 2] [--limit 50]

 Notes:
 - Normalization mirrors functions/index.js normalizeTitle: lowercased, strip URLs, strip punctuation, collapse whitespace.
 - If --uid is omitted, scans ALL tasks (heavy). Prefer providing --uid.
 */

const admin = require('firebase-admin');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.replace(/^--/, '');
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { args[key] = next; i++; }
    else { args[key] = true; }
  }
  return args;
}

// Hardened normalizer: NFKD, strip diacritics, remove zero-width/formatting chars, lowercase, strip URLs and punctuation
function normalizeTitleHardened(s) {
  if (!s) return '';
  let str = String(s);
  try { str = str.normalize('NFKD'); } catch {}
  str = str.replace(/[\u0300-\u036f]/g, '');
  str = str.replace(/[\u200B-\u200D\uFEFF\u00AD\u061C\u2060-\u206F\uFE0E\uFE0F]/g, '');
  str = str.toLowerCase();
  str = str.replace(/https?:\/\/\S+/g, ' ');
  str = str.replace(/www\.[^\s]+/g, ' ');
  str = str.replace(/[\[\]{}()\"'`“”‘’.,!?;:<>_~*^#%\\/\\|+\-=]/g, ' ');
  return str.replace(/\s+/g, ' ').trim();
}

function normalizeTitle(s) {
  if (!s) return '';
  let str = String(s).toLowerCase();
  str = str.replace(/https?:\/\/\S+/g, ' ');
  str = str.replace(/www\.[^\s]+/g, ' ');
  str = str.replace(/[\[\]{}()"'`“”‘’.,!?;:<>_~*^#%\\/\\|+-=]/g, ' ');
  str = str.replace(/\s+/g, ' ').trim();
  return str;
}

async function main() {
  const args = parseArgs(process.argv);
  const ownerUid = args.uid ? String(args.uid) : null;
  const minCount = Number(args.minCount || 2);
  const limit = Number(args.limit || 50);

  if (!admin.apps.length) {
    try { admin.initializeApp(); }
    catch (e) { console.error('Failed to init admin:', e.message); process.exit(1); }
  }
  const db = admin.firestore();

  console.log('Scanning tasks…', ownerUid ? `(ownerUid=${ownerUid})` : '(ALL USERS)');
  let q = db.collection('tasks');
  if (ownerUid) q = q.where('ownerUid', '==', ownerUid);
  const snap = await q.get();
  console.log(`Fetched ${snap.size} tasks`);

  const buckets = new Map();
  for (const doc of snap.docs) {
    const t = doc.data() || {};
    const norm = normalizeTitleHardened(t.title || t.name || t.task || '');
    if (!norm) continue;
    const list = buckets.get(norm) || [];
    list.push({ id: doc.id, title: t.title || '', ref: t.ref || t.reference || doc.id, status: t.status || 0, reminderId: t.reminderId || null });
    buckets.set(norm, list);
  }

  const dupes = Array.from(buckets.entries())
    .filter(([, items]) => items.length >= minCount)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, limit);

  const summary = dupes.map(([norm, items]) => ({ count: items.length, title: items[0]?.title || norm, norm, sample: items.slice(0, 5) }));

  console.log(JSON.stringify({ totalTasks: snap.size, duplicateGroups: dupes.length, minCount, top: summary }, null, 2));
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
