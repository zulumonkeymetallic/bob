**Description**
Generate a daily priority summary that includes tasks, overdue items, and scheduled blocks, delivered via email and Telegram.

**Acceptance Criteria**
- [ ] Daily email summarises priorities, overdue tasks, and calendar blocks.
- [ ] Telegram message mirrors the email content.
- [ ] Summaries are generated at a configurable time (default 07:00).
- [ ] Links in summaries open directly to BOB items.

**Proposed Technical Implementation**
- Use Firebase Cloud Scheduler to trigger summary generation.
- Query active sprint tasks + overdue items from Firestore.
- Format into email (SendGrid integration) and Telegram (Bot API).
- Store sent summaries in `/summaries` collection for logging/debugging.
