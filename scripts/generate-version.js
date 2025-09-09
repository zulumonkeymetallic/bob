#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

try {
  // Resolve app directory (npm runs this from react-app)
  const appDir = process.cwd();

  // Read app package.json (react-app)
  const packageJson = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  
  // Get git commit hash
  let gitHash = 'unknown';
  try {
    gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch (e) {
    console.warn('Could not get git hash:', e.message);
  }
  
  // Try to read a human-friendly build label (BUILD_HASH) from src/version.ts
  let buildHash = gitHash;
  try {
    const versionTs = fs.readFileSync(path.join(appDir, 'src', 'version.ts'), 'utf8');
    const match = versionTs.match(/export const BUILD_HASH\s*=\s*['"]([^'"]+)['"]/);
    if (match && match[1]) buildHash = match[1];
  } catch (e) {
    // ignore
  }

  // Optionally merge metadata from public/version.json if present
  let extra = {};
  try {
    const pubV = JSON.parse(fs.readFileSync(path.join(appDir, 'public', 'version.json'), 'utf8'));
    const { features, description, githubIssues } = pubV || {};
    extra = { features, description, githubIssues };
  } catch (e) {
    // ignore if not found
  }

  // Create version object
  const versionInfo = Object.assign({
    version: packageJson.version,
    build: gitHash,
    builtAt: new Date().toISOString(),
    buildHash,
  }, extra);
  
  // Ensure build directory exists (CRA build output)
  const buildDir = path.join(appDir, 'build');
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }
  
  // Write version.json
  const versionPath = path.join(buildDir, 'version.json');
  fs.writeFileSync(versionPath, JSON.stringify(versionInfo, null, 2));
  
  console.log('✅ Generated version.json:', versionInfo);
  
} catch (error) {
  console.error('❌ Error generating version.json:', error.message);
  process.exit(1);
}
