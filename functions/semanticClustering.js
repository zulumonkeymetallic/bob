'use strict';

/**
 * Semantic clustering & dedup for the capture pipeline.
 *
 * Shared, server-side capability used by every edge (iOS ingestTranscript,
 * Hermes ingestTranscriptHttp) and the nightly reconcile. Adds MEANING-based
 * matching on top of the existing exact-fingerprint + normalised-title dedup:
 * two differently-worded items about the same thing cluster together instead
 * of creating separate stories.
 *
 * Embeddings: Gemini `text-embedding-004` (768-dim) via GOOGLE_AI_STUDIO_API_KEY
 * (already bound as a secret on the ingestion + nightly functions).
 * Nearest-neighbour: Firestore native vector search (`findNearest`, COSINE).
 *
 * Decision rules (see SEMANTIC_CLUSTERING_DESIGN.md):
 *   cosine ≥ 0.90  → 'attach'  (auto-append/merge, non-destructive, logged)
 *   0.82 ≤ s < 0.90 → 'suggest' (create + potential_duplicate suggestion doc)
 *   s < 0.82        → 'create'  (net-new; store embedding for future clustering)
 *
 * Fail-soft: any embedding/query error returns a 'create' decision so ingestion
 * is never blocked — the existing string dedup still applies upstream.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const admin = require('firebase-admin');

const EMBED_MODEL = 'text-embedding-004';
const EMBED_DIM = 768;
const EMBED_FIELD = 'titleEmbedding';

const ATTACH_THRESHOLD = 0.90;   // auto-append/merge
const SUGGEST_THRESHOLD = 0.82;  // flag as possible duplicate

// Open statuses worth clustering against (numeric BOB story/task statuses).
const OPEN_STATUSES = [0, 1, 2];
// Types never clustered (recurring items pollute sizing/matching).
const EXCLUDED_TYPES = new Set(['chore', 'routine', 'habit', 'habitual']);

let _genAI = null;
function embedClient() {
  if (_genAI) return _genAI;
  // firebase defineSecret('GOOGLEAISTUDIOAPIKEY') exposes the value on the
  // GOOGLEAISTUDIOAPIKEY env var (secret name, no underscores). Accept both.
  const key = process.env.GOOGLEAISTUDIOAPIKEY || process.env.GOOGLE_AI_STUDIO_API_KEY;
  if (!key) throw new Error('GOOGLEAISTUDIOAPIKEY not set — cannot embed');
  _genAI = new GoogleGenerativeAI(key);
  return _genAI;
}

/** Text we embed: title carries most of the signal; a slice of description adds context. */
function buildEmbedText(title, description) {
  const t = String(title || '').trim();
  const d = String(description || '').trim().slice(0, 500);
  return d ? `${t}\n${d}` : t;
}

/**
 * Embed one string → number[768]. Throws on failure (callers fail-soft).
 */
async function embedText(text) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  const model = embedClient().getGenerativeModel({ model: EMBED_MODEL });
  const res = await model.embedContent(clean);
  const values = res && res.embedding && res.embedding.values;
  if (!Array.isArray(values) || values.length !== EMBED_DIM) {
    throw new Error(`unexpected embedding shape: ${values ? values.length : 'null'}`);
  }
  return values;
}

/** Firestore Vector value from a plain array. */
function toVector(values) {
  return admin.firestore.FieldValue.vector(values);
}

/**
 * Nearest open entities of `kind` ('stories'|'tasks') for a user, by cosine.
 * Returns [{ id, ref, data, similarity }] sorted most-similar first.
 * COSINE distance from Firestore is 1 - cosineSimilarity, so similarity = 1 - distance.
 */
async function findNearestOpen(db, uid, collection, queryValues, limit = 5) {
  // Prefilter on ownerUid only (equality is supported alongside findNearest;
  // `status in [...]` is not a reliable vector prefilter). Over-fetch, then
  // filter to open statuses in application code.
  const snap = await db.collection(collection)
    .where('ownerUid', '==', uid)
    .findNearest({
      vectorField: EMBED_FIELD,
      queryVector: toVector(queryValues),
      limit: Math.max(limit * 3, 15),
      distanceMeasure: 'COSINE',
      distanceResultField: '_dist',
    }).get();

  const open = new Set(OPEN_STATUSES.map(String).concat(OPEN_STATUSES.map(Number)));
  return snap.docs
    .map((d) => {
      const data = d.data();
      const dist = typeof data._dist === 'number' ? data._dist : 1;
      return { id: d.id, ref: data.ref || null, data, similarity: 1 - dist };
    })
    .filter((m) => open.has(m.data.status) || open.has(Number(m.data.status)))
    .slice(0, limit);
}

function isExcluded(entity) {
  const type = String(entity && (entity.type || entity.task_type || entity.category) || '').toLowerCase();
  return EXCLUDED_TYPES.has(type);
}

/**
 * Decide what to do with one extracted candidate before it is created.
 *
 * @returns {Promise<{
 *   action: 'attach'|'suggest'|'create',
 *   embedding: number[]|null,
 *   match: { id, ref, similarity }|null,
 *   reason: string
 * }>}
 */
async function resolveCandidate({ db, uid, kind, title, description, entity }) {
  // kind: 'story' | 'task' → collection to match against.
  if (entity && isExcluded(entity)) {
    return { action: 'create', embedding: null, match: null, reason: 'excluded_type' };
  }
  let embedding;
  try {
    embedding = await embedText(buildEmbedText(title, description));
  } catch (err) {
    return { action: 'create', embedding: null, match: null, reason: `embed_failed:${err.message}` };
  }
  if (!embedding) {
    return { action: 'create', embedding: null, match: null, reason: 'empty_text' };
  }

  // A new task can attach to an existing STORY; a new story matches other stories.
  const targetCollection = kind === 'task' ? 'stories' : 'stories';
  let nearest = [];
  try {
    nearest = await findNearestOpen(db, uid, targetCollection, embedding, 5);
    // A story also usefully matches other open tasks for the suggest tier.
  } catch (err) {
    // Vector index missing or query failure → fail-soft to create + store embedding.
    return { action: 'create', embedding, match: null, reason: `findnearest_failed:${err.message}` };
  }

  const top = nearest.find((n) => n.data && n.data[EMBED_FIELD]) || nearest[0];
  if (!top) {
    return { action: 'create', embedding, match: null, reason: 'no_neighbours' };
  }
  const match = { id: top.id, ref: top.ref, similarity: Number(top.similarity.toFixed(4)) };

  if (top.similarity >= ATTACH_THRESHOLD) {
    return { action: 'attach', embedding, match, reason: `cosine=${match.similarity}` };
  }
  if (top.similarity >= SUGGEST_THRESHOLD) {
    return { action: 'suggest', embedding, match, reason: `cosine=${match.similarity}` };
  }
  return { action: 'create', embedding, match, reason: `cosine=${match.similarity} < ${SUGGEST_THRESHOLD}` };
}

/**
 * Backfill embeddings onto existing open stories/tasks so findNearest has a
 * populated corpus. Idempotent: skips docs that already have EMBED_FIELD.
 * Batched + budgeted. Returns { embedded, skipped, failed }.
 */
async function backfillEmbeddings(db, uid, { collection = 'stories', budget = 300 } = {}) {
  const snap = await db.collection(collection)
    .where('ownerUid', '==', uid)
    .where('status', 'in', OPEN_STATUSES)
    .limit(1000)
    .get();

  let embedded = 0; let skipped = 0; let failed = 0;
  for (const doc of snap.docs) {
    if (embedded >= budget) break;
    const data = doc.data();
    if (data[EMBED_FIELD]) { skipped += 1; continue; }
    if (isExcluded(data)) { skipped += 1; continue; }
    try {
      const values = await embedText(buildEmbedText(data.title, data.description));
      if (!values) { skipped += 1; continue; }
      await doc.ref.update({ [EMBED_FIELD]: toVector(values) });
      embedded += 1;
    } catch (err) {
      failed += 1;
    }
  }
  return { collection, embedded, skipped, failed, scanned: snap.size };
}

/**
 * Nightly-safe step: ensure open stories/tasks have embeddings, for every user.
 * Idempotent + non-destructive (only writes the embedding field). This populates
 * the corpus so the ingest-time clustering (resolveCandidate) has neighbours to
 * match against. The actual attach/merge decision happens at ingest, not here.
 */
async function runEmbeddingBackfillForAllUsers(db, { budgetPerUser = 150 } = {}) {
  const profiles = await db.collection('profiles').get().catch(() => ({ docs: [] }));
  const totals = { users: 0, embedded: 0, skipped: 0, failed: 0 };
  for (const prof of profiles.docs) {
    const uid = prof.id;
    totals.users += 1;
    for (const collection of ['stories', 'tasks']) {
      try {
        const r = await backfillEmbeddings(db, uid, { collection, budget: budgetPerUser });
        totals.embedded += r.embedded; totals.skipped += r.skipped; totals.failed += r.failed;
      } catch (err) {
        totals.failed += 1;
      }
    }
  }
  return totals;
}

module.exports = {
  EMBED_MODEL,
  EMBED_DIM,
  EMBED_FIELD,
  ATTACH_THRESHOLD,
  SUGGEST_THRESHOLD,
  buildEmbedText,
  embedText,
  toVector,
  findNearestOpen,
  resolveCandidate,
  backfillEmbeddings,
  runEmbeddingBackfillForAllUsers,
};
