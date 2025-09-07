Theme Integrity — Single Source of Truth

Problems observed

- Two theme providers exist: `contexts/ThemeContext` and `contexts/ModernThemeContext`. Both set classes/attributes, increasing risk of mismatches (e.g., light components inside dark pages).
- Inline colors mixed with Bootstrap variants reduce contrast predictability.
- Initial theme chosen during React render can cause flash/mismatch.

Recommendations

- Choose one provider (ModernThemeContext) and standardize on a single root toggle:
  - Add early script in `public/index.html` to set `data-theme` on `<html>` and `data-bs-theme` on `<body>` from `localStorage.getItem('bob-theme-mode')` or system preference when `auto`.
  - Ensure provider only updates tokens and a single class/attribute, not both.
- Route all colors through tokens:
  - Use CSS variables `--theme-*` already applied by ModernThemeContext.
  - Remove hardcoded hexes in components; switch to variables or Bootstrap variables mapped to theme tokens.
- Tailwind (if adopted) should use `darkMode: 'class'` with the class applied to `<html>` only.

Testing

- E2E includes axe color-contrast checks for Dashboard and Goals across auto/light/dark.
- Add focused unit tests to assert the chosen attribute/class propagates (e.g., ThemeCompliance.test.tsx) if/when theme refactor is implemented.

