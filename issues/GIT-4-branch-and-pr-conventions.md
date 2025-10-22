# [GIT-4] Branch and PR conventions

- Labels: epic:AI-scheduling, github-sync

Description
Provide script to open branches named feature/ai-layer/<req-id>-<slug> and create PRs with Conventional Commit subjects including REQ-ID.

Acceptance Criteria
- Script added under scripts/ with usage
- PR templates populated with Epic link

Dependencies
- gh CLI, repo permissions

Test Notes
- Dry run on a couple of REQ-IDs; verify PRs link back to Epic.
