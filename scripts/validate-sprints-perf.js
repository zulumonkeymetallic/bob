#!/usr/bin/env node
/*
 Validate sprint load: no permission-denied and fast attach time.

 Steps:
 1) Mint a custom token for the given UID using the provided service account.
 2) Spawn the React dev server with forced long polling (fast attach).
 3) Launch Playwright Chromium headless, sign in via window.BOB_SIGNIN_WITH_CUSTOM_TOKEN,
    set persona to 'personal', navigate to /sprints, and capture console logs.
 4) Assert: no permission-denied logs and sprints_attach < 1000ms; report timings.

 Usage:
   node scripts/validate-sprints-perf.js --serviceAccount=/path/to/sa.json --uid=<UID> --project=bob20250810
*/

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const admin = require('firebase-admin');
const waitOn = require('wait-on');
const { chromium } = require('playwright');

function getArg(flag, fallback = '') {
  // Support --flag value and --flag=value
  const i = process.argv.indexOf(flag);
  if (i !== -1) {
    const v = process.argv[i + 1];
    if (v && !v.startsWith('--')) return String(v);
  }
  const eq = process.argv.find((a) => a.startsWith(flag + '='));
  if (eq) return String(eq.split('=')[1] || '');
  return fallback;
}

async function mintToken(serviceAccountPath, uid, projectId) {
  const abs = path.resolve(serviceAccountPath);
  if (!fs.existsSync(abs)) throw new Error(`Service account file not found: ${abs}`);
  const sa = require(abs);
  // Initialize a dedicated admin app to avoid polluting global
  const app = admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: projectId || sa.project_id,
  }, 'validate-sprints');
  const token = await admin.auth(app).createCustomToken(uid);
  await app.delete().catch(() => {});
  return token;
}

async function startDevServer() {
  const env = { ...process.env, BROWSER: 'none', PORT: '3000', REACT_APP_FIRESTORE_FORCE_LONG_POLLING: 'true' };
  const child = spawn('npm', ['run', '-s', 'react:dev:guardrail'], { stdio: 'pipe', env });
  child.stdout.on('data', (d) => process.stdout.write(d));
  child.stderr.on('data', (d) => process.stderr.write(d));
  await waitOn({ resources: ['http://localhost:3000'], timeout: 60000 });
  return child;
}

async function runBrowserFlow(customToken) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let attachMs = null;
  let permissionErrors = [];
  const consoleLines = [];

  page.on('console', (msg) => {
    const text = msg.text();
    consoleLines.push(text);
    if (/permission\-denied|Missing or insufficient permissions/i.test(text)) {
      permissionErrors.push(text);
    }
    if (/sprints_attach/.test(text)) {
      // Expect format: ... sprints_attach { durationMs: N, ... }
      const m = text.match(/sprints_attach.*durationMs:\s*(\d+)/);
      if (m) attachMs = parseInt(m[1], 10);
    }
  });

  // Prime persona + logging and load home
  await page.goto('http://localhost:3000/sprints/table?log=1');
  await page.evaluate(() => {
    localStorage.setItem('bob-persona', 'personal');
    localStorage.setItem('BOB_LOG', '1');
    localStorage.setItem('BOB_LOG_LEVEL', 'debug');
  });

  // Ensure helper exists then sign in
  await page.waitForFunction(() => typeof (window).BOB_SIGNIN_WITH_CUSTOM_TOKEN === 'function', null, { timeout: 15000 });
  await page.evaluate((tkn) => (window).BOB_SIGNIN_WITH_CUSTOM_TOKEN(tkn), customToken);
  // Full reload to ensure contexts attach post-auth cleanly
  await page.goto('http://localhost:3000/sprints/table?log=1');

  // Wait for sprints_attach measurement
  await page.waitForFunction(() => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const entries = performance.getEntriesByName('sprints_attach');
    return entries && entries.length > 0;
  }, null, { timeout: 20000 }).catch(() => {});

  // Give logger a moment to print
  await page.waitForTimeout(500);

  // Open SprintSelector and ensure there is at least one sprint entry
  const hasSelector = await page.locator('#sprint-selector').first().isVisible().catch(() => false);
  let visibleItems = 0;
  if (hasSelector) {
    await page.locator('#sprint-selector').click();
    await page.waitForSelector('.dropdown-menu.show', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(250);
    // Count items excluding static ones
    const items = await page.locator('.dropdown-menu.show .dropdown-item').allTextContents();
    visibleItems = items.filter((t) => !/All Sprints|Manage Sprints|No sprints/i.test(t)).length;
    if (visibleItems === 0) {
      // Try a more specific selector: sprint items have strong tag with name
      visibleItems = await page.locator('.dropdown-menu.show .dropdown-item strong').count();
    }
  }

  await browser.close();
  return { attachMs, permissionErrors, consoleLines, visibleItems };
}

async function main() {
  const serviceAccount = getArg('--serviceAccount');
  const uid = getArg('--uid');
  const project = getArg('--project', 'bob20250810');

  if (!serviceAccount || !uid) {
    console.error('Usage: --serviceAccount <path> --uid <uid> [--project <id>]');
    process.exit(2);
  }

  console.log('Minting custom token…');
  const token = await mintToken(serviceAccount, uid, project);
  console.log('Custom token minted (len=%d)', token.length);

  console.log('Starting dev server (forced long polling)…');
  const dev = await startDevServer();

  try {
    console.log('Running browser validation flow…');
    const { attachMs, permissionErrors, visibleItems, consoleLines } = await runBrowserFlow(token);

    const summary = {
      attachMs,
      permissionDenied: permissionErrors.length > 0,
      permissionErrors,
      sprintItemsVisible: visibleItems,
    };
    console.log('Validation Summary:', summary);

    if (permissionErrors.length > 0) {
      console.error('❌ Permission errors detected');
      // Dump helpful console lines for diagnosis
      const tail = consoleLines.slice(-200);
      console.log('--- Console tail ---');
      tail.forEach((l) => console.log(l));
      console.log('--- End console tail ---');
      process.exitCode = 1;
      return;
    }
    if (typeof attachMs !== 'number' || attachMs >= 1000) {
      console.error('⚠️  sprints_attach is not under 1000ms:', attachMs);
      process.exitCode = 1;
      return;
    }
    if (visibleItems < 1) {
      console.error('⚠️  SprintSelector did not show any sprints in dropdown');
      process.exitCode = 1;
      return;
    }

    console.log('✅ All checks passed');
  } finally {
    console.log('Shutting down dev server…');
    dev.kill('SIGINT');
    // Ensure process exits if dev server lingers
    setTimeout(() => { try { dev.kill('SIGKILL'); } catch {} }, 2000);
  }
}

main().catch((e) => {
  console.error('Validation failed:', e);
  process.exit(1);
});
