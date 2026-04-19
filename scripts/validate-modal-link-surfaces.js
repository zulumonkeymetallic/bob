#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const TARGETS = [
  'react-app/src/components/checkins/CheckInDaily.tsx',
  'react-app/src/components/HabitsChoresDashboard.tsx',
  'react-app/src/components/Calendar.tsx',
  'react-app/src/components/JournalsManagement.tsx',
];

const FORBIDDEN_PATTERNS = [
  /<\s*Link\b[^>]*\bto\s*=\s*["']\/(tasks|stories)\//g,
  /<\s*RouterLink\b[^>]*\bto\s*=\s*["']\/(tasks|stories)\//g,
  /href\s*=\s*["']\/(tasks|stories)\//g,
];

function gatherOffenses(filePath, content) {
  const offenses = [];
  FORBIDDEN_PATTERNS.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const idx = match.index;
      const prefix = content.slice(0, idx);
      const line = prefix.split('\n').length;
      const snippet = content.slice(idx, idx + 120).replace(/\s+/g, ' ').trim();
      offenses.push({ line, snippet });
    }
  });
  return offenses.map((entry) => ({ filePath, ...entry }));
}

function run() {
  const allOffenses = [];

  TARGETS.forEach((relative) => {
    const filePath = path.join(ROOT, relative);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing target file: ${relative}`);
    }
    const content = fs.readFileSync(filePath, 'utf8');
    allOffenses.push(...gatherOffenses(relative, content));
  });

  if (allOffenses.length > 0) {
    console.error('Modal-link regression failed. Found route navigation links for tasks/stories:');
    allOffenses.forEach((offense, i) => {
      console.error(`${i + 1}. ${offense.filePath}:${offense.line}`);
      console.error(`   ${offense.snippet}`);
    });
    process.exit(1);
  }

  console.log('Modal-link regression passed. No /tasks or /stories route links found in protected surfaces.');
}

try {
  run();
} catch (error) {
  console.error('Modal-link regression validator failed:', error.message || error);
  process.exit(1);
}
