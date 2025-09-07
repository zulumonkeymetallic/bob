#!/usr/bin/env node
/*
 Creates GitHub issues for the listed enhancements using GITHUB_TOKEN and repo envs.
 Usage:
   GITHUB_TOKEN=xxx GITHUB_REPOSITORY=owner/repo node scripts/create-enhancement-issues.js
*/
const https = require('https');

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY; // e.g. owner/name
if (!token || !repo) {
  console.error('Missing GITHUB_TOKEN or GITHUB_REPOSITORY');
  process.exit(1);
}

const issues = [
  {
    title: 'Gantt: Goal card wrapping + double-click to edit',
    body: `Implement multi-line wrap for goal titles and open Edit Goal on double-click.

Files:
- react-app/src/components/visualization/ThemeBasedGanttChart.tsx
- react-app/src/components/visualization/EnhancedGanttChart.css
` ,
    labels: ['enhancement','gantt','ui']
  },
  {
    title: 'Gantt: Drag/resize persists dates + theme row reassignment',
    body: `Move/resizing a goal updates Firestore startDate/endDate and reassigns theme when dragged across theme rows.

Files:
- react-app/src/components/visualization/ThemeBasedGanttChart.tsx
` ,
    labels: ['enhancement','gantt','drag-drop']
  },
  {
    title: 'Gantt: Current sprint header under month timeline',
    body: `Show the active sprint spanning under the month header aligned to sprint dates.

Files:
- react-app/src/components/visualization/ThemeBasedGanttChart.tsx
` ,
    labels: ['enhancement','gantt','sprint']
  },
  {
    title: 'Gantt: Zoom by ctrl+wheel and pinch gestures',
    body: `Support zooming between day/week/month/quarter using ctrl/cmd + wheel and two-finger pinch on touch.

Files:
- react-app/src/components/visualization/ThemeBasedGanttChart.tsx
` ,
    labels: ['enhancement','gantt','interaction']
  },
  {
    title: 'Gantt: Auto-center timeline on Today on mount and zoom changes',
    body: `Scroll container to center Today marker on initial load and when zoom changes.` ,
    labels: ['enhancement','gantt','usability']
  },
  {
    title: 'Gantt: Linked Stories pane under chart (ModernStoriesTable)',
    body: `When clicking a goal card, show a ModernStoriesTable listing all linked stories for that goal under the chart.

Files:
- react-app/src/components/visualization/ThemeBasedGanttChart.tsx
` ,
    labels: ['enhancement','gantt','stories']
  }
];

function createIssue(issue) {
  return new Promise((resolve, reject) => {
    const [owner, repoName] = repo.split('/');
    const data = JSON.stringify({ title: issue.title, body: issue.body, labels: issue.labels });
    const opts = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repoName}/issues`,
      method: 'POST',
      headers: {
        'User-Agent': 'create-issues-script',
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`Created issue: ${issue.title}`);
          resolve();
        } else {
          console.error('Failed:', res.statusCode, body);
          reject(new Error('Failed to create issue'));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  for (const issue of issues) {
    await createIssue(issue);
  }
  console.log('All enhancement issues created.');
})().catch(e => { console.error(e); process.exit(1); });

