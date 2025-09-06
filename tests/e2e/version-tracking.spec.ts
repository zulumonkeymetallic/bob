import { test, expect } from '@playwright/test';

test('BOB App loads successfully', async ({ page }) => {
  await page.goto('/');
  
  // Wait for the app to load
  await page.waitForLoadState('networkidle');
  
  // Check that the page title is correct
  const title = await page.title();
  expect(title).toContain('BOB');
});

test('Version tracking works without localStorage errors', async ({ page }) => {
  await page.goto('/');
  
  // Wait for the app to load
  await page.waitForLoadState('networkidle');
  
  // Check for any JavaScript errors
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  
  // Wait a bit to see if any errors occur
  await page.waitForTimeout(2000);
  
  // Should not have any localStorage-related errors
  const localStorageErrors = errors.filter(error => 
    error.includes('localStorage is not defined') ||
    error.includes('ReferenceError')
  );
  
  expect(localStorageErrors).toHaveLength(0);
});
