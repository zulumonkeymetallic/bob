Title: Planner · Preview Errors/Warnings surfaced in UI

Description
- Show validation errors/warnings from `validateCalendarBlocks` directly in the planning UI before applying.

Acceptance Criteria
- [ ] Approvals page shows errors/warnings per block (quiet hours, conflicts) with simple badges.
- [ ] Post-apply toast summarizes any warnings.

Technical Plan
- Client: extend `/planning/approval` page to render validator.warnings/errors; add per-block indicators.
- Functions: ensure validator object returned on preview GET.

