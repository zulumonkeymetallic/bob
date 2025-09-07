import { expect } from '@playwright/test';
import { test } from './utils/auth';

function unique(name: string) {
  return `${name} ${new Date().toISOString().slice(0,19).replace(/[:T]/g, '-')}`;
}

test.describe('Sprints CRUD', () => {
  test('create, update status, delete sprint', async ({ page, login, context }) => {
    await login();
    const name = unique('E2E Sprint');

    await page.goto(`${process.env.APP_BASE_URL || ''}/sprints/management`);
    // Switch to Table View tab where ModernSprintsTable provides CRUD
    await page.getByRole('button', { name: /table view/i }).click();
    // Open create modal in table
    await page.getByTestId('create-sprint-button').click();

    const dlg = page.getByRole('dialog');
    await dlg.getByLabel(/sprint name/i).fill(name);
    await dlg.getByLabel(/objective/i).fill('Playwright-created sprint');
    const today = new Date();
    const start = today.toISOString().slice(0, 10);
    const end = new Date(today.getTime() + 7*24*3600*1000).toISOString().slice(0, 10);
    await dlg.getByLabel(/start date/i).fill(start);
    await dlg.getByLabel(/end date/i).fill(end);
    await dlg.getByRole('button', { name: /create sprint|update sprint/i }).click();

    // Row should appear
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 });

    // Update status via dropdown to Active
    const row = page.locator('tr', { hasText: name }).first();
    await row.getByRole('button', { name: /planning|planned|active|complete|cancelled/i }).click();
    await page.getByRole('menuitem', { name: /active/i }).click();

    // Delete sprint (accept confirm dialog)
    page.on('dialog', d => d.accept());
    await row.getByTestId('sprint-delete-btn').click();
    await expect(page.getByText(name)).toHaveCount(0);
  });
});
