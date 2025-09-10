import { test, expect } from '@playwright/test';

const unique = (prefix: string) => `${prefix}-${Date.now().toString(36).slice(-6)}`;

test.describe('BOB E2E CRUD (Goals, Stories, Sprints, Tasks)', () => {
  test('CRUD across cards and tables', async ({ page }) => {
    const base = '/?test-login=true&test-mode=true';

    // Login via test side-door and ensure app is loaded
    await page.goto(base);
    await page.waitForSelector('button.md-fab');

    // ---------- Goals (Create via FAB) ----------
    const goalTitle = unique('Goal E2E');
    await page.locator('button.md-fab').click();
    await page.getByTitle('Add Goal').click();
    await page.getByLabel('Title *').fill(goalTitle);
    await page.getByRole('button', { name: 'Create Goal' }).click();
    await expect(page.getByText('✅ Goal created successfully!')).toBeVisible();

    // Verify in Goals list (table) and update/delete
    await page.goto('/goals');
    await expect(page.getByText('Goals Management')).toBeVisible();
    await expect(page.getByText(goalTitle)).toBeVisible();

    // Update inline title in ModernGoalsTable
    const newGoalTitle = goalTitle + ' Updated';
    const goalRow = page.locator('table >> tr', { hasText: goalTitle });
    await expect(goalRow).toBeVisible();
    // Click the Goal Title cell (2nd visible column; safer to click by text)
    await goalRow.getByText(goalTitle).first().click();
    const editInput = goalRow.locator('input[type="text"]');
    await editInput.fill(newGoalTitle);
    await editInput.press('Enter');
    await expect(goalRow.getByText(newGoalTitle)).toBeVisible();

    // Switch to Cards and verify
    await page.locator('#button-cards').click();
    await expect(page.getByText(newGoalTitle)).toBeVisible();

    // Back to list and delete
    await page.locator('#button-list').click();
    const goalRowUpdated = page.locator('table >> tr', { hasText: newGoalTitle });
    await goalRowUpdated.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(newGoalTitle)).toHaveCount(0);

    // ---------- Sprints (Table page) ----------
    await page.goto('/sprints/table');
    await expect(page.getByText('Sprints (Table)')).toBeVisible();
    await page.getByRole('button', { name: 'New Sprint' }).click();

    const sprintName = unique('Sprint E2E');
    await page.getByLabel('Sprint Name *').fill(sprintName);
    // Fill dates (today and +7d)
    const today = new Date();
    const plus7 = new Date(today.getTime() + 7 * 86400000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    await page.getByLabel('Start Date *').fill(fmt(today));
    await page.getByLabel('End Date *').fill(fmt(plus7));
    await page.getByRole('button', { name: 'Create Sprint' }).click();

    // Verify created
    await expect(page.getByText(sprintName)).toBeVisible();

    // Edit sprint
    const sprintRow = page.locator('table >> tr', { hasText: sprintName });
    // Click the first action button (edit)
    await sprintRow.locator('td').last().locator('button').first().click();
    await page.getByLabel('Status').selectOption('active');
    await page.getByRole('button', { name: 'Update Sprint' }).click();
    await expect(page.getByText(sprintName)).toBeVisible();

    // Delete sprint (confirm dialog)
    page.once('dialog', d => d.accept());
    // Click the second action button (delete)
    await sprintRow.locator('td').last().locator('button').nth(1).click();
    await expect(page.getByText(sprintName)).toHaveCount(0);

    // ---------- Stories (Add via page modal) ----------
    await page.goto('/stories');
    await expect(page.getByText('Stories Management')).toBeVisible();
    await page.getByRole('button', { name: 'Add Story' }).click();

    const storyTitle = unique('Story E2E');
    await page.getByLabel('Title *').fill(storyTitle);
    await page.getByRole('button', { name: 'Create Story' }).click();
    await expect(page.getByText('✅ Story created successfully!')).toBeVisible();

    // Verify in table then switch to cards
    await expect(page.getByText(storyTitle)).toBeVisible();
    await page.getByRole('button', { name: 'Cards' }).click();
    await expect(page.getByText(storyTitle)).toBeVisible();
    await page.getByRole('button', { name: 'List' }).click();

    // Inline edit story title in table
    const storyRow = page.locator('table >> tr', { hasText: storyTitle });
    await storyRow.getByText(storyTitle).first().click();
    const storyEdit = storyRow.locator('input[type="text"]');
    const storyTitleUpdated = storyTitle + ' Updated';
    await storyEdit.fill(storyTitleUpdated);
    await storyEdit.press('Enter');
    await expect(storyRow.getByText(storyTitleUpdated)).toBeVisible();

    // Delete story
    await storyRow.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(storyTitleUpdated)).toHaveCount(0);

    // ---------- Tasks (Create via FAB, manage in Tasks table) ----------
    await page.goto('/');
    const taskTitle = unique('Task E2E');
    await page.locator('button.md-fab').click();
    await page.getByTitle('Add Task').click();
    await page.getByLabel('Title *').fill(taskTitle);
    await page.getByRole('button', { name: 'Create Task' }).click();
    await expect(page.getByText(/Task created/i)).toBeVisible();

    // Go to tasks management and verify
    await page.goto('/tasks-management');
    await expect(page.getByText('Task Management')).toBeVisible();
    await expect(page.getByText(taskTitle)).toBeVisible();

    // Update task title inline
    const taskRow = page.locator('table >> tr', { hasText: taskTitle });
    await taskRow.getByText(taskTitle).first().click();
    const taskEdit = taskRow.locator('input[type="text"]');
    const taskTitleUpdated = taskTitle + ' Updated';
    await taskEdit.fill(taskTitleUpdated);
    await taskEdit.press('Enter');
    await expect(taskRow.getByText(taskTitleUpdated)).toBeVisible();

    // Delete task (soft delete)
    await taskRow.getByRole('button', { name: 'Delete' }).click();
    // Row may remain but status changes; verify not listed by searching text count reduce
    await expect(page.getByText(taskTitleUpdated)).toHaveCount(0);
  });
});
