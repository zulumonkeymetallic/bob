# Enforce Dark/Light Theme Parity & Remove Hard-Coded Colors

**Type:** Enhancement  
**Priority:** P1  
**Labels:** theming, ui/ux, accessibility, tech-debt  
**Epic:** Design System & Theming  
**Estimate:** 8–13 pts

## Summary
Audit and fix **all** UI components so they correctly respect the app’s dark/light theme. Eliminate hard-coded color values (hex/rgb/hsl/css named colors) in components, styles, and utility CSS. Replace with the official design-token system (CSS variables / Tailwind tokens). Add automated checks to prevent regressions.

## Goals
- 100% of UI surfaces render correctly in dark and light modes.
- Zero hard-coded colors in component code and stylesheets (excluding design-system token definitions).
- Snapshot & visual regression coverage for both themes.
- CI guardrails to block future hard-coded color introductions.

## Scope
- Component code (React/TSX)
- Tailwind classes & config
- Inline styles & styled components
- Global CSS/SCSS
- Third-party component wrappers (overrides)
- Storybook stories (light/dark)

## Non-Goals
- Visual redesign; this enforces tokens, not new visuals.
- New color palette (use existing tokens).

## Implementation Plan
1. **Token Audit**
   - Inventory current tokens (`--theme-*` CSS vars / Tailwind theme) and map them to semantic roles: `--fg-default`, `--fg-muted`, `--bg-surface`, `--bg-elevated`, `--border-default`, `--accent`, `--success`, `--warning`, `--danger`, etc.
   - Document token usage guidelines (semantic > raw).

2. **Codebase Sweep (Replace Hard-Coded Colors)**
   - Replace hex/rgb/hsl/named colors with tokens.
   - For Tailwind, replace raw utilities (e.g., `text-[#222]`) with semantic classes (e.g., `text-foreground`, `bg-surface`), backed by theme config or CSS vars.
   - Create/extend Tailwind theme mapping to CSS vars:
     ```ts
     // tailwind.config.ts (excerpt)
     theme: {
       extend: {
         colors: {
           foreground: 'var(--fg-default)',
           surface: 'var(--bg-surface)',
           elevated: 'var(--bg-elevated)',
           border: 'var(--border-default)',
           accent: 'var(--accent)',
           success: 'var(--success)',
           warning: 'var(--warning)',
           danger: 'var(--danger)',
         },
       }
     }
     ```
   - Ensure `:root[data-theme="light"]` and `:root[data-theme="dark"]` define the full token set.

3. **Component Pass**
   - For each component/group, verify backgrounds, text, borders, icons, focus rings, and disabled states use tokens.
   - Remove any conditional color logic that bypasses tokens.

4. **Global States & Edge Cases**
   - Hover/active/focus/selected/disabled states tokenised.
   - Charts & third-party widgets: use tokenized palettes or provide dark/light config.
   - Overlays/modals/tooltips: ensure elevation tokens work in both themes.
   - Scrollbars (WebKit): tokenized track/thumb where supported.

5. **Storybook & Docs**
   - Add light/dark theme switcher at the toolbar level.
   - Per-component stories render in both themes.
   - Document “Do/Don’t” for tokens and a quick migration guide.

6. **Automation & CI Guardrails**
   - **ESLint Rule** (or custom lint step): flag hex/rgb/hsl/named colors in TSX/CSS.
     - Regex examples to catch offenders:
       - `#[0-9a-fA-F]{3,8}\b`
       - `\brgb(a)?\s*\(`
       - `\bhsl(a)?\s*\(`
       - `\b(black|white|red|blue|green|gray|grey|orange|purple|yellow)\b`
   - **Unit + Visual Tests**:
     - Jest + RTL for theme switching per component.
     - Playwright visual snapshots in light/dark on key screens.
   - CI fails on lint violations or visual diffs beyond threshold.

## Acceptance Criteria
- **AC1 (Zero Hard-Codes):** Searching the repo with the provided regex patterns returns **no** occurrences in app code (excluding token/theme files).
- **AC2 (Theme Parity):** All primary pages (Dashboard, Sprints, Gantt, Stories, Tasks, Goals, Settings) visually pass light/dark snapshots (≤ acceptable diff threshold).
- **AC3 (A11y Contrast):** Body text and essential UI meet WCAG AA contrast (≥ 4.5:1). Evidence provided via automated report or tooling notes.
- **AC4 (State Coverage):** Hover/active/focus/disabled/selected states are tokenised and render correctly in both themes.
- **AC5 (Third-Party UI):** Wrapped components and charts use theme-aware palettes with no illegible elements in dark mode.
- **AC6 (CI Guardrails):** Lint rule is active; PRs with new hard-coded colors fail CI.

## Tasks
- [ ] Token inventory & doc: list all `--theme-*` and Tailwind mappings.
- [ ] Tailwind config: add/verify semantic color keys mapped to CSS vars.
- [ ] Replace hard-coded colors in components and styles.
- [ ] Update charts/overrides to use token palettes.
- [ ] Add Storybook dark/light toggle & per-component dual stories.
- [ ] Add ESLint/Stylelint rules (regex checks) and wire into CI.
- [ ] Add Jest theme-switch tests for key components.
- [ ] Add Playwright visual snapshots (light/dark) for key pages.
- [ ] Generate a11y contrast report for critical screens.
- [ ] Documentation: theming guidelines & migration notes.

## Test Plan
- **Static:** ESLint/Stylelint pass; grep/regex search shows zero color literals.
- **Unit:** Components mount and re-render when theme toggles; no inline colors.
- **Visual (Playwright):** Light/dark snapshots for Dashboard, Gantt, Stories, Tasks, Goals, Settings; diffs within threshold.
- **A11y:** Contrast checks via axe/lighthouse/pa11y report attached to PR.

## Risks & Mitigations
- **Risk:** Third-party components ignore CSS vars.  
  **Mitigation:** Provide theme wrappers or scoped CSS with `:root[data-theme=…]` overrides; swap to themeable alternatives if necessary.
- **Risk:** Visual regressions post-migration.  
  **Mitigation:** Incremental PRs, Storybook review, visual snapshot gating.

## Done
- All ACs met, CI guardrails active, docs published in `/docs/theming.md`, Storybook showcases light/dark parity.