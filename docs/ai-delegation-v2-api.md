# AI Delegation — contract

Last updated: 2026-08-03

## Scope

One delegation pipeline, two interchangeable engines, a Drive document as the deliverable, and
a rejection loop that rewrites the prompt rather than re-running it.

This supersedes the May 2026 draft of this document, which specified a `'review'` status value,
a `(v2)` title suffix and a pre-review validation gate that were never built. Where the draft
and the code disagreed, the code below is what exists.

It also folds in the old "AI research" feature (`orchestrateGoalPlanning` /
`orchestrateStoryPlanning` with `researchOnly`, surfaced by `ResearchDocModal`). That was a
second, parallel way to get an AI-written document about an entity, with its own model
dropdowns, its own document store, no Drive file and no review step. Delegation now writes both
stores, so there is one list of documents per entity.

## Engines

| Engine | Runs in | Entry point | Availability |
|---|---|---|---|
| `gemini` (default) | Cloud Functions, Vertex | `functions/aiDelegation.js` → `runDelegationCycle` | Always; reachable from China |
| `hermes` | Jim's Mac | `~/.hermes/scripts/run_delegation_cycle.py` | Only while that machine is awake and idle |

Both read the same `flaggedToAi` queue. `aiDelegationEngine` is the router between them:

- `'hermes'` — the cloud cycle skips it, Hermes takes it.
- anything else, **including unset** — the cloud cycle takes it, Hermes skips it.

The unset default is deliberate: every item flagged before the field existed has no value, and
Firestore cannot express "missing OR equals" in one query. Defaulting to the cloud keeps that
backlog moving on the engine that does not depend on a laptop being open.

## Model routing — "best model for the ask"

Resolved from the prompt, not chosen by hand. `classifyDelegationTask` scores the prompt against
four keyword sets and `TIER_MODELS` maps the winner to a model:

| Tier | Trigger | Model |
|---|---|---|
| `simple` | write, draft, email, outline, summarise | `gemini-2.5-flash` |
| `research` | research, find, investigate, identify, latest | `gemini-2.5-pro` |
| `analysis` | analyse, compare, evaluate, strategy, feasibility | `gemini-2.5-pro` |
| `image` | image, diagram, draw, render | *(none — rejected)* |

Ties go to `research`; nothing matching defaults to `analysis`. `aiDelegationType` overrides the
classifier when the user forces a tier in the UI; it must be **absent**, not `'auto'`, for the
classifier to run.

`react-app/src/utils/delegationRouting.ts` mirrors this so the modal can name the model before
queueing. `delegationRouting.test.ts` exists to catch that mirror drifting.

## Fields

| Field | Written by | Meaning |
|---|---|---|
| `flaggedToAi` | UI, pipeline | In the queue. Cleared on completion; re-raised by a rejection. |
| `aiDelegationEngine` | UI, pipeline | `'gemini'` \| `'hermes'`. Routes between engines. |
| `aiDelegationPrompt` | UI, pipeline | The instruction actually sent. After a revision, the rewritten one. |
| `aiDelegationType` | UI | Forced tier. Absent = classify. |
| `aiDelegationStatus` | pipeline, UI | See below. **Never `status`.** |
| `aiDelegationDocumentLink` | pipeline | Drive doc for the current revision. |
| `documentLink` | pipeline | Mirror of the above, so the edit modal shows it. |
| `aiDelegationPreviousDocumentLink` | pipeline | The doc that was rejected. |
| `aiDelegationFeedback` | UI | Rejection commentary. Consumed and cleared by the next run. |
| `aiDelegationRevision` | pipeline | 0 on first output, +1 per revision. |
| `aiDelegationModel`, `aiDelegationTaskType` | pipeline | What actually ran. |

### `aiDelegationStatus`

`queued` → `human_review` → cleared, or → `revision_requested` → `queued` …

`'human_review'` is the canonical review value — the one `types.ts` declares, CLAUDE.md
documents and the UI clears. The UI labels it **Review**; that label is the delegation state,
**not** a `status` lane. Stories and tasks use different status scales and neither has a Review
value: writing `status: 2` reads as In Progress on a story but **closes a task**. The pipeline
never writes `status`.

`functions/agent/delegationWorker.js` accepts `'human_review'` and legacy `'review'`. It
previously matched only `'review'`, which no producer ever wrote — so the notification trigger
had never fired for a real delegation.

## Output contract

Every run produces one Google Doc, filed in the entity's own Drive folder via
`driveHierarchy.ensureEntityFolder` (`BOB-Files/{Theme}/{GR — Goal}/{ST — Story}/…`), not loose
at the root. Title: `{REF} — {Title}`, with ` (rev N)` appended from revision 1 onward.

The same content is mirrored into `research_docs` as an index row carrying `driveDocUrl`,
the prompt used, the model, the engine and the revision. The mirror is best-effort: losing it
must not lose the Drive file that already exists.

`research_docs` is server-write-only and client-read-only — see `firestore.rules`. That rule was
missing entirely, and with no catch-all below it, every client read was denied by default; the
old research modal's document list could never populate whatever the pipeline wrote.

## Rejection loop

1. Reviewer rejects with commentary (required — an empty rejection gives the rewriter nothing,
   and the next run would reproduce the same document).
2. UI writes `aiDelegationFeedback`, `aiDelegationStatus: 'revision_requested'`,
   `flaggedToAi: true`.
3. Next run, `resolveWorkingPrompt` spends **one extra model call** rewriting the research
   prompt from the original prompt + the rejected output + the commentary. The rewritten prompt
   is what gets researched — feeding the criticism into the research call directly produces a
   document that argues with the reviewer instead of answering the revised question.
4. Revisions always run on `gemini-2.5-pro` regardless of tier: a rejection is evidence the
   cheap tier was the wrong call.
5. If the rewrite call fails, the commentary is appended to the original prompt instead. Worse,
   but the revision still incorporates what was asked for.

Hermes folds the commentary into the prompt directly rather than assuming a rewrite model is
reachable — it routes per tier to different local/remote backends.

## Entry points

- `runAiDelegationNow` (callable) — `{ limit?, dryRun?, entityId? }`. `entityId` scopes the run
  to one item, which is what the modal's "run now" uses; without it the whole queue runs and the
  user waits on unrelated documents.
- `runAiDelegationNightly` (scheduled, 02:30 Europe/London) — every user with something flagged.
- `DelegateToAiModal` — the only delegation UI. Reachable from the story and task edit modals
  and from the sidebar's document button.
