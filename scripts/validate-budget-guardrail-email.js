#!/usr/bin/env node

const path = require('path');

const templates = require(path.resolve(__dirname, '../functions/lib/templates.js'));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const html = templates.renderDailySummaryEmail({
    profile: { displayName: 'Tester' },
    metadata: {
      dayIso: '2026-03-11',
      generatedAt: new Date().toISOString(),
      timezone: 'Europe/London',
    },
    dashboardAlerts: [
      {
        type: 'budget_guardrail',
        severity: 'warning',
        title: 'Budget guardrail',
        discretionarySharePct: 65,
        monthElapsedPct: 30,
        message: 'Progress is 82% against linked KPI targets.',
      },
    ],
    dailyBrief: null,
    activeWorkItems: [],
    calendarBlocks: [],
    plannerBlocks: [],
  });

  assert(
    html.includes('Discretionary spend is 65% with 30% of the month elapsed.'),
    'Budget guardrail line did not render expected month-progress wording.'
  );

  assert(
    !html.includes('linked KPI targets'),
    'Budget guardrail section leaked KPI wording.'
  );

  assert(
    !html.includes('Focus goal'),
    'Budget guardrail section leaked focus-goal wording.'
  );

  console.log('Budget guardrail email wording validation passed.');
}

try {
  run();
} catch (error) {
  console.error('Budget guardrail email wording validation failed:', error.message || error);
  process.exit(1);
}
