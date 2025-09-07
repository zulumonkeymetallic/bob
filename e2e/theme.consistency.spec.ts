import { expect } from '@playwright/test';
import { test } from './utils/auth';
import { runA11yAudit } from './utils/a11y';

const MODES: Array<'auto' | 'light' | 'dark'> = ['auto', 'light', 'dark'];

test.describe('Theme Consistency + Contrast', () => {
  for (const mode of MODES) {
    test(`mode=${mode} has readable contrast`, async ({ page, login }) => {
      await page.addInitScript(([m]) => {
        try { localStorage.setItem('bob-theme-mode', m as string); } catch {}
      }, [mode]);
      await login();
      await page.goto(`${process.env.APP_BASE_URL || ''}/dashboard`);
      // Guard against accidental object rendering
      await expect(page.getByText('[object Object]')).toHaveCount(0);
      await runA11yAudit(page, `dashboard-${mode}`);

      await page.goto(`${process.env.APP_BASE_URL || ''}/goals`);
      await expect(page.getByText('[object Object]')).toHaveCount(0);
      await runA11yAudit(page, `goals-${mode}`);
    });
  }
});

