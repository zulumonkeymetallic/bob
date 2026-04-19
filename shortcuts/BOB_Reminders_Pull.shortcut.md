# Shortcut: BOB Reminders – Pull (Send changes back to BOB)

Purpose: Scan a Reminders list for completions/changes and POST them to BOB so tasks are updated.

Prereqs
- Base: https://bob20250810.web.app
- Endpoint: /reminders/pull?uid=<USER_ID>
- Header: x-reminders-secret: <SECRET>

Inputs
- base: https://bob20250810.web.app
- uid: <YOUR_USER_ID>
- secret: <YOUR_SECRET>
- remindersList: BOB

Steps
1. Find reminders in list ${remindersList} modified in the last N minutes (or all, if preferred)
2. For each reminder r:
   - Parse first Notes line to get BOB id/ref if present (e.g., line starting with "BOB:")
   - Determine completed = r.isCompleted
   - Build an object:
     {
       id: <bobTaskId if known>,
       reminderId: r.identifier,
       completed: completed
     }
   - Optionally: prepend to r.Notes a line like: [${Current Date}] Completed in Reminders
3. Build JSON body: { tasks: [ … ] }
4. Get Contents of URL (POST)
   - URL: ${base}/reminders/pull?uid=${uid}
   - Headers: x-reminders-secret: ${secret}, Content-Type: application/json
   - Request Body: (JSON) from step 3

Notes
- If you don’t persist the mapping, you can rely on reminderId only; server will look up by reminderId.
- If you want to support reopen, send completed: false when you detect it in Reminders.

