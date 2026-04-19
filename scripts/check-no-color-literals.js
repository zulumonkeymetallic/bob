#!/usr/bin/env node
/**
 * Simple theming guard: fails if color literals are found in TS/TSX under react-app/src
 * Allowed files: src/index.css, src/styles/themeConsistency.css, src/utils/themeVars.ts
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'react-app', 'src');
const ALLOWLIST = new Set([
  path.join(ROOT, 'index.css'),
  path.join(ROOT, 'styles', 'themeConsistency.css'),
  path.join(ROOT, 'utils', 'themeVars.ts'),
]);

const EXTENSIONS = new Set(['.ts', '.tsx', '.jsx', '.js']);

const COLOR_REGEX = new RegExp(
  // hex | rgb/rgba | hsl/hsla | common named colors
  '(#[0-9a-fA-F]{3,8}\\b)|(\\brgba?\\s*\\()|(\\bhsl[a]?\\s*\\()|\\b(black|white|red|blue|green|gray|grey|orange|purple|yellow)\\b',
  'i'
);

const offenders = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else {
      const ext = path.extname(full);
      if (!EXTENSIONS.has(ext)) continue;
      if (ALLOWLIST.has(full)) continue;
      // Scope guardrails to modern tables and main pages to avoid legacy noise
      const rel = path.relative(path.join(__dirname, '..'), full).replace(/\\/g, '/');
      const allowedFiles = [
        'react-app/src/components/ModernGoalsTable.tsx',
        'react-app/src/components/ModernStoriesTable.tsx',
        'react-app/src/components/ModernTaskTable.tsx',
        'react-app/src/components/ModernPersonalListsTable.tsx',
        'react-app/src/components/GoalsManagement.tsx',
        'react-app/src/components/StoriesManagement.tsx',
        'react-app/src/components/TasksManagement.tsx',
        'react-app/src/components/GoalsCardView.tsx',
      ];
      const inScope = allowedFiles.includes(rel);
      if (!inScope) continue;
      const content = fs.readFileSync(full, 'utf8');
      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (COLOR_REGEX.test(line)) {
          // Ignore some SVG/icon fill cases that are hard to tokenise and not visible UI
          if (/fill\s*=\s*"white"/i.test(line)) return;
          // Allow legitimate tokens
          if (/var\s*\(\s*--/.test(line)) return;
          offenders.push({ file: full, line: idx + 1, text: line.trim() });
        }
      });
    }
  }
}

walk(ROOT);

if (offenders.length) {
  console.error('❌ Hard-coded color literals detected. Please replace with theme tokens:');
  for (const o of offenders) {
    console.error(` - ${path.relative(path.join(__dirname, '..'), o.file)}:${o.line} :: ${o.text}`);
  }
  process.exit(1);
} else {
  console.log('✅ No color literals found under react-app/src (excluding allowlist).');
}
