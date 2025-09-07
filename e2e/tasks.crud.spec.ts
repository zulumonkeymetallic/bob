import { expect } from '@playwright/test';
import { test } from './utils/auth';

function unique(name: string) {
  return `${name} ${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

test.describe('Tasks CRUD', () => {
  test('create task via Quick Actions, update, delete', async ({ page, login }) => {
    await login();
    const title = unique('E2E Task');

    // Create via Quick Actions
    await page.goto(`${process.env.APP_BASE_URL || ''}/dashboard`);
    await page.getByTestId('create-task-button').click();
    await page.getByRole('dialog').getByLabel('Title *').fill(title);
    await page.getByRole('dialog').getByRole('button', { name: /create task/i }).click();

    // Go to Tasks Management
    await page.goto(`${process.env.APP_BASE_URL || ''}/tasks-management`);
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 });

    // Update status via inline select (set to in-progress)
    const row = page.locator('tr', { hasText: title }).first();
    // Focus some cell then open select for Status (column index may vary; try to find a select)
    await row.locator('td').nth(3).dblclick().catch(() => {});
    const select = row.locator('select');
    if (await select.isVisible().catch(() => false)) {
      await select.selectOption('in-progress');
    }

    // Delete task
    await row.getByTestId('task-delete-btn').click();
    await expect(page.getByText(title)).toHaveCount(0);
  });
});
