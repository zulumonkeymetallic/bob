import { defineConfig, devices } from '@playwright/test';

const useBuild = process.env.PW_USE_BUILD === '1';
const baseURL = process.env.APP_BASE_URL || (useBuild ? 'http://localhost:4173' : 'http://localhost:3000');

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list'], ['junit', { outputFile: 'test-results/junit.xml' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: useBuild ? 'npm run preview:test' : 'npm run dev:test',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

