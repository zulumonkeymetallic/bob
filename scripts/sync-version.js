#!/usr/bin/env node
/**
 * Syncs version across the app with a single source of truth:
 * - Source: react-app/package.json.version
 * - Updates: react-app/src/version.ts (export const VERSION = 'x.y.z')
 *            react-app/public/version.json (optional, if present)
 *
 * Usage:
 * - Runs automatically if configured as:
 *   - react-app/package.json "prebuild"
 *   - react-app/package.json "prestart"
 *   - react-app/package.json "version" (runs on `npm version`)
 */
const fs = require('fs');
const path = require('path');

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

try {
  const appRoot = path.join(__dirname, '..', 'react-app');
  const pkgPath = path.join(appRoot, 'package.json');
  const verTsPath = path.join(appRoot, 'src', 'version.ts');
  const legacyVerJsonPath = path.join(appRoot, 'public', 'version.json');

  const pkg = readJSON(pkgPath);
  const desiredVersion = pkg.version;

  // Ensure src/version.ts exists and has correct VERSION
  let verTs = '';
  if (fs.existsSync(verTsPath)) {
    verTs = fs.readFileSync(verTsPath, 'utf8');
    const hasConst = /export const VERSION\s*=\s*['"][^'\"]+['"]/m.test(verTs);
    if (hasConst) {
      verTs = verTs.replace(/export const VERSION\s*=\s*['"][^'\"]+['"]/m, `export const VERSION = '${desiredVersion}'`);
    } else {
      // Prepend a VERSION export if missing
      verTs = `export const VERSION = '${desiredVersion}';\n` + verTs;
    }
  } else {
    // Create a minimal version.ts if missing
    verTs = `// Version tracking for cache busting\nexport const VERSION = '${desiredVersion}';\nexport const BUILD_TIME = new Date().toISOString();\nexport const BUILD_HASH = '${process.env.BUILD_HASH || 'local-dev'}';\nexport {};\n`;
  }
  fs.writeFileSync(verTsPath, verTs);

  // Optionally align public/version.json for legacy tooling
  if (fs.existsSync(legacyVerJsonPath)) {
    try {
      const legacy = readJSON(legacyVerJsonPath);
      legacy.version = desiredVersion;
      writeJSON(legacyVerJsonPath, legacy);
    } catch (e) {
      // ignore but do not fail
    }
  }

  console.log(`✅ Synchronized version to ${desiredVersion}`);
} catch (err) {
  console.error('❌ Version sync failed:', err.message);
  process.exit(1);
}

