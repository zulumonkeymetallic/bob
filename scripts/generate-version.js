#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

try {
  // Read package.json
  const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  
  // Get git commit hash
  let gitHash = 'unknown';
  try {
    gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch (e) {
    console.warn('Could not get git hash:', e.message);
  }
  
  // Create version object
  const versionInfo = {
    version: packageJson.version,
    build: gitHash,
    builtAt: new Date().toISOString()
  };
  
  // Ensure build directory exists
  const buildDir = './react-app/build';
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
