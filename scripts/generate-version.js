#!/usr/bin/env node
'use strict';

/**
 * generate-version.js
 *
 * Writes react-app/build/version.json using version info computed by
 * compute-version.js (or from REACT_APP_* env vars already injected by build.js).
 *
 * Called automatically by scripts/build.js after react-scripts build completes.
 * Can also be run standalone: node scripts/generate-version.js
 */

const fs   = require('fs');
const path = require('path');

// Prefer env vars (already computed by build.js) over re-computing from git,
// so the version.json is guaranteed to match what was baked into the bundle.
function getVersionInfo() {
  if (process.env.REACT_APP_VERSION) {
    // Running inside build.js pipeline — env vars already set
    const { execSync } = require('child_process');
    function git(cmd, fallback = '') {
      try { return execSync(cmd, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim(); }
      catch { return fallback; }
    }
    return {
      version:     process.env.REACT_APP_VERSION,
      baseVersion: process.env.REACT_APP_BASE_VERSION || process.env.REACT_APP_VERSION,
      build:       process.env.REACT_APP_GIT_COMMIT   || git('git rev-parse --short HEAD', 'unknown'),
      buildFull:   process.env.REACT_APP_GIT_COMMIT_FULL || git('git rev-parse HEAD', 'unknown'),
      branch:      process.env.REACT_APP_GIT_BRANCH   || '',
      prNumber:    process.env.REACT_APP_PR_NUMBER     || null,
      builtAt:     process.env.REACT_APP_BUILD_TIME    || new Date().toISOString(),
    };
  }
  // Standalone run — compute from scratch
  const { computeVersion } = require('./compute-version');
  return computeVersion();
}

try {
  const appDir = process.cwd(); // react-app when called via npm run build

  const info = getVersionInfo();

  // Merge optional metadata from public/version.json (features list, description, etc.)
  let extra = {};
  try {
    const pubV = JSON.parse(fs.readFileSync(path.join(appDir, 'public', 'version.json'), 'utf8'));
    const { features, description, githubIssues } = pubV || {};
    extra = { features, description, githubIssues };
  } catch { /* no public/version.json — fine */ }

  const versionInfo = {
    version:     info.version,
    baseVersion: info.baseVersion,
    build:       info.build,
    buildFull:   info.buildFull   || null,
    branch:      info.branch      || null,
    prNumber:    info.prNumber    || null,
    builtAt:     info.builtAt,
    buildHash:   info.build,      // legacy alias
    buildId:     info.prNumber ? `pr.${info.prNumber}` : (info.branch || null),
    ...extra,
  };

  // Write to build/version.json
  const buildDir  = path.join(appDir, 'build');
  if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });
  const outPath = path.join(buildDir, 'version.json');
  fs.writeFileSync(outPath, JSON.stringify(versionInfo, null, 2));
  console.log('✅ Generated version.json:', versionInfo);

} catch (err) {
  console.error('❌ generate-version.js failed:', err.message);
  process.exit(1);
}
