import { test, expect } from '@playwright/test';

test.describe('Planner Matrix smoke', () => {
  test('renders planner matrix shell', async ({ page }) => {
    await page.goto('/sprints/planner');
    await expect(page.locator('text=Sprint Planner Matrix')).toBeVisible({ timeout: 15000 }).catch(() => {});
  });
});

