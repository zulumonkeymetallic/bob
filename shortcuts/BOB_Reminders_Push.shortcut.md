# Shortcut: BOB Reminders – Push (Create/Update in Reminders)

Purpose: Fetch BOB tasks that should exist in Reminders and upsert them locally. Adds an optional Notes header and history.

Prereqs
- Base: https://bob20250810.web.app
- Endpoint: /reminders/push?uid=<USER_ID>
- Header: x-reminders-secret: <SECRET>

Inputs (Shortcut Ask For Input or Dictionary)
- base: https://bob20250810.web.app
- uid: <YOUR_USER_ID>
- secret: <YOUR_SECRET>
- remindersList: BOB

Steps
1. Get Contents of URL (GET)
   - URL: ${base}/reminders/push?uid=${uid}
   - Headers: x-reminders-secret: ${secret}
2. Get Dictionary from Result → tasks
3. Repeat with Each Item in tasks as t
   3.1 Set title = t.title
   3.2 If t.dueDate is not empty → Set due = Date(t.dueDate)
   3.3 Find existing reminder in list ${remindersList} matching BOB id (store mapping in a persistent Dictionary file or in the reminder Notes header line)
   3.4 If not found → Create Reminder
       - Title: ${title}
       - List: ${remindersList}
       - Due Date: ${due} (if provided)
       - Notes (initial):
         BOB: ${t.ref || t.id}
         [${Current Date}] Created via Push (due: ${due})
   3.5 Else found → Update Reminder fields
       - Title: ${title}
       - Due: ${due}
       - Prepend to Notes: [${Current Date}] Updated via Push (due: ${due})
   3.6 Save the Reminders identifier to your mapping (Dictionary file) keyed by BOB task id

Notes
- You can embed story/goal refs by fetching them from your app or sending them in Push; default server payload returns id/title/dueDate.
- Keep Notes concise if you plan to log many updates.

