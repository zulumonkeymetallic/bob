import { test, expect } from '@playwright/test';

const TEST_QS = '?test-login=true&test-mode=true';

test('Chores page shows AI Routine Planner and executes', async ({ page }) => {
  await page.goto('/chores' + TEST_QS);
  // Button present
  const planBtn = page.getByRole('button', { name: /Plan Today's Routines/i });
  await expect(planBtn).toBeVisible();
  // Click and wait for feedback text to appear (we don't assert count due to empty emulator)
  await planBtn.click();
  // Look for transient status message area
  await expect(page.locator('text=/Planned .* routine blocks for/')).toBeVisible({ timeout: 10000 });
});

