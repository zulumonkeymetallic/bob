#!/usr/bin/env node
/*
 Validate calendar auto-link coverage and stale links.

 Usage:
   node scripts/validate-calendar-links.js --serviceAccount=/abs/path/to/sa.json --uid=<UID> [--project=bob20250810] [--days=30] [--threshold=0.4] [--allowWarnings]
*/

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function getArg(flag, fallback = '') {
  const i = process.argv.indexOf(flag);
  if (i !== -1) {
    const v = process.argv[i + 1];
    if (v && !v.startsWith('--')) return String(v);
  }
  const eq = process.argv.find((a) => a.startsWith(flag + '='));
  if (eq) return String(eq.split('=')[1] || '');
  return fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function keywordScore(a, b) {
  const aWords = String(a || '').toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const bWords = String(b || '').toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  if (!aWords.length || !bWords.length) return 0;
  const overlap = aWords.filter((w) => bWords.includes(w)).length;
  return overlap / Math.max(aWords.length, bWords.length);
}

function isClosedStatus(status) {
  const closed = new Set(['done', 'completed', 'closed', 'archived', 'cancelled', 'canceled', 'deleted']);
  return closed.has(String(status || '').toLowerCase());
}

async function main() {
  const serviceAccountPath = getArg('--serviceAccount');
  const uid = getArg('--uid');
  const project = getArg('--project', 'bob20250810');
  const days = Number(getArg('--days', '30')) || 30;
  const threshold = Number(getArg('--threshold', '0.4')) || 0.4;
  const allowWarnings = hasFlag('--allowWarnings');

  if (!serviceAccountPath || !uid) {
    console.error('Usage: --serviceAccount <path> --uid <uid> [--project <id>] [--days <N>] [--threshold <N>] [--allowWarnings]');
    process.exit(2);
  }

  const abs = path.resolve(serviceAccountPath);
  if (!fs.existsSync(abs)) {
    console.error(`Service account file not found: ${abs}`);
    process.exit(2);
  }

  const sa = require(abs);
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: project || sa.project_id,
  });

  const db = admin.firestore();
  const sinceMs = Date.now() - (days * 24 * 60 * 60 * 1000);

  const [storiesSnap, blocksSnap] = await Promise.all([
    db.collection('stories').where('ownerUid', '==', uid).get(),
    db.collection('calendar_blocks')
      .where('ownerUid', '==', uid)
      .where('start', '>=', sinceMs)
      .get(),
  ]);

  const stories = storiesSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
  const blocks = blocksSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));

  const candidateUnlinked = blocks.filter((block) => {
    const hasGoogleEvent = Boolean(block.googleEventId || block.googleCalendarEventId);
    const hasTitle = Boolean(String(block.title || block.summary || '').trim());
    const alreadyLinked = Boolean(block.storyId || block.taskId || block.linkedStoryId);
    return hasGoogleEvent && hasTitle && !alreadyLinked;
  });

  const potentialMissed = [];
  for (const block of candidateUnlinked) {
    const title = String(block.title || block.summary || '').trim();
    let bestStory = null;
    let bestScore = 0;
    for (const story of stories) {
      const score = keywordScore(title, story.title || '');
      if (score > bestScore) {
        bestScore = score;
        bestStory = story;
      }
    }
    if (bestStory && bestScore >= threshold) {
      potentialMissed.push({
        blockId: block.id,
        title,
        eventId: block.googleEventId || block.googleCalendarEventId || null,
        bestStoryId: bestStory.id,
        bestStoryTitle: bestStory.title || '',
        score: Math.round(bestScore * 1000) / 1000,
      });
    }
  }

  const linkedBlocks = blocks.filter((block) => Boolean(block.storyId || block.taskId));
  const staleLinks = [];
  for (const block of linkedBlocks) {
    if (block.storyId) {
      const storySnap = await db.collection('stories').doc(String(block.storyId)).get();
      if (!storySnap.exists) {
        staleLinks.push({ blockId: block.id, type: 'story', entityId: String(block.storyId), reason: 'missing' });
      } else {
        const story = storySnap.data() || {};
        if (isClosedStatus(story.status)) {
          staleLinks.push({ blockId: block.id, type: 'story', entityId: String(block.storyId), reason: `closed:${story.status}` });
        }
      }
    }
    if (block.taskId) {
      const taskSnap = await db.collection('tasks').doc(String(block.taskId)).get();
      if (!taskSnap.exists) {
        staleLinks.push({ blockId: block.id, type: 'task', entityId: String(block.taskId), reason: 'missing' });
      } else {
        const task = taskSnap.data() || {};
        if (isClosedStatus(task.status)) {
          staleLinks.push({ blockId: block.id, type: 'task', entityId: String(block.taskId), reason: `closed:${task.status}` });
        }
      }
    }
  }

  const summary = {
    uid,
    scannedDays: days,
    storiesCount: stories.length,
    blocksCount: blocks.length,
    unlinkedCandidates: candidateUnlinked.length,
    potentialMissedMatches: potentialMissed.length,
    linkedBlocks: linkedBlocks.length,
    staleLinks: staleLinks.length,
  };

  console.log('Calendar Link Validation Summary');
  console.log(JSON.stringify(summary, null, 2));

  if (potentialMissed.length > 0) {
    console.log('\nPotential missed matches (top 20):');
    potentialMissed.slice(0, 20).forEach((row, idx) => {
      console.log(`${idx + 1}. block=${row.blockId} score=${row.score} event=${row.eventId || 'n/a'}`);
      console.log(`   title=${row.title}`);
      console.log(`   bestStory=${row.bestStoryTitle} (${row.bestStoryId})`);
    });
  }

  if (staleLinks.length > 0) {
    console.log('\nStale links (top 20):');
    staleLinks.slice(0, 20).forEach((row, idx) => {
      console.log(`${idx + 1}. block=${row.blockId} ${row.type}=${row.entityId} reason=${row.reason}`);
    });
  }

  if (!allowWarnings && (potentialMissed.length > 0 || staleLinks.length > 0)) {
    console.error('\nValidation failed: detected potential missed matches or stale links.');
    process.exit(1);
  }

  console.log('\nValidation passed.');
}

main().catch((error) => {
  console.error('Validation failed with error:', error);
  process.exit(1);
});
