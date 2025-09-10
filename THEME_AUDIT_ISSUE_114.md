Theme Consistency Audit (Issue #114)

Summary

- Goal: Remove hardcoded colors and ensure all components, widgets, and backgrounds respect the app’s theme via CSS variables.
- Approach: Centralize theme tokens, refactor key components away from inline hex/rgba, and make “domain theme” colors (Health/Growth/Wealth/Tribe/Home) resolve from CSS variables instead of hardcoded values.

Key Changes

- Added utility: `react-app/src/utils/themeVars.ts`
  - Exposes `themeVars` (bg, panel, card, border, text, muted, brand, onAccent)
  - Provides `rgbaCard(alpha)` and domain theme var helpers
  - Adds `getCssVarValue()` to resolve CSS variables to actual color strings at runtime
- Extended base CSS variables: `react-app/src/index.css`
  - New variable: `--on-accent` for text drawn over accent/brand or domain theme colors
- Refactored components to remove hardcoded colors:
  - `react-app/src/components/GlobalSidebar.tsx`
  - `react-app/src/components/ModernKanbanBoard.tsx`
  - `react-app/src/components/Column.tsx`
  - `react-app/src/components/ModernPersonalListsTable.tsx`
  - `react-app/src/components/ModernStoriesTable.tsx`
  - `react-app/src/components/ModernTaskTable.tsx`
  - `react-app/src/components/ModernTaskTableProper.tsx`
  - `react-app/src/components/ModernGoalsTable.tsx`
  - `react-app/src/components/EnhancedKanbanPage.tsx`
  - `react-app/src/components/ModernKanbanBoard-v3.0.8.tsx`
  - `react-app/src/components/DetailsSidebar.tsx`
- Domain theme defaults now come from CSS:
  - `react-app/src/hooks/useThemeColor.ts` pulls Health/Growth/Wealth/Tribe/Home colors from `ThemeColors.css` via CSS variables instead of hex literals

Notes on Scope

- The codebase has extensive inline styles accumulated over time. This PR addresses high‑visibility surfaces and establishes a clean pattern to migrate the rest incrementally without functional risk.
- Box‑shadow values and some neutral overlays remain as fixed values (by design) since they’re not strictly theme hues. If desired, those can be lifted into variables later (e.g., `--elevation-1`, `--elevation-2`).

What “No Hardcoded Colors” Means Here

- App UI colors (backgrounds, text, borders, badges, headers) reference CSS variables: `--bg`, `--panel`, `--card`, `--line`, `--text`, `--muted`, `--brand`, `--on-accent`.
- Domain theme accents (Health/Growth/Wealth/Tribe/Home) are resolved via CSS variables from `ThemeColors.css`, ensuring dark/light harmonization and a single source of truth.

Top Remaining Files With Hardcoded Color Usage (updated)

The following files still contain color literals (hex/rgba or inline color/background/border). Suggested next migration targets, in order of density:

1) react-app/src/components/ModernStoriesTable.tsx (122)
2) react-app/src/components/ModernTaskTable.tsx (73)
3) react-app/src/components/ModernGoalsTable.tsx (71)
4) react-app/src/components/ModernTaskTableProper.tsx (70)
5) react-app/src/components/EnhancedKanbanPage.tsx (49)
6) react-app/src/components/ModernKanbanBoard-v3.0.8.tsx (47)
7) react-app/src/contexts/ModernThemeContext.tsx (45)
8) react-app/src/components/SprintPlanningMatrix.tsx (45)
9) react-app/src/constants/globalThemes.ts (43)
10) react-app/src/components/DetailsSidebar.tsx (43)
11) react-app/src/hooks/useThemeColor.ts (36) [refactored in this PR to CSS var resolution]
12) react-app/src/config/choices.ts (36)
13) react-app/src/components/GoalsCardView.tsx (35)
14) react-app/src/components/StoriesCardView.tsx (34)
15) react-app/src/components/GoalsCardView.tsx.broken (32)
16) react-app/src/components/GoalsCardView.tsx.backup (32)
17) react-app/src/hooks/useThemeAwareColors.ts (27)
18) react-app/src/components/TaskListView.tsx (25)
19) react-app/src/components/StoriesManagement.tsx (24)
20) react-app/src/components/ModernPersonalListsTable.tsx (24) [partially refactored in this PR]

Migration Guidance

- Replace `'#111827'` → `var(--text)`, `'#6b7280'` → `var(--muted)`, `'#e5e7eb'` → `var(--line)`, `'white'` panels → `var(--panel)`, neutral backgrounds → `var(--bg)`, blue accents → `var(--brand)`, error/red → `var(--red)`, success/green → `var(--green)`.
- For overlays that used `rgba(255,255,255,x)`, prefer `rgba(var(--card-rgb), x)`.
- For domain theme usage like goal/story theme pills: use `domainThemePrimaryVar(name)` and pair text with `var(--on-accent)`.
- If stronger variable coverage is needed, consider adding `--elevation-*` variables and `--brand-rgb` in `index.css`.

Build Status

- Ran `npm run build:dev` successfully; only ESLint warnings remain (unrelated to theme refactor).

Closes

- This PR targets issue #114 with concrete refactors, a utility layer for consistent theming, and a clear path to complete the remaining file migrations.
