import { expect } from '@playwright/test';
import { test } from './utils/auth';

function unique(name: string) {
  return `${name} ${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

test.describe('Goals CRUD', () => {
  test('create, update, delete goal via UI', async ({ page, login }) => {
    await login();

    const title = unique('E2E Goal');
    const updated = `${title} (Updated)`;

    // Create via Quick Actions
    await page.goto(`${process.env.APP_BASE_URL || ''}/dashboard`);
    await page.getByTestId('create-goal-button').click();
    await page.getByLabel('Title *').fill(title);
    await page.getByLabel('Description').fill('Created by Playwright');
    await page.getByRole('button', { name: /create goal/i }).click();

    // Go to Goals page and assert presence
    await page.goto(`${process.env.APP_BASE_URL || ''}/goals`);
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 });

    // Open Edit modal for row with this title
    const row = page.locator('tr', { hasText: title }).first();
    await row.getByTestId('goal-edit-btn').click();
    await page.getByRole('dialog').getByLabel(/goal title/i).fill(updated);
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByText(updated).first()).toBeVisible();

    // Delete
    const delRow = page.locator('tr', { hasText: updated }).first();
    await delRow.getByTestId('goal-delete-btn').click();
    await expect(page.getByText(updated)).toHaveCount(0);
  });
});
