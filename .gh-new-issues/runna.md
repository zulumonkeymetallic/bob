**Description**
Import Runna training plans and map sessions to stories/tasks/blocks.

**Acceptance Criteria**
- [ ] Connect account and select plan.
- [ ] Plan sessions create stories/tasks and optional calendar blocks.
- [ ] Changes sync on update; conflicts produce suggestions.

**Proposed Technical Implementation**
- n8n HTTP workflow to fetch plan endpoints; normalize → Function upsert.
- Schema: `/health/runnaPlans`, `/stories`, `/calendar/events` (via scheduler contract).
