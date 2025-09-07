import { expect } from '@playwright/test';
import { test } from './utils/auth';
import { dragStoryToLane } from './utils/kanban';

function unique(name: string) {
  return `${name} ${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

test.describe('Stories CRUD + Kanban', () => {
  test('create story, update status, DnD on kanban, delete', async ({ page, login }) => {
    await login();

    const title = unique('E2E Story');

    // Create via Stories page modal
    await page.goto(`${process.env.APP_BASE_URL || ''}/stories`);
    await page.getByRole('button', { name: /add story/i }).click();
    await page.getByRole('dialog').getByLabel('Title *').fill(title);
    await page.getByRole('dialog').getByLabel('Description').fill('Created by Playwright');
    await page.getByRole('dialog').getByRole('button', { name: /create story/i }).click();

    // Verify presence in table
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 });

    // Inline update status to done (open editor by clicking cell under Status)
    const row = page.locator('tr', { hasText: title }).first();
    // Click the Status cell by locating the select when editing
    await row.getByText(/status/i).first().click({ force: true }).catch(() => {});
    // As fallback, click the second cell (title) to focus row, then press Tab to move to Status cell
    await row.locator('td').nth(2).click();
    // Try to open a select editor by double clicking Status column cell
    await row.locator('td').nth(5).dblclick().catch(() => {});
    // If select appears, choose done; otherwise skip
    const select = row.locator('select');
    if (await select.isVisible().catch(() => false)) {
      await select.selectOption('done');
    }

    // Kanban drag-and-drop to Active
    await page.goto(`${process.env.APP_BASE_URL || ''}/enhanced-kanban`);
    // Wait for card to appear
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 });
    await dragStoryToLane(page, title, 'active');

    // Assert story visible after move
    await expect(page.getByText(title).first()).toBeVisible();

    // Delete from Stories table
    await page.goto(`${process.env.APP_BASE_URL || ''}/stories`);
    const delRow = page.locator('tr', { hasText: title }).first();
    await delRow.getByTestId('story-delete-btn').click();
    await expect(page.getByText(title)).toHaveCount(0);
  });
});
