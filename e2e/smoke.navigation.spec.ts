import { expect } from '@playwright/test';
import { test } from './utils/auth';

test.describe('Smoke Navigation', () => {
  test('navigates core routes without errors', async ({ page, login }) => {
    await login();

    const routes = ['/dashboard', '/goals', '/stories', '/tasks-management', '/sprints/management'];
    for (const path of routes) {
      await page.goto(`${process.env.APP_BASE_URL || ''}${path}`);
      await expect(page.locator('text=[object Object]')).toHaveCount(0);
      // Basic presence checks
      await expect(page).toHaveURL(new RegExp(path.replace('/', '\\/')));
    }
  });
});

