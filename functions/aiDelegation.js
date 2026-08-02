/**
 * aiDelegation — the AI delegation cycle, server-side.
 *
 * This ran on Jim's Mac as ~/.hermes/scripts/run_delegation_cycle.py, which meant it only ever
 * ran when that machine was awake, idle and had credentials — and its output depended on a
 * local Python environment nobody else could reproduce. The logic is deterministic and the
 * inputs are all in Firestore, so there was never a reason for it to be local.
 *
 * MODEL ROUTING — Vertex, two tiers, not OpenRouter-by-complexity.
 *
 * The Python routed 'research' to Perplexity and everything else to `openrouter/auto`. Two
 * facts make that the wrong choice here:
 *   - OpenRouter has been returning 402 Insufficient credits since 2026-08-01 (see the commit
 *     that made Vertex primary), so routing to it deliberately buys a guaranteed failure and
 *     the latency of discovering it.
 *   - Vertex is reachable from China, where Jim is from September; OpenRouter may not be.
 * So: flash for the cheap tier, pro for anything that needs to reason. callLLM already falls
 * back to OpenRouter on quota/503 alone, which is the right trigger — a bad prompt should fail
 * loudly rather than quietly get a second opinion from another model.
 *
 * WHAT THIS DOES NOT DO: write `status`. Stories and tasks use different status scales, so the
 * old `status: 2` meant "In Progress" on a story and "Done" on a task — it silently closed
 * every delegated task instead of queueing it for review. Review state is `aiDelegationStatus`,
 * which only this pipeline writes and only Jim clears.
 */
const admin = require('firebase-admin');
const { callLLM } = require('./utils/llmHelper');
const { getDriveClient, ensureEntityFolder } = require('./driveHierarchy');

const BOB_BASE = 'https://bob.jc1.tech';
const MAX_ITEMS_PER_RUN = 5;

/** Vertex model per tier. `null` means the tier cannot be served at all. */
const TIER_MODELS = {
  simple: 'gemini-2.5-flash',
  research: 'gemini-2.5-pro',
  analysis: 'gemini-2.5-pro',
  image: null,
};

const DOC_SYSTEM_PROMPT = [
  'You are generating content for a professional Google Document.',
  'Use # for the main document title, ## for section headings, ### for sub-headings.',
  'Use - for bullet lists, 1. for numbered steps.',
  'Write in clear, concise UK English. No meta-commentary or preambles.',
].join('\n');

// ── Classification ───────────────────────────────────────────────────────────
// Ported verbatim from hermes_utils.classify_delegation_task so a prompt lands in the same
// tier wherever it is processed. Keyword sets, tie-breaks and the 'analysis' default are all
// deliberate: over-provisioning a cheap prompt costs pennies, under-provisioning a hard one
// produces a document Jim has to redo.

const SIMPLE_KW = ['write', 'draft', 'email', 'letter', 'format', 'summarise', 'summarize',
  'compose', 'outline', 'template', 'create', 'plan', 'list', 'describe', 'explain how to',
  'guide', 'step by step'];
const RESEARCH_KW = ['research', 'search', 'find', 'investigate', 'explore', 'discover',
  'lookup', 'look up', 'identify', 'who is', 'what is', 'when did', 'current status', 'latest'];
const ANALYSIS_KW = ['analyse', 'analyze', 'compare', 'evaluate', 'assess', 'review',
  'strategy', 'market', 'opportunities', 'landscape', 'deep dive', 'replicate', 'investment',
  'business model', 'feasibility', 'impact'];
const IMAGE_KW = ['image', 'picture', 'diagram', 'visual', 'illustration', 'generate image',
  'create image', 'draw', 'render'];

const countHits = (text, keywords) => keywords.reduce((n, kw) => n + (text.includes(kw) ? 1 : 0), 0);

function classifyDelegationTask(prompt) {
  const text = String(prompt || '').toLowerCase();
  const scores = {
    image: countHits(text, IMAGE_KW),
    research: countHits(text, RESEARCH_KW),
    analysis: countHits(text, ANALYSIS_KW),
    simple: countHits(text, SIMPLE_KW),
  };
  if (scores.image > 0) return 'image';
  // Research wins ties against analysis and simple, matching the Python's sort key.
  const ranked = ['research', 'analysis', 'simple']
    .sort((a, b) => scores[b] - scores[a] || (a === 'research' ? -1 : b === 'research' ? 1 : 0));
  const winner = ranked[0];
  return scores[winner] > 0 ? winner : 'analysis';
}

// ── Rejection heuristics ─────────────────────────────────────────────────────
// A deterministic pre-flight: things no model can do, caught before spending a call on them.
// The item goes back to the human queue with flaggedToAi cleared and a note saying why.

const REJECTION_PATTERNS = [
  [/^read[:\s]/, 'Requires human reading'],
  [/^watch[:\s]/, 'Requires human viewing'],
  [/^listen[:\s]/, 'Requires human listening/audio'],
  [/^buy\b/, 'Physical purchase — requires human action'],
  [/^purchase\b/, 'Physical purchase — requires human action'],
  [/^order\s+(a|an|my)\b/, 'Physical order — requires human action'],
  [/^go\s+to\b/, 'Requires physical presence'],
  [/^visit\b/, 'Requires physical presence'],
  [/^call\s+\w/, 'Requires human phone call'],
  [/^ring\s+\w/, 'Requires human phone call'],
  [/^meet\b/, 'Requires in-person meeting'],
  [/^attend\b/, 'Requires in-person attendance'],
  [/^print\b/, 'Requires physical printing'],
  [/^sign\b/, 'Requires human signature'],
  [/^collect\b/, 'Requires physical collection'],
  [/^pick\s+up\b/, 'Requires physical pickup'],
  [/^take\s+(a\s+)?(photo|picture|screenshot)\b/, 'Requires human to take image'],
];

function shouldReject(prompt) {
  const text = String(prompt || '').trim().toLowerCase();
  for (const [pattern, reason] of REJECTION_PATTERNS) {
    if (pattern.test(text)) return { reject: true, reason };
  }
  return { reject: false, reason: '' };
}

// ── Google Doc output ────────────────────────────────────────────────────────

/**
 * Write the model's markdown into a real Google Doc, INSIDE the entity's own Drive folder.
 *
 * Filed rather than loose: the Python dropped every delegation doc into one flat folder, so
 * finding the output for a given story meant searching by title. driveHierarchy already knows
 * where a story's files belong, so the doc lands there and shows up in the app's file browser
 * next to everything else about that story.
 *
 * Uploaded as text/markdown and converted by Drive, which gives real headings and lists from
 * the markdown the system prompt asks for — no Docs API batchUpdate required.
 */
async function createDelegationDoc(uid, entityType, entityId, title, markdown) {
  const drive = await getDriveClient(uid);
  let parentFolderId = null;
  try {
    parentFolderId = await ensureEntityFolder(uid, entityType, entityId);
  } catch (err) {
    // A missing folder must not lose the output — fall back to the Drive root.
    console.warn('[aiDelegation] could not resolve entity folder, filing at root:', err?.message);
  }

  const res = await drive.files.create({
    requestBody: {
      name: title,
      mimeType: 'application/vnd.google-apps.document',
      ...(parentFolderId ? { parents: [parentFolderId] } : {}),
    },
    media: { mimeType: 'text/markdown', body: markdown },
    fields: 'id, webViewLink',
  });
  return { docId: res.data.id, docUrl: res.data.webViewLink || `https://docs.google.com/document/d/${res.data.id}/edit` };
}

// ── The cycle ────────────────────────────────────────────────────────────────

const deepLink = (entityType, docId, ref) =>
  `[${ref}](${BOB_BASE}/${entityType === 'task' ? 'tasks' : 'stories'}/${docId})`;

async function logActivity(db, entityId, entityType, uid, note) {
  try {
    await db.collection('activity_stream').add({
      entityId,
      entityType,
      ownerUid: uid,
      activityType: 'note_added',
      description: note,
      source: 'ai_delegation',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: Date.now(),
    });
  } catch (err) {
    console.warn('[aiDelegation] activity log failed:', err?.message);
  }
}

/** Items flagged for AI across both collections, oldest flag first. */
async function findFlaggedItems(db, uid, limit) {
  const collections = [['stories', 'story'], ['tasks', 'task']];
  const found = [];
  for (const [collection, entityType] of collections) {
    const snap = await db.collection(collection)
      .where('ownerUid', '==', uid)
      .where('flaggedToAi', '==', true)
      .limit(limit)
      .get();
    snap.docs.forEach((d) => found.push({ id: d.id, entityType, collection, data: d.data() }));
  }
  return found.slice(0, limit);
}

/**
 * One pass of the delegation queue.
 *
 * Returns a per-item result list rather than throwing on the first failure: one malformed
 * prompt must not stop the other four being processed, and the caller needs to see which
 * items moved and which did not.
 */
async function runDelegationCycle(uid, { limit = MAX_ITEMS_PER_RUN, dryRun = false } = {}) {
  const db = admin.firestore();
  const items = await findFlaggedItems(db, uid, limit);
  const results = [];

  for (const item of items) {
    const { id, entityType, collection, data } = item;
    const ref = data.ref || id.slice(-6);
    const link = deepLink(entityType, id, ref);
    const prompt = String(data.aiDelegationPrompt || data.title || '').trim();
    const title = String(data.title || ref);

    if (!prompt) {
      results.push({ ref, link, status: 'skipped', reason: 'No prompt or title to work from' });
      continue;
    }

    const { reject, reason } = shouldReject(prompt);
    if (reject) {
      if (!dryRun) {
        await db.collection(collection).doc(id).set({
          flaggedToAi: false,
          aiDelegationStatus: 'rejected',
          aiDelegationRejectedReason: reason,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await logActivity(db, id, entityType, uid, `AI delegation declined: ${reason}`);
      }
      results.push({ ref, link, status: 'rejected', reason });
      continue;
    }

    const taskType = data.aiDelegationType || classifyDelegationTask(prompt);
    const model = TIER_MODELS[taskType];

    if (!model) {
      if (!dryRun) {
        await db.collection(collection).doc(id).set({
          flaggedToAi: false,
          aiDelegationStatus: 'rejected',
          aiDelegationRejectedReason: 'Image generation is not supported',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await logActivity(db, id, entityType, uid, 'AI delegation declined: image generation is not supported');
      }
      results.push({ ref, link, status: 'rejected', reason: 'Image generation is not supported', taskType });
      continue;
    }

    if (dryRun) {
      results.push({ ref, link, status: 'would_process', taskType, model });
      continue;
    }

    try {
      const response = await callLLM(DOC_SYSTEM_PROMPT, `# ${title}\n\n${prompt}`, model);
      const { docUrl } = await createDelegationDoc(uid, entityType, id, `${ref} — ${title}`, response);

      await db.collection(collection).doc(id).set({
        flaggedToAi: false,
        // NOT `status` — see the header comment. This is the only review signal.
        aiDelegationStatus: 'human_review',
        aiDelegationCompletedAt: new Date().toISOString(),
        aiOutput: [
          `Completed via AI delegation (vertex:${model}).`,
          `Google Doc: ${docUrl}`,
          '',
          response.slice(0, 500) + (response.length > 500 ? '…' : ''),
        ].join('\n'),
        aiDelegationTaskType: taskType,
        aiDelegationModel: `vertex:${model}`,
        aiDelegationDocumentLink: docUrl,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      await logActivity(db, id, entityType, uid,
        `AI delegation complete (${taskType} via vertex:${model}) — ${docUrl}`);

      results.push({ ref, link, status: 'completed', taskType, model: `vertex:${model}`, docUrl });
    } catch (err) {
      console.error(`[aiDelegation] ${ref} failed:`, err?.message);
      // flaggedToAi is deliberately LEFT SET on failure, so the next run retries it rather
      // than the item silently falling out of the queue.
      results.push({ ref, link, status: 'error', reason: err?.message || 'Unknown error' });
    }
  }

  return { processed: results.length, results };
}

module.exports = {
  runDelegationCycle,
  classifyDelegationTask,
  shouldReject,
  TIER_MODELS,
  MAX_ITEMS_PER_RUN,
};
