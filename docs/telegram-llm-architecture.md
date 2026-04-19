# Telegram + LLM Architecture in BOB

## Overview

BOB integrates Telegram as its primary command, capture, and approval interface. Users send natural-language messages — questions, tasks, journal entries, or voice notes — to a dedicated Telegram bot. Firebase Cloud Functions process those messages, route them through one or more LLM calls, and reply directly in the chat. Proposed data changes are staged as pending approvals and confirmed via Telegram inline keyboards.

This document covers the full end-to-end path: from a user sending a message to a reply arriving in Telegram, including LLM routing, per-provider key resolution, tool dispatch, and the approval workflow.

---

## Files and Responsibilities

| File | Role |
|---|---|
| `functions/agent/telegramWebhook.js` | Firebase `onRequest` handler — main entry point for all Telegram updates |
| `functions/agent/agentTools.js` | Tool dispatcher — 14 tools across three permission tiers |
| `functions/agent/agentContext.js` | 30-minute cached context aggregator (tasks, goals, calendar, sprint, finance) |
| `functions/agent/agentBriefing.js` | Scheduled morning and weekly briefing sender |
| `functions/agent/approvalWorker.js` | Executes approved actions; sweeps expired approvals every 5 minutes |
| `functions/agent/agentAudit.js` | Audit logging and idempotency tracking |
| `functions/transcriptIngestion.js` | `processAgentRequestInternal` — current intent router and transcript processor |
| `functions/index.js` | `callLLMJson` — central LLM dispatcher; handles provider selection and key resolution |

---

## Request Flow

The following describes what happens when a user sends "when is my china trip goal?" to the bot.

```
User (Telegram)
    │
    │  POST /telegramWebhook
    ▼
telegramWebhook.js  (Firebase onRequest)
    │  ① Respond 200 immediately (async processing continues)
    │  ② Look up telegram_sessions/{chatId} → uid
    │  ③ _enrichTranscriptWithIntent(text)
    │
    │  Is it a question?      → pass through as-is
    │  Short noun phrase?     → prefix "Add task:"
    │  Journal-like phrasing? → prefix "Log:"
    │
    ▼
processAgentRequestInternal(enrichedText, uid)   [transcriptIngestion.js]
    │
    │  ④ callAgentRouterModel   — classifies intent
    │     → "task" | "journal" | "question" | "command"
    │
    │  ⑤ callTranscriptModel   — processes content
    │     For questions: reads agent_context_cache/{uid}
    │                    and/or global_hierarchy_snapshots
    │
    ▼
callLLMJson(...)   [index.js]
    │  Resolves provider + model + API key for uid
    │  Calls callGemini / callOpenAIChat / callAnthropic
    │
    ▼
Telegram Bot API
    │  Send reply message to chatId
    ▼
User (Telegram)
```

### Step-by-step detail

**Step 1 — Receive and acknowledge.** `telegramWebhook.js` is an HTTP `onRequest` function. It returns `200 OK` immediately so Telegram does not retry, then continues processing asynchronously.

**Step 2 — Session lookup.** The function reads `telegram_sessions/{chatId}` to find the linked Firebase `uid`. If no session exists, the bot prompts the user to link their account first (see [Account Linking](#account-linking)).

**Step 3 — Intent enrichment.** `_enrichTranscriptWithIntent` applies heuristics before the LLM sees the text:
- Contains a question word or ends with `?` → routed as a question, no prefix added.
- Short phrase, present tense, no past-tense indicators → prefixed with `"Add task:"`.
- Reflective or journal-like language → prefixed with `"Log:"`.

**Step 4 — Router LLM call.** `callAgentRouterModel` sends the enriched text to an LLM to confirm the intent class: `task`, `journal`, `question`, or `command`.

**Step 5 — Transcript LLM call.** `callTranscriptModel` performs the actual work:
- **Questions** — reads `agent_context_cache/{uid}` (30-min TTL: top-3 priorities, today's calendar, overdue count, active sprint, focus goals, finance snapshot) and/or `global_hierarchy_snapshots` (6-hour refresh of the full tasks → stories → goals → sprints hierarchy).
- **Tasks** — enriches the text into a structured task object.
- **Journal** — processes and stores the entry.

Both `callAgentRouterModel` and `callTranscriptModel` go through `callLLMJson` and respect per-feature model configuration.

---

## LLM Routing — `callLLMJson`

All LLM calls in BOB pass through a single dispatcher in `functions/index.js`.

```
callLLMJson({ system, user, purpose, userId, ... })
    │
    ├─ Load profiles/{uid}
    ├─ Check aiFeatureConfig[PURPOSE_TO_FEATURE[purpose]]
    │     → resolves feature name (e.g. "telegram", "journal", "digest")
    ├─ Resolve provider + model
    │     → feature override → default provider → fallback (Gemini)
    ├─ Get API key from aiApiKeys[resolvedProvider]
    │     or legacy aiApiKey field
    ├─ Merge aiSystemPromptOverride into system prompt
    └─ Dispatch to callGemini / callOpenAIChat / callAnthropic
```

### `purpose` to feature mapping

| `purpose` value | Feature key | Typical use |
|---|---|---|
| `agent_query`, `agent_propose_plan` | `telegram` | All Telegram bot interactions |
| `journalProcess`, `transcriptProcess` | `journal` | Journal and voice-note processing |
| `sendMorningBriefing`, `sendWeeklyReview`, `agent_briefing` | `digest` | Scheduled briefings |
| `storyTasks`, `storyResearchDoc`, `deriveFromResearch` | `story` | Story decomposition and research |

---

## Per-Feature and Per-Provider Configuration

Users configure LLM providers in **Settings → AI**.

### Per-feature model overrides (`profiles/{uid}.aiFeatureConfig`)

```json
{
  "telegram":  { "provider": "anthropic", "model": "claude-haiku-3-5" },
  "journal":   { "provider": "gemini",    "model": "gemini-2.5-flash-lite" },
  "digest":    { "provider": "openai",    "model": "gpt-4o" },
  "story":     { "provider": "gemini",    "model": "gemini-2.5-flash" }
}
```

Setting `telegram` to Anthropic means every Telegram-routed LLM call (both the router and the transcript model) uses Claude Haiku 3.5, provided the user has an Anthropic API key stored.

### Per-provider API keys (`profiles/{uid}.aiApiKeys`)

```json
{
  "gemini":    "AIza...",
  "openai":    "sk-...",
  "anthropic": "sk-ant-..."
}
```

`callLLMJson` selects the key that matches whichever provider the feature resolves to. A legacy top-level `aiApiKey` field (Gemini-only) is still supported for backward compatibility.

---

## Telegram Tools (`agentTools.js`)

There are 14 tools grouped into three permission tiers. The tier determines whether an action is immediate or requires user approval.

### Read-only tools (no approval, no write)

| Tool | Description |
|---|---|
| `get_today_context` | Returns today's priorities, calendar, and overdue count |
| `get_priorities` | Returns current top-3 AI-ranked priorities |
| `get_focus_goals` | Returns active focus goals |
| `get_weekly_review` | Returns weekly review summary |
| `get_agent_permissions` | Returns what the agent is allowed to do for this user |

### Auto-write tools (immediate, no approval)

| Tool | Description |
|---|---|
| `capture_task` | Creates a new task directly |
| `capture_journal` | Stores a journal entry |
| `capture_story` | Creates a new story |
| `record_agent_execution_result` | Logs the outcome of an agent action |

### Approval-required tools (inline keyboard confirmation)

| Tool | Description |
|---|---|
| `propose_task_triage` | Proposes changes to task priority, due date, or status |
| `propose_reschedule` | Proposes rescheduling tasks or calendar blocks |
| `submit_schedule_change_for_approval` | Stages a schedule mutation for user sign-off |
| `apply_approved_actions` | Executes a previously approved action set |

---

## Approval Workflow

Approval-required actions are never written directly to Firestore. Instead they go through a staging and confirmation loop.

```
Agent proposes change
    │
    ▼
pending_approvals/{id}  (15-min TTL, Firestore)
    │
    ▼
Telegram inline keyboard sent to user
    ┌──────────────────────┐
    │  ✅ Approve  ❌ Reject │
    └──────────────────────┘
    │
    ├─ User taps Approve
    │     → _handleApprovalCallback  (telegramWebhook.js)
    │     → executeApprovedActions   (approvalWorker.js)
    │     → writes to Firestore
    │     → edits Telegram message: "✅ Applied"
    │
    └─ User taps Reject  (or 15 min elapses)
          → sweepExpiredApprovals runs every 5 min
          → marks document expired
          → edits Telegram message: buttons removed
```

`sweepExpiredApprovals` in `approvalWorker.js` runs on a 5-minute Cloud Scheduler trigger. It finds all `pending_approvals` documents past their TTL, marks them expired, and edits the original Telegram message to remove the inline keyboard so the user cannot act on a stale proposal.

---

## Context Available for Answering Questions

When the agent needs to answer a factual question (e.g. "when is my china trip goal?"), it reads from two Firestore caches rather than making live queries across every collection.

### `agent_context_cache/{uid}` — 30-minute TTL

Populated by `agentContext.js`. Contains:
- Top-3 AI-ranked priorities for today
- Today's calendar blocks
- Overdue task count
- Active sprint summary
- Current focus goals
- Finance snapshot (recent spend, balance)

### `global_hierarchy_snapshots` — 6-hour refresh

A denormalized snapshot of the full hierarchy:

```
Goals
  └── Stories
        └── Tasks
Sprints
  └── Stories / Tasks
```

Used when a question requires deeper context than the 30-minute cache provides (e.g. looking up a specific goal or story that is not in the top-3 today).

---

## Voice Notes

```
User sends voice message
    │
    ▼
_handleVoiceMessage  (telegramWebhook.js)
    │  Downloads OGG/Opus file from Telegram API
    │
    ▼
_transcribeAudio
    │  Sends audio as base64 inlineData to Gemini 1.5 Flash
    │  NOTE: Audio transcription always uses Gemini 1.5 Flash.
    │        This cannot be overridden by aiFeatureConfig.
    │
    ▼
Transcribed text echoed back to user in chat
    │
    ▼
processAgentRequestInternal(transcribedText, uid)
    │  Processed identically to a typed message from here onward
```

The hard dependency on Gemini for audio is a current implementation constraint. All downstream processing after transcription respects the normal per-feature provider configuration.

---

## Account Linking

Before a Telegram chat can be used with BOB, the user must link their Telegram account to their BOB Firebase identity.

```
Settings → Integrations → Telegram
    │  Click "Generate link code"
    │
    ▼
linkTelegramAccount  (Firebase Callable Function)
    │  Writes 10-min TTL code to profiles/{uid}.telegramLinkCode
    │
    ▼
User sends /start <code> to the bot
    │
    ▼
telegramWebhook.js validates code against profiles/{uid}.telegramLinkCode
    │  Creates telegram_sessions/{chatId} = { uid, linkedAt }
    │
    ▼
Bot confirms: "Your account is now linked."
```

All subsequent messages from `chatId` are resolved to that `uid` via the session document.

---

## Scheduled Briefings (`agentBriefing.js`)

Two briefings are delivered automatically via Cloud Scheduler triggers, not via incoming Telegram messages.

| Briefing | Purpose | LLM feature key |
|---|---|---|
| Morning briefing | Today's priorities, overdue items, calendar overview | `digest` |
| Weekly review | Progress summary, goal status, upcoming week | `digest` |

Both are sent proactively to the user's linked Telegram chat using the stored `chatId` from `telegram_sessions`.

---

## Audit Logging (`agentAudit.js`)

Every agent action is recorded for debugging and idempotency. The audit log:
- Tracks which tool was called, with what arguments, and what the result was.
- Prevents double-execution if a webhook is delivered more than once (Telegram guarantees at-least-once delivery).
- Provides a trail for the user to understand what the bot did on their behalf.

---

## Known Limitations and Planned Work

### `processAgentRequestInternal` is partially hardcoded to Gemini

The router model (`callAgentRouterModel`) and transcript model (`callTranscriptModel`) inside `transcriptIngestion.js` currently default to Gemini regardless of the user's `aiFeatureConfig.telegram` setting. Overrides configured via `callLLMJson` do apply to subsequent calls, but the initial routing step always uses Gemini.

Full provider routing for the initial router + transcript step is pending a refactor of `transcriptIngestion.js`.

### Claude agent loop not yet implemented

The planned architecture replaces the heuristic intent classification (`_enrichTranscriptWithIntent`) and the two-shot router+transcript pattern with a single Claude Haiku tool-use loop. In this model, the agent would:
1. Receive the user message.
2. Reason about which tools to call.
3. Execute tools in sequence, reading context as needed.
4. Compose a final reply.

This would eliminate the hardcoded Gemini dependency and make the routing model fully configurable. It is planned but not yet implemented.

---

## Summary: Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Telegram                             │
│   User message ──────────────────────────────▶ Bot reply   │
└────────────────────────┬────────────────────────────────────┘
                         │ POST /telegramWebhook
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  telegramWebhook.js                         │
│  • Session lookup (telegram_sessions/{chatId} → uid)        │
│  • Intent enrichment heuristics                             │
│  • Voice note transcription (Gemini 1.5 Flash, always)      │
│  • Approval callback handling (_handleApprovalCallback)      │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              processAgentRequestInternal                    │
│                  (transcriptIngestion.js)                   │
│  • callAgentRouterModel  → intent classification            │
│  • callTranscriptModel   → content processing               │
│  Both route through callLLMJson                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                     callLLMJson                             │
│                      (index.js)                             │
│  profiles/{uid}                                             │
│    .aiFeatureConfig → feature → provider + model            │
│    .aiApiKeys       → API key for resolved provider         │
│    .aiSystemPromptOverride → merged into system prompt      │
│                                                             │
│  ┌──────────┐  ┌───────────────┐  ┌────────────────────┐  │
│  │callGemini│  │callOpenAIChat │  │  callAnthropic     │  │
│  └──────────┘  └───────────────┘  └────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                         │
           ┌─────────────┴──────────────┐
           ▼                            ▼
┌──────────────────┐       ┌────────────────────────────┐
│ agent_context_   │       │  global_hierarchy_          │
│ cache/{uid}      │       │  snapshots                  │
│ (30-min TTL)     │       │  (6-hour refresh)           │
└──────────────────┘       └────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│                    agentTools.js                            │
│  READ-ONLY        → answer directly                         │
│  AUTO-WRITE       → write to Firestore immediately          │
│  APPROVAL-REQUIRED → create pending_approvals/{id}          │
│                      send inline keyboard via Telegram       │
└─────────────────────────────────────────────────────────────┘
```
