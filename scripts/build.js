#!/usr/bin/env node
'use strict';

/**
 * scripts/build.js
 *
 * Drop-in replacement for: REACT_APP_VERSION=... react-scripts build && node generate-version.js
 *
 * Computes the full version from git + package.json, injects all REACT_APP_*
 * environment variables, then runs react-scripts build and generate-version.js
 * in a single coherent step. Works identically locally and in CI.
 *
 * Usage (from react-app/package.json):
 *   "build": "node ../scripts/build.js"
 */

const { spawnSync } = require('child_process');
const path = require('path');
const { computeVersion } = require('./compute-version');

const APP_DIR   = path.join(__dirname, '..', 'react-app');
const ROOT_DIR  = path.join(__dirname, '..');

// ── Compute version ──────────────────────────────────────────────────────────
const info = computeVersion();
console.log(`\n🔖  Building BOB ${info.version}  (commit: ${info.build}, branch: ${info.branch || 'unknown'})\n`);

// ── Inject environment variables for react-scripts ──────────────────────────
const env = {
  ...process.env,
  REACT_APP_VERSION:          info.version,
  REACT_APP_BASE_VERSION:     info.baseVersion,
  REACT_APP_GIT_COMMIT:       info.build,
  REACT_APP_GIT_COMMIT_FULL:  info.buildFull,
  REACT_APP_GIT_BRANCH:       info.branch || '',
  REACT_APP_PR_NUMBER:        info.prNumber || '',
  REACT_APP_BUILD_TIME:       info.builtAt,
};

// ── Step 1: react-scripts build ──────────────────────────────────────────────
const buildResult = spawnSync('npx', ['react-scripts', 'build'], {
  env,
  stdio: 'inherit',
  cwd: APP_DIR,
  shell: true,   // Windows compatibility
});
if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

// ── Step 2: generate-version.js (writes build/version.json) ─────────────────
const genResult = spawnSync('node', [path.join(__dirname, 'generate-version.js')], {
  env,
  stdio: 'inherit',
  cwd: APP_DIR,
});
if (genResult.status !== 0) {
  process.exit(genResult.status ?? 1);
}

// ── Step 3: check-version-alignment (fast sanity check) ─────────────────────
const checkResult = spawnSync('node', [path.join(__dirname, 'check-version-alignment.js')], {
  stdio: 'inherit',
  cwd: ROOT_DIR,
});
if (checkResult.status !== 0) {
  process.exit(checkResult.status ?? 1);
}
