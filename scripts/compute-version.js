#!/usr/bin/env node
'use strict';

/**
 * compute-version.js
 *
 * Single source of truth for BOB version information.
 * Called by scripts/build.js, generate-version.js, and check-version-alignment.js.
 *
 * Version format:
 *   main branch (tagged release) : 4.5.484
 *   main branch (untagged)       : 4.5.484+abc1234
 *   pull request (CI)            : 4.5.484-pr.123+abc1234
 *   feature branch               : 4.5.484-feature-name+abc1234
 *   local dev / no git           : 4.5.484-dev+abc1234 (or +unknown)
 *
 * If the working tree has uncommitted changes, appends ".dirty" (local builds only).
 */

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const PKG_PATH  = path.join(REPO_ROOT, 'react-app', 'package.json');

function git(cmd, fallback = '') {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: REPO_ROOT,
    }).trim();
  } catch {
    return fallback;
  }
}

function computeVersion() {
  // ── Base version from package.json ──────────────────────────────────────
  const pkg         = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  const baseVersion = pkg.version; // e.g. "4.5.484"

  // ── Git commit ───────────────────────────────────────────────────────────
  // In CI, GITHUB_SHA is the full commit SHA of the push/PR merge ref.
  const commitFull  = process.env.GITHUB_SHA
    || git('git rev-parse HEAD', 'unknown');
  const commitShort = commitFull !== 'unknown'
    ? commitFull.slice(0, 8)
    : git('git rev-parse --short HEAD', 'unknown');

  // ── Branch ───────────────────────────────────────────────────────────────
  // GITHUB_HEAD_REF  = source branch of a PR  (only set on pull_request events)
  // GITHUB_REF_NAME  = branch or tag name on push events
  const branch =
    process.env.GITHUB_HEAD_REF   ||
    process.env.GITHUB_REF_NAME   ||
    git('git branch --show-current', '') ||
    git('git rev-parse --abbrev-ref HEAD', 'detached');

  // ── PR number ────────────────────────────────────────────────────────────
  // GITHUB_PR_NUMBER set by GitHub Actions workflow (pass from github.event.number)
  const prNumber =
    process.env.GITHUB_PR_NUMBER  ||
    process.env.CI_PULL_REQUEST   ||
    '';

  // ── Exact tag at HEAD ────────────────────────────────────────────────────
  const exactTag = git('git describe --tags --exact-match HEAD', '');

  // ── Dirty working tree ───────────────────────────────────────────────────
  const isDirty = !process.env.CI && git('git status --porcelain', '').length > 0;

  // ── Compute display version ──────────────────────────────────────────────
  const isReleaseBranch = ['main', 'master'].includes(branch);
  const isTagged        = exactTag === `v${baseVersion}` || exactTag === baseVersion;

  let displayVersion;
  if (prNumber) {
    displayVersion = `${baseVersion}-pr.${prNumber}+${commitShort}`;
  } else if (isTagged && isReleaseBranch) {
    displayVersion = baseVersion;                                          // clean release
  } else if (isReleaseBranch) {
    displayVersion = `${baseVersion}+${commitShort}`;                     // main, untagged
  } else if (branch && !['detached', 'unknown', ''].includes(branch)) {
    const slug = branch.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 20).replace(/-$/, '');
    displayVersion = `${baseVersion}-${slug}+${commitShort}`;             // feature branch
  } else {
    displayVersion = `${baseVersion}-dev+${commitShort}`;                 // no branch info
  }

  if (isDirty) displayVersion += '.dirty';

  return {
    version:     displayVersion,   // full display version (what the app shows)
    baseVersion,                   // semver from package.json (for comparison)
    build:       commitShort,      // short commit hash
    buildFull:   commitFull,       // full commit SHA
    branch:      branch || '',
    prNumber:    prNumber || null,
    tag:         exactTag || null,
    isDirty,
    builtAt:     new Date().toISOString(),
  };
}

module.exports = { computeVersion };

// When run directly: print computed version info
if (require.main === module) {
  const info = computeVersion();
  console.log(JSON.stringify(info, null, 2));
}
