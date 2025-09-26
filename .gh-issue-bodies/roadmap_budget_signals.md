**Description**
Surface budget status directly in the Goals/Theme roadmap view.

**Acceptance Criteria**
- [ ] Roadmap shows On Track / At Risk / Off Track pill.
- [ ] Filter roadmap by budget status.
- [ ] Tooltip explains calculations.

**Proposed Technical Implementation**
- Extend roadmap queries to join `/finance/plan`.
- UI pill component reused across board and list views.
