import { test as base } from '@playwright/test';

type Fixtures = {
  login: () => Promise<void>;
};

export const test = base.extend<Fixtures>({
  login: async ({ page }, use) => {
    const baseUrl = process.env.APP_BASE_URL || 'http://localhost:4173';
    await page.goto(baseUrl);

    // If already logged in, short-circuit
    if (await page.getByText(/dashboard/i).first().isVisible().catch(() => false)) {
      await use(async () => {});
      return;
    }

    const email = process.env.TEST_USER_EMAIL || 'agenticaitestuser@jc1.tech';
    const password = process.env.TEST_USER_PASSWORD || 'SecureAgenticAI2025!';

    // Fill login form
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();

    // Wait for app shell to render
    await page.waitForURL(/\/(dashboard|goals|sprints|stories)/, { timeout: 30_000 });

    await use(async () => {});
  },
});

export const expect = test.expect;

