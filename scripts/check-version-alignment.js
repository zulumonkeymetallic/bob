#!/usr/bin/env node
'use strict';

/**
 * check-version-alignment.js
 *
 * Validates that all version artefacts agree.
 * The check is baseVersion-only: the display version includes commit hash / branch
 * suffixes that legitimately differ between sources.
 *
 * Sources checked:
 *   - react-app/package.json         (always present, the authoritative semver)
 *   - react-app/build/version.json   (present after a build)
 */

const fs   = require('fs');
const path = require('path');

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

const ROOT    = path.join(__dirname, '..');
const pkg     = readJSON(path.join(ROOT, 'react-app', 'package.json'));
const baseVer = pkg.version;

const buildVerPath = path.join(ROOT, 'react-app', 'build', 'version.json');
if (!fs.existsSync(buildVerPath)) {
  console.log(`ℹ️  No build/version.json yet — skipping artefact check`);
  process.exit(0);
}

const built      = readJSON(buildVerPath);
const builtBase  = built.baseVersion || built.version.split(/[-+]/)[0];

if (builtBase !== baseVer) {
  console.error('❌ Version mismatch:');
  console.error(`   package.json:       ${baseVer}`);
  console.error(`   build/version.json: ${built.version} (base: ${builtBase})`);
  console.error('\nRun: npm run build to regenerate the artefact.');
  process.exit(1);
}

console.log(`✅ Version alignment OK`);
console.log(`   base:    ${baseVer}`);
console.log(`   display: ${built.version}`);
console.log(`   commit:  ${built.build || '(none)'}`);
console.log(`   branch:  ${built.branch || '(none)'}`);
if (built.prNumber) console.log(`   PR:      #${built.prNumber}`);

