#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function readVersionTs(p) {
  const src = fs.readFileSync(p, 'utf8');
  const m = src.match(/export const VERSION\s*=\s*['"]([^'\"]+)['"]/);
  if (!m) throw new Error('VERSION not found in ' + p);
  return m[1];
}

const pkg = readJSON(path.join(__dirname, '..', 'react-app', 'package.json'));
const tsVer = readVersionTs(path.join(__dirname, '..', 'react-app', 'src', 'version.ts'));
const parts = [
  { label: 'react-app/package.json', val: pkg.version },
  { label: 'react-app/src/version.ts', val: tsVer },
];
const buildVerPath = path.join(__dirname, '..', 'react-app', 'build', 'version.json');
if (fs.existsSync(buildVerPath)) {
  parts.push({ label: 'react-app/build/version.json', val: readJSON(buildVerPath).version });
}

const distinct = new Set(parts.map(p => p.val));
if (distinct.size === 1) {
  console.log('✅ Version alignment OK:', [...distinct][0]);
  process.exit(0);
}
console.error('❌ Version mismatch detected:');
for (const p of parts) console.error(` - ${p.label}: ${p.val}`);
process.exit(1);

