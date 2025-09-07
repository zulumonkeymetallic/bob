import { defineConfig, devices } from '@playwright/test';

const PORT = parseInt(process.env.PORT || '4173', 10);
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const USE_BUILD = process.env.PW_USE_BUILD === '1';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [
    ['list'],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: APP_BASE_URL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: USE_BUILD
    ? {
        command: `npx --yes serve -s react-app/build -l ${PORT}`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : {
        command: `PORT=${PORT} BROWSER=none npm start`,
        cwd: 'react-app',
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

