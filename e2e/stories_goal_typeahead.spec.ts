import { test, expect } from '@playwright/test';

const TEST_QS = '?test-login=true&test-mode=true';

test.describe('Stories goal typeahead', () => {
  test('links a story to a goal via suggestion dropdown', async ({ page }) => {
    // 1) Create a Goal via UI
    await page.goto('/goals' + TEST_QS);
    await page.getByRole('button', { name: 'Add Goal' }).click();
    await page.getByRole('dialog').getByLabel('Title *').fill('E2E Goal Alpha');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    // Wait for modal to close
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });

    // 2) Create a Story via UI
    await page.goto('/stories' + TEST_QS);
    await page.getByRole('button', { name: 'Add Story' }).click();
    await page.getByRole('dialog').getByLabel('Title *').fill('E2E Story Beta');
    await page.getByRole('dialog').getByRole('button', { name: 'Add Story' }).click();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });

    // 3) Find the new story row and edit Goal cell
    const row = page.getByRole('row', { name: /E2E Story Beta/ });
    await expect(row).toBeVisible();
    // Click Goal cell by focusing the 4th visible column (Ref, Story Title, Description, Goal)
    const goalCell = row.locator('td').nth(3);
    await goalCell.click();
    // Input appears
    const input = goalCell.getByRole('textbox');
    await expect(input).toBeVisible();
    await input.fill('E2E Goal');
    // Expect suggestion dropdown to show our goal
    const suggestion = page.getByText('E2E Goal Alpha', { exact: true }).first();
    await expect(suggestion).toBeVisible();
    await suggestion.click();

    // 4) Verify cell now shows linked goal title
    await expect(row.locator('td').nth(3)).toContainText('E2E Goal Alpha');
  });
});

