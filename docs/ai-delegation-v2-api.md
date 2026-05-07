# AI Delegation v2 API Contract

Last updated: 2026-05-07

## Scope

This document defines the BOB + Hermes delegation contract for:

- native Google Docs output formatting (including tables)
- mandatory executive summary behavior
- review rejection auto-requeue behavior
- snapshot field propagation

## Entity Fields (Story and Task)

Existing delegation fields:

- `flaggedToAi?: boolean`
- `aiDelegationStatus?: 'queued' | 'in_progress' | 'review' | 'failed'`
- `aiDelegationNote?: string`
- `aiDelegatedAt?: number`
- `aiDelegationDocumentLink?: string`

New v2 fields:

- `aiDelegationFeedback?: string`
: Latest reviewer feedback used for regeneration.
- `aiDelegationRevision?: number`
: Delegation version counter. Recommended baseline is `1` for first generated output.
- `aiDelegationPreviousDocumentLink?: string`
: Prior review document link preserved during regeneration.
- `aiDelegationExecutionSummary?: string`
: Concise acceptance-criteria coverage summary.

## Document Output Contract

Every delegated run must produce one review-ready Google Doc.

1. Document title must include story/task ref and description:
   - `ST-12345 — <description>`
   - `TK-12345 — <description>`
2. If regenerated after reject, append version suffix:
   - `... (v2)`, `... (v3)`, etc.
3. Executive Summary section is required in the same document.
4. Markdown table content must be rendered as native Google Docs tables (not ASCII table text).

## Pre-Review Validation Gate

Before transition to `aiDelegationStatus = 'review'`, Hermes must validate:

1. Title contract passes.
2. Executive summary exists.
3. Review document link is present.

If validation fails:

- keep `aiDelegationStatus = 'in_progress'`
- set `aiDelegationNote` with validation failure reason
- write activity note for blocked transition

## Rejection / Requeue Transition

Review rejection is not terminal.

When reviewer clicks **Reject & Requeue**:

1. Feedback is required (`aiDelegationFeedback`).
2. `aiDelegationRevision` increments.
3. `aiDelegationPreviousDocumentLink` captures current `aiDelegationDocumentLink`.
4. `aiDelegationDocumentLink` is cleared for next run.
5. Status returns to `aiDelegationStatus = 'queued'`.

## Activity Stream Milestones

Delegation activity should be milestone-level only:

1. picked up
2. clarification obtained (if used)
3. document generated
4. moved to review
5. rejected + auto-requeued
6. regenerated version ready

Completion entries should include:

- acceptance-criteria coverage summary
- document link
- revision when greater than 1

## Snapshot Field Contract

Both snapshot layers must include v2 fields for stories and tasks:

- BOB server snapshot producer: `functions/globalSnapshot.js`
- Hermes local enricher: `scripts/bob_take_snapshot.py`

Required propagated fields:

- `aiDelegationFeedback`
- `aiDelegationRevision`
- `aiDelegationPreviousDocumentLink`
- `aiDelegationExecutionSummary`

Keep snapshot payload lightweight:

- use summary-level execution text
- retain latest prior doc link + revision + latest feedback

