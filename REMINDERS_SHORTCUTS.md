# iOS Reminders (Apple Shortcuts) Integration

This document explains how BOB syncs with iOS Reminders using Apple Shortcuts and two HTTP endpoints exposed by Firebase Functions.

## Overview
- BOB exposes two endpoints you can call from an iOS Shortcut:
  - GET/POST `/reminders/push?uid=<USER_ID>` → returns tasks that should exist in Reminders (create/update there)
  - POST `/reminders/pull?uid=<USER_ID>` → send changes from Reminders back to BOB
- Idempotency is handled by either `id` (BOB task id) or `reminderId` (the Reminders task identifier you store on the BOB task upon first create).
- Security: include a header `x-reminders-secret: <SECRET>` matching the secret in Cloud Secret Manager `REMINDERS_WEBHOOK_SECRET`.

## Endpoints

Base URL (prod): `https://bob20250810.web.app`

- Push (get tasks to create/update in Reminders)
  - Method: GET or POST
  - URL: `/reminders/push?uid=<USER_ID>`
  - Headers:
    - `x-reminders-secret: <SECRET>`
  - Response JSON:
    ```json
    {
      "ok": true,
      "tasks": [
        { "id": "<bobTaskId>", "title": "Buy milk", "dueDate": 1736899200000 }
      ]
    }
    ```
  - Semantics: returns BOB tasks that should be present in Reminders (e.g., no `reminderId` set and due soon). Your Shortcut should upsert these into Reminders and remember the created Reminders identifier so it can be sent back in Pull.

- Pull (apply changes from Reminders to BOB)
  - Method: POST
  - URL: `/reminders/pull?uid=<USER_ID>`
  - Headers:
    - `x-reminders-secret: <SECRET>`
    - `Content-Type: application/json`
  - Request JSON:
    ```json
    {
      "tasks": [
        { "id": "<bobTaskId>", "reminderId": "<remindersIdentifier>", "completed": true },
        { "reminderId": "<remindersIdentifierOnly>", "completed": false }
      ]
    }
    ```
  - Response JSON:
    ```json
    { "ok": true, "updated": 2 }
    ```
  - Semantics: BOB will find the task by `id` or by `reminderId` and apply updates; if `completed` is true, the BOB task is marked done.

## Shortcut Flow (example)

1) Push step
- Use `Get Contents of URL` (GET) → `${BASE}/reminders/push?uid=${USER_ID}`
- Headers: `x-reminders-secret: <SECRET>`
- Parse JSON → get `tasks` array
- For each task: create or update Reminders item and store the Reminders identifier (e.g., in a Dictionary mapping BOB id → reminderId in iCloud Drive, or embed in the note field and parse on Pull)

2) Pull step
- Build a JSON array of changes `{ id?, reminderId?, completed? }` from Reminders (e.g., iterate a specific list or all changed items in the last N minutes)
- Use `Get Contents of URL` (POST) → `${BASE}/reminders/pull?uid=${USER_ID}`
- Headers: `x-reminders-secret: <SECRET>`, Content-Type: `application/json`
- Request body: `{ "tasks": [...] }`

## Field Mapping
- BOB task → Reminders
  - `title` → Reminders title
  - `dueDate` (ms) → Reminders due date (optional)
  - `id` ↔ `reminderId` (string) for idempotency
- Reminders → BOB
  - If a Reminders item is completed, send `{ completed: true }` in Pull so BOB marks the task done.

## Notes & Tips
- Run your Shortcut every ~60s via automation (or on specific events) to satisfy near‑real‑time sync.
- Use a dedicated Reminders list (e.g., “BOB”) to keep items separated.
- Store the Reminders identifier back in BOB by calling Pull immediately after create.

## Apple Shortcut JSON (skeleton)
If you prefer importing a Shortcut directly, Settings → “Reminders (Shortcuts)” provides buttons to download minimal Apple Shortcut JSON files for Push and Pull with your UID and secret embedded. Import them in the Shortcuts app, then add the Reminders‑specific steps (e.g., iterate list items) as needed. Note: Apple’s .shortcut format is a binary plist; the JSON we generate is a skeleton compatible with many importers but may need minor tweaks on some iOS versions.

## Notes History (Optional, Recommended)
You can append a lightweight history into the Reminders Notes field from the Shortcut so you have a human‑readable log on device. The server does not edit Notes; this is Shortcut‑side.

- Suggested header (first line when creating a reminder):
  BOB: {ref} | Story {storyRef?} | Goal {goalRef?}

- Append events on create/update/complete as lines, newest first:
  [2025‑09‑14 07:32] Created via Push (due: 2025‑09‑14)
  [2025‑09‑14 21:15] Completed in Reminders
  [2025‑09‑15 08:05] Reopened in Reminders

- Where to get refs:
  - Task: use `ref` or `referenceNumber` if present; otherwise displayRefForEntity(TK, id) on client.
  - Story/Goal: if your Tasks carry `storyId`/`goalId`, you can embed story/goal refs in Notes.

Tip: Keep Notes small and append only the last few rows if you worry about size. This does not affect server sync.

## Server Implementation (for reference)
- `functions/index.js`:
  - `remindersPush`: HTTP onRequest (public). Returns tasks without `reminderId` and due soon.
  - `remindersPull`: HTTP onRequest (public). Upserts `reminderId`, marks tasks complete if `completed: true`.
- Hosting rewrites: `firebase.json` maps `/reminders/push` and `/reminders/pull` to the functions.

## Troubleshooting
- 403 Forbidden: check `x-reminders-secret` header and Secret Manager value.
- Empty `tasks` from push: ensure tasks exist, are owned by the user, and due soon.
- Tasks not updating: verify Pull body contains either `id` or `reminderId`.
