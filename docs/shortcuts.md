# Siri / Apple Watch Shortcuts

## Authentication
Siri/Shortcuts callers must send a Firebase ID token in the `Authorization` header (`Bearer <ID_TOKEN>`). You can reuse the same ID token used by the web/mobile app or mint one via `scripts/validate-sprints-perf.js` (service account → custom token → Identity Toolkit exchange) and commit it to your Shortcut variables. Keep the token refreshed because Firebase ID tokens expire after ~1 hour.

## Shortcut: "What’s next?"
1. **Get Contents of URL**
   * Method: `GET`
   * URL: `https://bob20250810.web.app/api/priority/now`
   * Headers: `Authorization: Bearer <ID_TOKEN>`
2. **Get Dictionary from Input** (response body)
3. **Show Result** → `displayText`
4. **Speak Text** → `speakText`

This endpoint returns strict JSON with `priorities` (exactly 3 items), `remainingCalendar`, `risks`, and short `displayText`/`speakText` for TTS. Use the captured bearer token to keep the request authenticated.

## Shortcut: "Replan my day"
1. **Ask for Input** (Text, optional) → store as `Reason`
2. **Get Contents of URL**
   * Method: `POST`
   * URL: `https://bob20250810.web.app/api/plan/replan`
   * Headers: `Authorization: Bearer <ID_TOKEN>`, `Content-Type: application/json`
   * Request Body (JSON):
     ```json
     {
       "reason": "${Reason}",
       "constraints": {
         "availableUntil": "2026-01-28T18:00:00Z",
         "focusBlockMinutes": 90
       }
     }
     ```
     * `availableUntil` should be an ISO timestamp in your timezone (defaults to end of day)
     * `focusBlockMinutes` suggests the size of each priority block
3. **Get Dictionary from Input** (response)
4. **Show Result** → `displayText`
5. **Speak Text** → `speakText`

The endpoint reselects three priorities, validates / schedules them for today, updates any task/story due dates, and ensures each priority has a Google Calendar block. Responses also expose `scheduledBlocks` and the exact `calendarOps` that ran.

## Testing & Evidence (for reviewers)
1. Seed the Firestore user with sample tasks/stories: ensure `tasks` contain `dueDate` entries for today/overdue, and `stories` belong to the active sprint.
2. Call `/api/priority/now` with a valid ID token. Confirm:
   * Response body has `priorities` length 3 and non-empty `displayText`/`speakText`.
   * A `daily_priority_runs` document exists for the same day with the LLM output and metadata.
   * An `activity_stream` entry with `activityType == "PRIORITIES_GENERATED"` references the correlation ID.
3. Call `/api/plan/replan` (optionally add a `reason`/`constraints` object). Confirm:
   * Firestore `taskOps`/`storyOps` updates applied (check the affected documents for new due dates/status). 
   * A `priority_calendar_events` doc exists for each priority, linking to a Google event and storing the stable `bobPriority:<day>:<item>` key.
   * Google Calendar shows new/moved events carrying `extendedProperties.private.bobPriorityKey` (verify via Calendar API or sync logs).
   * `replan_runs` contains a record with `status: "applied"` plus `calendarOps`, `taskOps`, `storyOps`, and `priorityEvents` details.
   * `activity_stream` contains `REPLAN_STARTED`, `REPLAN_APPLIED`, and, if applicable, `REPLAN_FAILED` entries with sanitized metadata.
4. Long-running validation: rerun `/api/plan/replan` twice for the same day. Ensure events reuse the existing `priority_calendar_events` mapping instead of duplicating, and each run logs a new `replan_runs` entry.

No new LLM providers were added; both endpoints keep using `callLLMJson` (Gemini) defined in `functions/index.js`.
