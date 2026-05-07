#!/usr/bin/env node
'use strict';

/**
 * Deduplicates overlapping calendar blocks for a user.
 *
 * Two passes:
 *   1. Same-title duplicates: any two non-story/non-task blocks with the same
 *      normalised title that overlap by ≥5 min are duplicates. Keep best, delete rest.
 *   2. Heavy-overlap duplicates: any two non-story/non-task blocks (different title,
 *      neither is a Work/theme backdrop) where the overlap covers ≥70% of the shorter
 *      block's duration. Keep best, delete rest.
 *
 * "Best" = has googleEventId first, then syncToGoogle != false, then most recently created.
 *
 * Work/theme backdrop blocks (syncToGoogle===false) are excluded from pass 2 to avoid
 * deleting them just because an activity happens during work hours.
 *
 * Usage:
 *   node scripts/dedup-calendar-blocks.js [--dry-run] [--uid=<uid>]
 */

const admin = require('../functions/node_modules/firebase-admin');

const SERVICE_ACCOUNT = '/Users/jim/Library/Mobile Documents/com~apple~CloudDocs/secret/bob/bob20250810-firebase-adminsdk-fbsvc-0f8ac23f94.json';
const DEFAULT_UID = '3L3nnXSuTPfr08c8DTXG5zYX37A2';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const uid = (args.find((a) => a.startsWith('--uid=')) || `--uid=${DEFAULT_UID}`).slice(6);

admin.initializeApp({
  credential: admin.credential.cert(require(SERVICE_ACCOUNT)),
  projectId: 'bob20250810',
});
const db = admin.firestore();

function overlapMs(a, b) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

function normaliseTitle(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
}

// Score a block: higher = more authoritative → keep this one
function score(block) {
  let s = 0;
  if (block.googleEventId) s += 1000;
  if (block.syncToGoogle !== false) s += 100;
  s += Math.floor((block.createdMs || 0) / 1e9);
  return s;
}

function clusterPairs(blocks, shouldPair) {
  const parent = blocks.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (i, j) => { parent[find(i)] = find(j); };

  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      if (shouldPair(blocks[i], blocks[j])) union(i, j);
    }
  }

  const map = new Map();
  blocks.forEach((b, i) => {
    const root = find(i);
    if (!map.has(root)) map.set(root, []);
    map.get(root).push(b);
  });
  return [...map.values()].filter((c) => c.length > 1);
}

async function run() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}, uid: ${uid}`);

  const snap = await db.collection('calendar_blocks').where('ownerUid', '==', uid).get();
  console.log(`Total blocks loaded: ${snap.size}`);

  const candidates = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}), createdMs: d.data().createdAt?.toMillis?.() || 0 }))
    .filter((b) => !b.storyId && !b.taskId && !b.linkedEntityId)
    .filter((b) => !/^(ST|TK)-/i.test(String(b.title || '')))
    .filter((b) => {
      const s = Number(b.start); const e = Number(b.end);
      return Number.isFinite(s) && Number.isFinite(e) && e > s;
    });

  console.log(`Health/routine blocks (no story/task link): ${candidates.length}`);

  const toDeleteSet = new Set();

  const processCluster = (cluster, label) => {
    const sorted = [...cluster].sort((a, b) => score(b) - score(a));
    const keep = sorted[0];
    const del = sorted.slice(1).filter((b) => !toDeleteSet.has(b.id));
    if (!del.length) return;
    console.log(`  [${label}] Cluster [${cluster.length}] ${new Date(keep.start).toISOString().slice(0, 16)} – ${new Date(keep.end).toISOString().slice(11, 16)}`);
    console.log(`    KEEP: "${keep.title?.slice(0, 50)}" gcal=${!!keep.googleEventId}`);
    del.forEach((b) => {
      console.log(`    DEL:  "${b.title?.slice(0, 50)}" gcal=${!!b.googleEventId}`);
      toDeleteSet.add(b.id);
    });
  };

  // Pass 1: Same-title duplicates (any overlap ≥5 min)
  const sameTitleClusters = clusterPairs(candidates, (a, b) => {
    if (normaliseTitle(a.title) !== normaliseTitle(b.title)) return false;
    if (!normaliseTitle(a.title)) return false; // skip blank titles
    return overlapMs(a, b) >= 5 * 60 * 1000;
  });
  console.log(`\nPass 1 — same-title duplicates: ${sameTitleClusters.length} clusters`);
  sameTitleClusters.forEach((c) => processCluster(c, 'same-title'));

  // Pass 2: Heavy-overlap duplicates (≥70% of shorter, both must NOT be syncToGoogle===false)
  const nonBackdrop = candidates.filter((b) => b.syncToGoogle !== false);
  const heavyOverlapClusters = clusterPairs(nonBackdrop, (a, b) => {
    if (normaliseTitle(a.title) === normaliseTitle(b.title)) return false; // already handled
    const overlap = overlapMs(a, b);
    const shorter = Math.min(a.end - a.start, b.end - b.start);
    return overlap >= shorter * 0.7 && overlap >= 15 * 60 * 1000;
  });
  console.log(`Pass 2 — heavy-overlap duplicates: ${heavyOverlapClusters.length} clusters`);
  heavyOverlapClusters.forEach((c) => processCluster(c, 'heavy-overlap'));

  const toDelete = [...toDeleteSet];
  console.log(`\nSummary: ${toDelete.length} blocks to delete`);

  if (DRY_RUN) {
    console.log('Dry run — no changes made.');
    process.exit(0);
  }

  const BATCH_SIZE = 400;
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const batch = db.batch();
    toDelete.slice(i, i + BATCH_SIZE).forEach((id) => batch.delete(db.collection('calendar_blocks').doc(id)));
    await batch.commit();
    deleted += Math.min(BATCH_SIZE, toDelete.length - i);
    console.log(`Deleted ${deleted}/${toDelete.length}...`);
  }

  console.log('Done.');
  process.exit(0);
}

run().catch((e) => { console.error(e.message); process.exit(1); });
