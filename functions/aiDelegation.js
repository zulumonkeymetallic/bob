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
 *
 * ENGINES. There are two ways a delegated item can be executed and they used to be entirely
 * separate features: this cloud cycle, and Hermes' run_delegation_cycle.py on the Mac. Both
 * read `flaggedToAi` and both write the same result fields, so before `aiDelegationEngine`
 * existed they raced each other for the same queue. The field is now the router: 'hermes' is
 * left alone here, anything else (including unset) is ours. See selectEngine() below.
 *
 * REVISION LOOP. Rejecting a result writes `aiDelegationFeedback` and re-raises `flaggedToAi`.
 * The next pass through this file spends one extra model call rewriting the research prompt in
 * light of that commentary before doing any research — feeding the criticism straight into the
 * research call instead produces a document that argues with the reviewer rather than one that
 * answers the revised question.
 */
const admin = require('firebase-admin');
const { callLLM } = require('./utils/llmHelper');
const { getDriveClient, ensureEntityFolder } = require('./driveHierarchy');

const BOB_BASE = 'https://bob.jc1.tech';
const MAX_ITEMS_PER_RUN = 5;

/** Engine ids. Anything not explicitly 'hermes' runs in the cloud on Gemini. */
const ENGINE_GEMINI = 'gemini';
const ENGINE_HERMES = 'hermes';

const selectEngine = (raw) => (String(raw || '').trim().toLowerCase() === ENGINE_HERMES ? ENGINE_HERMES : ENGINE_GEMINI);

/**
 * Vertex model per tier — "the best model for the ask", resolved from the prompt rather than
 * chosen by hand. `null` means the tier cannot be served at all.
 *
 * flash for work that is mostly transcription of an instruction into prose; pro wherever the
 * output depends on the model actually reasoning about something. Over-provisioning a cheap
 * prompt costs pennies; under-provisioning a hard one costs a document Jim has to redo.
 */
const TIER_MODELS = {
  simple: 'gemini-2.5-flash',
  research: 'gemini-2.5-pro',
  analysis: 'gemini-2.5-pro',
  image: null,
};

/** A rejected result is evidence the tier was too cheap, so every revision runs on the top
 *  tier regardless of what the classifier says about the prompt. */
const REVISION_MODEL = 'gemini-2.5-pro';

const DOC_SYSTEM_PROMPT = [
  'You are generating content for a professional Google Document.',
  'Use # for the main document title, ## for section headings, ### for sub-headings.',
  'Use - for bullet lists, 1. for numbered steps.',
  'Write in clear, concise UK English. No meta-commentary or preambles.',
].join('\n');

/**
 * Rewrites the research prompt after a rejection. Deliberately returns a prompt and nothing
 * else — no apology, no explanation of what changed — because the output is fed directly to
 * the research call as its instruction.
 */
const PROMPT_REVISION_SYSTEM_PROMPT = [
  'You rewrite research prompts. You will be given the original prompt, the document it',
  'produced, and the reviewer\'s reasons for rejecting that document.',
  'Return ONLY the rewritten prompt — no preamble, no commentary, no quotes around it.',
  'The rewritten prompt must address every point the reviewer raised, keep whatever the',
  'reviewer did not criticise, and be specific about scope, depth and the form of the answer.',
  'Write in UK English.',
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

/**
 * Mirror the output into `research_docs`.
 *
 * This is what makes delegation and the old "AI research" feature one thing rather than two.
 * The research module wrote its briefs here and nowhere else (Firestore markdown, no Drive
 * file, no review state); delegation wrote a Drive file and nothing here. Two features, two
 * document stores, neither aware of the other. Writing both means every AI-produced document
 * for an entity appears in one list, with the Drive file as the canonical artefact and this
 * row as the index entry.
 *
 * Best-effort: a failed mirror must not lose the Drive document that was already created.
 */
async function mirrorResearchDoc(db, uid, { entityType, entityId, goalId, title, markdown, docUrl, prompt, taskType, model, engine, revision }) {
  try {
    const ref = db.collection('research_docs').doc();
    const now = admin.firestore.FieldValue.serverTimestamp();
    await ref.set({
      id: ref.id,
      ownerUid: uid,
      // Only one of these is set, matching how ResearchDocModal queries them.
      ...(entityType === 'story' ? { storyId: entityId } : {}),
      ...(entityType === 'task' ? { taskId: entityId } : {}),
      ...(entityType === 'goal' ? { goalId: entityId } : {}),
      ...(goalId && entityType !== 'goal' ? { goalId } : {}),
      title,
      docMd: markdown,
      driveDocUrl: docUrl,
      researchPrompt: prompt,
      source: 'ai_delegation',
      taskType,
      model,
      engine,
      revision: revision || 0,
      createdAt: now,
      updatedAt: now,
    });
    return ref.id;
  } catch (err) {
    console.warn('[aiDelegation] research_docs mirror failed:', err?.message);
    return null;
  }
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

/**
 * Items flagged for AI across all three collections, minus anything routed to Hermes.
 *
 * The engine filter is applied here rather than in the query because `aiDelegationEngine` is
 * absent on every item flagged before it existed, and Firestore cannot express "field is
 * missing OR equals X" in one query — a `where('aiDelegationEngine','==','gemini')` would
 * silently drop the entire existing backlog.
 */
async function findFlaggedItems(db, uid, limit, onlyId = null) {
  const collections = [['stories', 'story'], ['tasks', 'task'], ['goals', 'goal']];
  const found = [];
  for (const [collection, entityType] of collections) {
    const snap = await db.collection(collection)
      .where('ownerUid', '==', uid)
      .where('flaggedToAi', '==', true)
      .limit(limit * 2)
      .get();
    snap.docs.forEach((d) => {
      // `onlyId` backs the modal's "run now": without it, pressing that button runs the whole
      // queue, so Jim waits on up to five unrelated items and the feedback he gets back may
      // be about someone else's document.
      if (onlyId && d.id !== onlyId) return;
      const data = d.data();
      if (selectEngine(data.aiDelegationEngine) === ENGINE_HERMES) return;
      found.push({ id: d.id, entityType, collection, data });
    });
  }
  return found.slice(0, limit);
}

/**
 * The prompt to research with, and the model to do it on.
 *
 * On a first pass that is just the stored prompt at whatever tier the classifier picks. On a
 * revision it is a rewrite of that prompt informed by the rejection commentary, always on the
 * top tier — see REVISION_MODEL.
 */
async function resolveWorkingPrompt(data, basePrompt, title) {
  const feedback = String(data.aiDelegationFeedback || '').trim();
  if (!feedback) {
    const taskType = data.aiDelegationType || data.aiDelegationTaskType || classifyDelegationTask(basePrompt);
    return { prompt: basePrompt, taskType, model: TIER_MODELS[taskType], revised: false };
  }

  const previousOutput = String(data.aiOutput || '').slice(0, 4000);
  const revisionInput = [
    `## Original prompt`, basePrompt, '',
    `## Document it produced (extract)`, previousOutput || '(not recorded)', '',
    `## Reviewer's rejection`, feedback,
  ].join('\n');

  let revisedPrompt = basePrompt;
  try {
    const rewritten = await callLLM(PROMPT_REVISION_SYSTEM_PROMPT, revisionInput, REVISION_MODEL);
    const trimmed = String(rewritten || '').trim();
    if (trimmed) revisedPrompt = trimmed;
  } catch (err) {
    // A failed rewrite must not sink the revision — fall back to the original prompt with the
    // commentary appended, which is worse but still incorporates what Jim asked for.
    console.warn('[aiDelegation] prompt revision failed, appending feedback instead:', err?.message);
    revisedPrompt = `${basePrompt}\n\nThe previous attempt was rejected for these reasons — address them:\n${feedback}`;
  }

  const taskType = data.aiDelegationType || data.aiDelegationTaskType || classifyDelegationTask(revisedPrompt);
  return { prompt: revisedPrompt, taskType, model: REVISION_MODEL, revised: true };
}

/**
 * One pass of the delegation queue.
 *
 * Returns a per-item result list rather than throwing on the first failure: one malformed
 * prompt must not stop the other four being processed, and the caller needs to see which
 * items moved and which did not.
 */
async function runDelegationCycle(uid, { limit = MAX_ITEMS_PER_RUN, dryRun = false, onlyId = null } = {}) {
  const db = admin.firestore();
  const items = await findFlaggedItems(db, uid, limit, onlyId);
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

    // dryRun classifies without spending the revision call, so it reports the tier the prompt
    // would land in as it stands — not the tier a revision would force it up to.
    if (dryRun) {
      const dryType = data.aiDelegationType || data.aiDelegationTaskType || classifyDelegationTask(prompt);
      const dryModel = data.aiDelegationFeedback ? REVISION_MODEL : TIER_MODELS[dryType];
      if (!TIER_MODELS[dryType]) {
        results.push({ ref, link, status: 'rejected', reason: 'Image generation is not supported', taskType: dryType });
        continue;
      }
      results.push({ ref, link, status: 'would_process', taskType: dryType, model: dryModel, engine: ENGINE_GEMINI });
      continue;
    }

    let working;
    try {
      working = await resolveWorkingPrompt(data, prompt, title);
    } catch (err) {
      results.push({ ref, link, status: 'error', reason: err?.message || 'Prompt resolution failed' });
      continue;
    }
    const { prompt: workingPrompt, taskType, revised } = working;
    const model = working.model;

    if (!model) {
      await db.collection(collection).doc(id).set({
        flaggedToAi: false,
        aiDelegationStatus: 'rejected',
        aiDelegationRejectedReason: 'Image generation is not supported',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      await logActivity(db, id, entityType, uid, 'AI delegation declined: image generation is not supported');
      results.push({ ref, link, status: 'rejected', reason: 'Image generation is not supported', taskType });
      continue;
    }

    const revision = Number(data.aiDelegationRevision || 0) + (revised ? 1 : 0);

    try {
      const response = await callLLM(DOC_SYSTEM_PROMPT, `# ${title}\n\n${workingPrompt}`, model);
      const docName = revision > 0 ? `${ref} — ${title} (rev ${revision})` : `${ref} — ${title}`;
      const { docUrl } = await createDelegationDoc(uid, entityType, id, docName, response);

      await mirrorResearchDoc(db, uid, {
        entityType,
        entityId: id,
        goalId: data.goalId || null,
        title: docName,
        markdown: response,
        docUrl,
        prompt: workingPrompt,
        taskType,
        model: `vertex:${model}`,
        engine: ENGINE_GEMINI,
        revision,
      });

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
        aiDelegationEngine: ENGINE_GEMINI,
        aiDelegationDocumentLink: docUrl,
        // Mirrored so it shows in the edit modal's Document field without waiting on
        // delegationWorker's trigger, which only fires on a status *change*.
        documentLink: docUrl,
        // The prompt actually used, so a revision is inspectable rather than mysterious.
        aiDelegationPrompt: workingPrompt,
        aiDelegationRevision: revision,
        ...(revised ? {
          aiDelegationPreviousDocumentLink: data.aiDelegationDocumentLink || null,
          // Consumed — leaving it set would re-revise against stale commentary on the next run.
          aiDelegationFeedback: admin.firestore.FieldValue.delete(),
        } : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      await logActivity(db, id, entityType, uid,
        `AI delegation ${revised ? `revision ${revision}` : 'complete'} (${taskType} via vertex:${model}) — ${docUrl}`);

      results.push({ ref, link, status: 'completed', taskType, model: `vertex:${model}`, docUrl, revision, revised, engine: ENGINE_GEMINI });
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
  selectEngine,
  resolveWorkingPrompt,
  TIER_MODELS,
  REVISION_MODEL,
  MAX_ITEMS_PER_RUN,
  ENGINE_GEMINI,
  ENGINE_HERMES,
};
