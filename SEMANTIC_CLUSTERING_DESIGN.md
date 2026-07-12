# Semantic clustering & dedup for the capture pipeline — design note

_2026-07-07 · for review before implementation. Lives server-side in `functions/` so every edge (iOS `ingestTranscript`, Hermes `ingestTranscriptHttp`, and the nightly chain) gets it for free._

## Problem

Today's pipeline dedupes only on: exact fingerprint (same transcript), normalised-**string** title equality (`deduplicateUserTasks`), and Levenshtein + keyword fuzzy linking. None is semantic — so *"build a strength base"* and *"get fitter for the triathlon"* create **two separate stories** and are never linked. We need clustering by **meaning**, applied as part of processing, across **all sources and devices** (they already share one processor + one Firestore pool).

## Approach — Firestore native vector search (no new infra)

Firestore (the SDK already in BOB) supports vector fields + `findNearest` KNN. So:

1. **Embed** each story/task's `title + description[:500]` with **Vertex AI `text-embedding-005`** (768-dim). BOB already has Vertex wired (`europe-west2`); cost is negligible (fractions of a cent per item).
2. **Store** the embedding as a Firestore `FieldValue.vector([...])` on the doc — new field `titleEmbedding` on `stories` and `tasks`. Add a **vector index** per collection (`firestore.indexes.json`, `COSINE`).
3. **Query** with `collection.findNearest('titleEmbedding', queryVector, {limit: 5, distanceMeasure: 'COSINE', distanceResultField: '_dist'})`, scoped to the owner and open items.

## Where it runs (two moments, one machinery)

**A. At ingest** — inside `processAgentRequest`, *before* creating each extracted story/task:
- embed the candidate → `findNearest` against existing open stories/tasks for that user
- decide by the top match's cosine similarity (see thresholds)
- create net-new (and store its embedding) OR attach/skip

**B. Nightly reconcile** — a new step in `runNightlyChainCore` (after `runAutoPointing`, before linking): re-cluster items created in the last 24–48h against each other + corpus. This catches the *"two new related notes arrived minutes apart"* case that ingest-time can't (neither existed when the other was processed). Same embed + `findNearest`.

## Decision rules (tunable constants)

Embeddings need higher thresholds than the Levenshtein tiers:

```
cosine ≥ 0.90   → AUTO: don't create a duplicate.
                  • new TASK near existing STORY → attach (set storyId), link, activity 'semantic_attached'
                  • new STORY near existing STORY → append as note/acceptance criterion on the
                    canonical, activity 'semantic_merged'; do NOT create a second story
0.82 ≤ s < 0.90 → SUGGEST: create the item but write a potential_duplicates / suggestion doc
                  (mirrors deduplicateUserTasks) + activity 'semantic_link_suggested'; Jim confirms
s < 0.82        → NET-NEW: create normally, store embedding for future clustering
```
- **Never auto-delete or auto-close existing items.** Only *new* items attach/merge; canonical is always the older/open one (reuse `deduplicateUserTasks`' canonical-selection sort).
- **AI never sets status 3 (Done).** Merges annotate; they don't complete.

## Backfill

One-off callable `backfillEmbeddings` (batched, rate-limited, idempotent — skip docs that already have `titleEmbedding`) to embed all existing **open** stories/tasks so `findNearest` has a populated corpus from day one. Run once after deploy.

## Guardrails

- Per-owner scoping on every query (`ownerUid ==`).
- Skip `chore`/`routine`/`habit` types (same exclusion as auto-pointing).
- Budget: cap embeddings per ingest (the items in one transcript) and per nightly run.
- **Fail-soft:** if the embedding call errors, fall back to today's string dedup — clustering must never block ingestion.
- Every attach/merge/suggest writes an `activity_stream` entry (`actor: 'AI_Agent'`).
- Idempotency preserved: fingerprint check still runs first, so re-ingest is still a no-op before any embedding work.

## Deliverables / files

1. `functions/semanticClustering.js` — `embedText()`, `findNearestOpen()`, `resolveCandidate()` (the decision rules).
2. Wire into `functions/transcriptIngestion.js` (`processAgentRequest`, pre-create).
3. New nightly step in `functions/nightlyOrchestration.js` (`runNightlyChainCore`).
4. `firestore.indexes.json` — two `COSINE` vector indexes.
5. `backfillEmbeddings` callable + a one-shot run.

## Open questions for Jim

- **Thresholds** — start at 0.90 / 0.82 and tune on real data? (Recommend yes.)
- **Story-merge behaviour** — on a ≥0.90 story match, do you want the new content *appended to the existing story* (recommended, non-destructive), or just *flagged as a suggestion* even at high confidence (more conservative)?
- **Embedding model** — Vertex `text-embedding-005` (recommended, already wired) vs Gemini embeddings?
