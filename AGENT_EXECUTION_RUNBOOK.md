# BOB Cross-Repo Agent Execution Runbook

Purpose: fast, repeatable build/test/validate/commit guidance for agent work across the three BOB repositories.

## Scope
- Web repo: /Users/jim/GitHub/bob
- iOS repo: /Users/jim/GitHub/bob-ios
- Mac sync repo: /Users/jim/GitHub/bob-mac-sync

## Global Orchestration (Preferred)
Run these from any of the three repos:

```bash
# full deployment
./build all

# target-specific deployment
./build web
./build ios
./build mac

# preview only (no deploy)
./build all --dry-run
./build web --dry-run
./build ios --dry-run
./build mac --dry-run
```

Post-run validation artifact:
- /Users/jim/GitHub/bob/build-logs/manifest.json

This manifest is the source of truth for:
- versions per target
- commits per target
- build durations

## Repo-Specific Minimum Ops

### 1) Web (/Users/jim/GitHub/bob)
Primary build:
```bash
npm run -s build --prefix react-app
```

Primary test/validation:
```bash
npm test --prefix react-app -- --watchAll=false
npm run -s validate:sprints
npm run -s validate:calendar-links -- --serviceAccount=/absolute/path/to/sa.json --uid=<UID> --project=bob20250810
npm run -s validate:budget-guardrail-email
npm run -s validate:modal-link-surfaces
```

Deploy/release:
```bash
firebase deploy --only hosting --project bob20250810
npm run deploy:rules
npm run deploy:indexes
```

Primary logs/output:
- /Users/jim/GitHub/bob/build-logs/manifest.json
- terminal output from npm/firebase commands

### 2) iOS (/Users/jim/GitHub/bob-ios)
Primary build:
```bash
# preferred via orchestrator
./build ios
```

Primary test/validation:
```bash
# preferred via orchestrator dry run
./build ios --dry-run
```

Deploy/release:
```bash
# preferred via orchestrator
./build ios
```

Primary logs/output:
- /Users/jim/GitHub/bob/build-logs/manifest.json (ios section)
- Xcode build/test logs when running repo-local workflows

### 3) Mac Sync (/Users/jim/GitHub/bob-mac-sync)
Primary build:
```bash
# preferred via orchestrator
./build mac
```

Primary test/validation:
```bash
# preferred via orchestrator dry run
./build mac --dry-run
```

Deploy/release:
```bash
# preferred via orchestrator
./build mac
```

Primary logs/output:
- /Users/jim/GitHub/bob/build-logs/manifest.json (mac section)
- /Users/jim/Library/Containers/com.jc1.tech.bob.mac/Data/Library/Logs/RemindersMenuBar

## Branch + PR Conventions
Recommended branch names:
- feature/<area>-<short-purpose>
- fix/<area>-<short-purpose>
- chore/<area>-<short-purpose>

Recommended commit style:
- feat(<area>): ...
- fix(<area>): ...
- chore(<area>): ...

PR checklist:
- include impacted repo(s)
- include commands run
- include validation results and key log excerpts
- include rollback/backout note when changing sync or automation behavior

## Safe Backup Workflow Before Risky Changes
For each touched repo:
```bash
git status
git checkout -b backup/<date>-<topic>
git add -A && git commit -m "chore(backup): checkpoint before <topic>" || true
git checkout -
```

If repo is dirty and backup commit is not desired, stash instead:
```bash
git stash push -u -m "backup before <topic>"
```

## Agent Execution Order (Recommended)
1. Validate clean scope and changed files per repo.
2. Run target-specific validations first.
3. Run orchestrator dry-run.
4. Run orchestrator target build.
5. Check manifest for versions/commits/durations.
6. Capture concise evidence in PR description.
