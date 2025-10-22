import { test, expect } from '@playwright/test';

test('planner renders and shows headers', async ({ page }) => {
  await page.goto('/calendar');
  await expect(page.getByText('Unified Planner')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync Google' })).toBeVisible();
});

test('sprint matrix capacity header exists', async ({ page }) => {
  await page.goto('/sprints/planner');
  await expect(page.getByText('Sprint Planner Matrix')).toBeVisible();
  await expect(page.getByText('Sprint Capacity')).toBeVisible();
});

