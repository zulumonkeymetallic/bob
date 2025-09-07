import { Page } from '@playwright/test';
import { configureAxe, checkA11y, injectAxe } from '@axe-core/playwright';

export async function runA11yAudit(page: Page, contextLabel: string) {
  await injectAxe(page);
  await configureAxe(page, {
    rules: [
      { id: 'color-contrast', enabled: true },
      { id: 'duplicate-id', enabled: true },
    ],
  });
  await checkA11y(page, undefined, {
    detailedReport: true,
    detailedReportOptions: { html: true },
    axeOptions: {
      runOnly: {
        type: 'rule',
        values: ['color-contrast'],
      },
    },
  }, true, contextLabel);
}

