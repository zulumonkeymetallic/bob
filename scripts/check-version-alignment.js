#!/usr/bin/env node
/**
 * Ensures version alignment across:
 * - react-app/package.json
 * - react-app/src/version.ts (export const VERSION = "x.y.z")
 * - react-app/public/version.json
 */
const fs = require('fs');
const path = require('path');

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readVersionTs(p) {
  const src = fs.readFileSync(p, 'utf8');
  const match = src.match(/export const VERSION\s*=\s*"([^"]+)"/);
  if (!match) throw new Error(`VERSION not found in ${p}`);
  return match[1];
}

try {
  const pkgPath = path.join(__dirname, '..', 'react-app', 'package.json');
  const verTsPath = path.join(__dirname, '..', 'react-app', 'src', 'version.ts');
  const verJsonPath = path.join(__dirname, '..', 'react-app', 'public', 'version.json');

  const pkg = readJSON(pkgPath);
  const verTs = readVersionTs(verTsPath);
  const verJson = readJSON(verJsonPath);

  const a = pkg.version;
  const b = verTs;
  const c = verJson.version;

  if (a === b && b === c) {
    console.log(`✅ Version alignment OK: ${a}`);
    process.exit(0);
  }

  console.error('❌ Version mismatch detected:');
  console.error(` - react-app/package.json: ${a}`);
  console.error(` - react-app/src/version.ts: ${b}`);
  console.error(` - react-app/public/version.json: ${c}`);
  process.exit(1);
} catch (err) {
  console.error('❌ Version alignment check failed:', err.message);
  process.exit(2);
}

