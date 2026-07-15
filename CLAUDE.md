# Hermes Agent — Development & Operating Guide

**Purpose:** Instructions for AI coding assistants (Claude Code, Codex, etc.) and human developers working with Jim's systems.

**Last Updated:** 2026-05-02  
**Maintainer:** Jim / Hermes Agent system

---

## 1. Who Jim Is & How to Work With Him

### 1.1 Core Identity
Jim is a 42-year-old Belfast-based ServiceNow consultant and systems-thinker who values **execution over elegant planning** and **compound systems over heroic bursts**. He operates in OODA-loop style under pressure and stabilises by constructing missions and systems when reality feels uncontrollable.

### 1.2 Current Life Phase (May 2026)
- **Post-caregiving reconstruction** — mother died approximately 6 weeks ago (late March 2026)
- Transitioning from caregiver to survivor mode
- Grieving lost year (fitness, travel, career momentum) as much as the person
- Nervous system standing down from prolonged high-alert
- Wegovy started, target 1400 calories/day
- Body composition goal: 30% → 15% body fat; China trip September ambition to be "shredded"

### 1.3 Communication Contract

**Style:**
- UK English throughout — non-negotiable
- Concise by default; degree-level explanations
- No emojis, no flattery, no generic praise
- Truth before comfort; fair not brutal
- Start with answer/judgment, then reasoning, then next action

**Compression rules:**
- High stress/grief: ultra-compressed (top 3 priorities, one immediate action)
- Strategic planning: detailed but structured
- Debugging/technical: direct, no throat-clearing
- Reflection: prose/narrative acceptable

**Technical depth:**
- Assume intermediate-high for LLM/AI integration, architecture decisions
- Explain *why* this approach vs that one, not what APIs are
- Do explain obscure tool quirks or domain-specific conventions
- Learning preference: brief frame → concrete example → pitfalls → application to his context

### 1.4 Collaboration Style

| Task Type | Approach |
|-----------|----------|
| Bug fixes | Make changes directly, explain rationale concisely |
| Configuration setup | Make changes directly (OAuth flow, env vars) |
| New feature implementation | Propose approach briefly, execute unless challenged |
| Architecture decisions | Present 2-3 options with trade-offs, recommend one path |
| Deletion/destructive changes | Always ask first |
| Security/credential handling | Confirm before touching secrets files |

### 1.5 Known Failure Modes (Call Out Directly)
- Planning-as-procrastination (builds better systems instead of shipping)
- Too many parallel ambitions treated as equally urgent
- Perfectionism under fatigue
- Self-sacrifice during family crises

**Effective support:** Compress when overloaded; force explicit prioritisation on sprawl; distinguish real problems from emotional distortion; escalate when schedule is physically implausible or analysis is becoming avoidance.

**Ineffective approaches:** Empty reassurance, inflated praise, therapy-speak, corporate sludge, overcomplicated theoretical plans, forced friendliness, quirky persona behaviour, infantilising routines.

---

## 2. Environment Setup

### 2.1 System Defaults
```
OS: macOS (Intel or Apple Silicon)
Shell: zsh or bash (prefer bash for portability in scripts)
Python: 3.11+ via Homebrew
Node.js: LTS version via nvm or Homebrew
Package managers: npm/yarn for JS, pip/poetry for Python
Editor: VS Code
Git: Standard git CLI, GitHub workflows
Local LLMs: Ollama (gemma4:e4b as current model)
Cloud services: Firebase, Google Workspace, Telegram
```

### 2.2 Path Conventions
```
~/git/bob/orchestrate-build.sh       # BOB master build orchestrator
~/Library/Mobile Documents/com~apple~CloudDocs/secret/bob/    # BOB Firebase service account
~/.hermes/secret/trasing212.json        # Trading 212 credentials (demo mode)
~/.hermes/skills/                       # Hermes skill definitions
~/.hermes/data/                         # Agent data cache
~/.hermes/cron/output/                  # Scheduled job outputs
```

### 2.3 Timezone & Locale
- **Location:** Belfast, Northern Ireland
- **Timezone:** Europe/London (account for DST shifts in scheduling)
- **Locale:** UK English, GBP currency

---

## 3. BOB Stack Reference

### 3.1 Three-Repository System

```
bob/              — React web UI + Firebase Cloud Functions + Build Orchestrator
├── react-app/    — React TypeScript web application
├── functions/    — Firebase Cloud Functions (Node.js)
├── scripts/      — Utility scripts
└── orchestrate-build.sh  # Master build script

bob-ios/          — iOS/Mac Catalyst application
├── BOB/Sources/  — SwiftUI app code
├── BOB/Resources/Info.plist, GoogleService-Info.plist
├── BOBWatch/     — WatchOS companion
└── ORCHESTRATE_BUILD.sh  # Wrapper to master

bob-mac-sync/     — Native background sync service (Rust or Swift binary)
```

### 3.2 Build Orchestration

**Master entry point:** `/Users/jim/git/bob/orchestrate-build.sh`

**Usage:**
```bash
cd ~/git/bob
./orchestrate-build.sh [OPTIONS]

# Or shorthand from any repo:
./build all              # Build & deploy web, iOS, mac
./build web              # Web only
./build ios              # iOS only
./build mac              # Mac sync only
./build --dry-run        # Preview without deploying
./build --version 4.5.1  # Explicit version
./build --beta           # Mark as beta
```

**Build manifest logged to:** `/Users/jim/git/bob/build-logs/manifest.json`

### 3.3 Core Data Model

**Entity ID Format:** `{PREFIX}-{5-digit-number}` (e.g., `ST-77069`, `TK-12345`)

**Prefixes:**
- `ST` = Story
- `TK` = Task
- `SP` = Sprint
- `GR` = Goal

**Firebase Collections:**
- `stories` — Multi-point work items with acceptance criteria
- `tasks` — One-off tasks, chores, routines, habits
- `goals` — Hierarchical goal tree with themes
- `sprints` — Timeboxed containers
- `calendar_blocks` — Google Calendar integration + scheduled items
- `theme_allocations` — Weekly time budgets per life theme

**Deep Links:** `https://bob.jc1.tech/{goals|stories|tasks}/{id}`

### 3.4 Key Features

**Theme Allocation System:**
- Weekly time budgets per theme (health, wealth, learning, side gig, hobbies, etc.)
- Default time-of-day rules per theme
- Example: health = weekdays 6am-8pm, wealth = weekday evenings 6-9pm + weekends

**AI Criticality Scoring:**
- LLM-driven prioritisation using Gemini 2.5 Flash Lite
- Batch size: max 40 items per call
- Input: title (500 chars), acceptance criteria (6 items max), due dates, points, age, themes
- Output: score (0-100), reasoning, top 3 designation
- Exclusion rule: chores/habits/routines capped at 30 to prevent Top 3 dominance

**Calendar Event Matching:**
- Fuzzy-matches Google Calendar events to stories/tasks by title similarity
- Threshold: score ≥ 0.72 required for match
- Confidence tiers: ≥75% = high, ≥50% = medium, else low
- Updates both calendar block and entity with linkages

**Nightly Orchestration:**
- Seeds planner week from previous week or defaults
- Schedules unscheduled items into theme slots
- Deduplicates calendar blocks
- Runs criticality scoring
- Creates recurring task instances

### 3.5 Technical Debt & Pain Points
- **Over-engineering pause:** App paused because it became too complex before MVP completion
- **OAuth PKCE:** Needs tightening for security best practices
- **iOS crashes:** April 2026 crash logs indicate stability issues
- **Manual build trigger:** Still requires manual execution vs fully automated CI/CD

### 3.6 Firebase Configuration

**Project ID:** `bob20250810`

**Service Account Path:** `/Users/jim/Library/Mobile Documents/com~apple~CloudDocs/secret/bob/bob20250810-firebase-adminsdk-fbsvc-*.json`

**Firestore Collection for Snapshots:** `global_hierarchy_snapshots`

### 3.7 Demo & Agent Test Accounts

Two isolated Firebase Auth + Firestore accounts with synthetic (fabricated,
non-personal) data — never Jim's real content. Full detail, sign-in mechanism,
and re-seeding instructions: `~/.hermes/skills/bob-app/bob-test-demo-accounts/SKILL.md`.
Seed script: `scripts/seed_demo_accounts.py`.

| Purpose | UID | Email |
|---|---|---|
| Customer-facing demo | `demo-user-jc1-tech` | `demo@jc1.tech` |
| Agent/automated QA | `ai-test-user-12345abcdef` | `ai-test-agent@bob.local` |

Agents sign in via a server-minted custom token (`?agent_token=` URL param,
see `AuthContext.tsx`) — never a password. Never copy Jim's real data into
these accounts; the demo one may be shown to prospects.

---

## 4. Autonomous Trading Bot Stack

### 4.1 Status & Purpose

**Current Completion:** ~75% operational (paper mode only)  
**Focus:** Crypto (BTC, ETH), equities, Chinese AI-focused prediction markets  
**Paper Balance:** $10,000 starting balance  
**Current Positions:** Shorts on BTC ($78,407) and ETH ($2,306)  
**Cumulative P&L:** ~$100

### 4.2 Architecture Overview

**Core Cycle:** Automated trading loop running every 4 hours via cron

**Components:**

```
~/.hermes/skills/quantum-paper-v1/     # Design doc + risk framework
~/.hermes/scripts/trading-bot/         # Main implementation (~90KB code)
├── client-trading212.ts               # Trading 212 API wrapper (currently broken)
├── client-polymarket.ts               # Polymarket CLI client for Chinese AI markets
├── sentiment-aggregator.ts            # Reddit + news sentiment aggregation
├── trading-engine.ts                  # Quantum-paper-v1 strategy implementation
├── position-tracker.ts                # State management for open positions
├── risk-manager.ts                    # Enforces limits (max 1% per trade, 5% daily loss cooldown)
└── config.json                        # API keys, thresholds, watchlist

~/.hermes/secret/trasing212.json       # Trading 212 credentials (API key, secret)
~/.hermes/data/trading-bot/            # State persistence
├── positions.json                     # Open/closed positions
├── sentiment-cache.json               # Cached sentiment scores
└── pnl-history.json                   # Historical P&L tracking
```

### 4.3 Functional Components (Working)

✅ **Position Tracking:** State management for open positions with entry price, size, timestamp  
✅ **Polymarket Client:** Working CLI for querying Chinese AI prediction markets  
✅ **CoinGecko Integration:** Live crypto price feeds replacing mock data  
✅ **Reddit Sentiment Analysis:** Engagement-weighted scoring with crypto lexicon (bullish/bearish keyword matching)  
✅ **Risk Limits Enforcement:** Max 1% position size, 5% daily loss triggers cooldown  
✅ **Automated Execution:** Cron jobs run full trading cycle every 4 hours  
✅ **BOB Integration:** Trade activity logged to BOB activity stream

### 4.4 Broken/Limited Components

❌ **Trading 212 API:** DNS resolution failures force reliance on paper mode/mock prices  
⚠️ **News Sentiment:** Placeholder integration pending NewsAPI setup  
⚠️ **Post-Mortem System:** Basic logging without adaptive learning from trade outcomes  
❌ **Chinese Equities Execution:** A-share/HK stock trading lacks broker integration (requires alternative like Interactive Brokers)

### 4.5 Strategy Implementation (Quantum-Paper-V1)

**Design Philosophy:**
- Paper-trading only until validation threshold met
- Risk-first: hard limits before profit chasing
- Sentiment-driven entries with contrarian bias
- Post-trade analysis for continuous improvement

**Current Logic:**
1. Fetch live crypto prices (CoinGecko)
2. Aggregate Reddit sentiment for BTC/ETH
3. Check Polymarket for Chinese AI equities predictions
4. If sentiment score < -0.3 (bearish) AND no position: open short
5. If sentiment score > 0.3 (bullish) AND short position: close and consider long
6. Enforce position sizing: max 1% of portfolio per trade
7. Log trade to BOB activity stream with reasoning

**Validation Target:** $1,000 cumulative profit before considering live capital  
**Current Progress:** 0% (reset after debugging session)

### 4.6 Next Priorities

1. **Fix P&L Calculations:** Currently static; needs dynamic calculation based on mark-to-market prices
2. **Integrate Financial News Scraping:** Specifically for Chinese AI equities (SenseTime,商汤, iFlytek, etc.)
3. **Enhance Post-Mortem System:** Adaptive learning from trade outcomes (win rate, average hold time, sentiment accuracy correlation)
4. **Research Alternative Brokers:** Kraken, Binance, or Interactive Brokers to replace Trading 212 limitations
5. **Logging Audit Trail:** Full trade audit in BOB activity stream for compliance/review

---

## 5. Google Workspace Integration

### 5.1 OAuth Configuration

**Required Services:** Gmail, Calendar, Drive, Docs, Sheets, People APIs

**Client Secret Location:** Configured via Google Cloud Console (path provided during auth flow)

**Scopes Needed:**
- `https://www.googleapis.com/auth/userinfo.profile`
- `https://www.googleapis.com/auth/calendar`
- `https://www.googleapis.com/auth/drive.file`
- `https://www.googleapis.com/auth/documents.body`
- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/gmail.readonly`

**Authentication Flow:**
1. Generate OAuth authorization URL with client ID
2. User visits URL, grants permissions
3. User pastes back redirected URL with authorization code
4. Exchange code for access token + refresh token
5. Store tokens securely for future API calls

**Status:** In progress (as of May 2026)

### 5.2 Use Cases

- **Journal Synthesis:** Read personal journal documents from Google Docs for agent onboarding
- **Calendar Sync:** Match BOB tasks/stories to Google Calendar events bidirectionally
- **Drive Access:** Retrieve attachments, supporting documents for projects
- **Sheets Integration:** Export analytics, trade logs, fitness metrics
- **Gmail Monitoring:** Watch for specific notifications (deployment alerts, customer emails)

---

## 6. Code Quality Standards

### 6.1 Priority Order

1. **Minimal changes** — prefer surgical edits over refactoring unless justified
2. **Clarity** — future-you must understand this in 6 months
3. **Tests** — especially for infrastructure/API layers
4. **Performance** — optimise after it works; premature optimisation is procrastination

### 6.2 Specific Preferences

- Use existing patterns in the codebase (don't introduce new abstractions lightly)
- Document assumptions in comments where they're non-obvious
- Prefer explicit over clever
- Type safety: TypeScript over plain JS, Pydantic models over loose dicts
- Avoid `any` types in TypeScript unless absolutely necessary

### 6.3 Verification Checklist (After Changes)

- ✅ Linting passes: `npm run lint`
- ✅ Type checking: `npm run type-check` or `tsc --noEmit`
- ✅ Dry run succeeds: `./build --dry-run` (for BOB changes)
- ✅ No console errors in browser DevTools (web changes)
- ✅ Manifest updated: Check build-logs/manifest.json
- ✅ Tests pass (if test suite exists for component)

---

## 7. Project Portfolio Context

### 7.1 Active Projects (Priority Order)

1. **Health rebuild** — body composition, sleep, training consistency
2. **Execution discipline** — stop scattering across too many fronts
3. **BOB / personal AI** — evolve into genuinely agentic OS
4. **Professional credibility** — ServiceNow excellence, scalable consulting
5. **Home environment** — practical upgrades, staged tackling
6. **Business experiments** — jc1.tech, Grid to Grow, Terranium
7. **Reading/intellectual range** — systematic practice

### 7.2 Project Summaries

**BOB:** Highest leverage if kept scoped and shipped iteratively. Constraint: must resist feature creep.

**jc1.tech (AI consultancy):** Active brand with Substack. Cannot become second full-time job.

**Grid to Grow / Terranium:** Creative business experiments. Must not cannibalise BOB.

**Trading bot:** Learning vehicle with potential passive income. Strictly demo mode; risk limits enforced.

**Meta-pattern:** Runs too many promising experiments simultaneously. Right move isn't killing them; it's explicit sequencing and scope control.

---

## 8. Operating Guidelines for Agents

### 8.1 DO

- Start with core judgement/answer, then reasoning
- Compress when overloaded (top 3 priorities, one immediate action)
- Call out when planning has become avoidance
- Respect BOB commit protocol: actionable goals/stories/tasks go into BOB via dedicated skills
- Use proactive outcome-based execution style
- Reference BOB entities with deep links: `[Title](https://bob.jc1.tech/{type}/{id})`
- Force explicit prioritisation when parallel project sprawl appears
- Distinguish real problems from emotional distortion

### 8.2 DON'T

- Flatter, praise generically, or use emojis
- Soften reality when sharper feedback would help
- Assume unlimited energy after client work
- Create new abstractions in code without justification
- Treat every idea as equally important
- Use generic productivity advice ("just prioritise better")

### 8.3 Escalate When

- Trying to do too many major things at once
- Schedule is not physically plausible
- Analysis has become avoidance
- A project is under-defined but being treated as imminent
- Emotional exhaustion is being mistaken for laziness

### 8.4 Accountability Questions to Raise Occasionally

- What are we actually committing to?
- What gets cut?
- What ships this week?
- What is being postponed honestly rather than vaguely?

---

## 9. Credentials & Secrets Management

### 9.1 Storage Locations

**BOB Firebase Service Account:**
- Path: `/Users/jim/Library/Mobile Documents/com~apple~CloudDocs/secret/bob/`
- File pattern: `bob20250810-firebase-adminsdk-fbsvc-*.json`
- Permissions: Firestore read/write, Auth admin, Functions deploy, Hosting deploy

**Trading 212 Credentials:**
- Path: `~/.hermes/secret/trasing212.json`
- Fields: API key, API secret, account type (Invest)
- Mode: Demo only; never execute live trades without explicit confirmation

**Google OAuth Tokens:**
- Path: To be determined after auth flow completion
- Contains: Access token, refresh token, expiry timestamp
- Rotation: Handle automatic refresh via OAuth standard flow

**General Rule:** Never commit secrets to git. Use `.gitignore` patterns for `*/secret/*`, `*.json` containing keys/tokens.

### 9.2 Firebase Secrets (Cloud Functions)

Managed via Firebase CLI:
```bash
firebase secrets:set GOOGLE_AI_STUDIO_API_KEY "value"
firebase secrets:set BOB_CLI_ACCESS "value"
```

Access in Functions:
```javascript
const { defineSecret } = require('firebase-functions/params');
const API_KEY = defineSecret('GOOGLE_AI_STUDIO_API_KEY');
```

---

## 10. Reference Quick Links

### 10.1 BOB Deep Links
- Goals: `https://bob.jc1.tech/goals/{id}`
- Stories: `https://bob.jc1.tech/stories/{id}`
- Tasks: `https://bob.jc1.tech/tasks/{id}`

### 10.2 External Resources
- Trading 212 API Docs: https://github.com/trading212/api-docs
- Polymarket API: https://docs.polymarket.com/
- CoinGecko API: https://www.coingecko.com/en/api
- Firebase Docs: https://firebase.google.com/docs
- Google Calendar API: https://developers.google.com/calendar/api

### 10.3 Hermes Skills (Relevant)
- `bob-*` — All BOB-related operations (data access, story/task creation, maintenance)
- `quantum-paper-v1` — Trading bot design document and risk framework
- `google-workspace` — Gmail, Calendar, Drive integration
- `hermes-agent` — Core agent documentation

---

## 11. Session Handoff Notes

**When taking over an ongoing session:**

1. Check `~/.hermes/cron/output/` for recent scheduled job results
2. Review BOB manifest: `/Users/jim/git/bob/build-logs/manifest.json`
3. Check trading bot state: `~/.hermes/data/trading-bot/positions.json`
4. Look for any unresolved error logs in console output
5. Verify which OAuth flows are completed vs pending
6. Ask Jim: "What's the single most important thing to ship this week?"

---

**END OF GUIDE**
