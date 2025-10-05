/* eslint-disable max-len */
/* eslint-disable no-useless-escape */
const escape = (value) => {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const formatNumber = (value, fraction = 1) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num.toFixed(fraction);
};

const formatDurationFromSeconds = (seconds) => {
  const totalSeconds = Number(seconds);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;
  if (totalSeconds >= 3600) return `${(totalSeconds / 3600).toFixed(1)} h`;
  return `${Math.round(totalSeconds / 60)} min`;
};

const renderTaskHierarchyRows = (hierarchy) => {
  const rows = [];
  hierarchy.forEach((themeNode) => {
    const themeName = escape(themeNode.theme || 'General');
    themeNode.goals.forEach((goalNode) => {
      const goalLabel = goalNode.goalRef ? `${escape(goalNode.goalTitle)} (${escape(goalNode.goalRef)})` : escape(goalNode.goalTitle);
      goalNode.stories.forEach((storyNode) => {
        const storyLabel = storyNode.storyRef ? `${escape(storyNode.storyTitle)} (${escape(storyNode.storyRef)})` : escape(storyNode.storyTitle);
        storyNode.tasks.forEach((task) => {
          rows.push(`
            <tr>
              <td>${themeName}</td>
              <td>${goalLabel}</td>
              <td>${storyLabel}</td>
              <td><a href="${escape(task.deepLink)}" style="color:#2563eb;">${escape(task.ref)}</a></td>
              <td>${escape(task.description)}</td>
              <td>${escape(task.dueDateDisplay || '')}</td>
              <td>${escape(task.status)}</td>
              <td>${task.latestComment ? escape(task.latestComment) : ''}</td>
            </tr>
          `);
        });
      });
    });
  });
  if (!rows.length) {
    rows.push('<tr><td colspan="8" style="text-align:center;color:#6b7280;">No tasks due today 🎉</td></tr>');
  }
  return rows.join('\n');
};

const renderStoriesToStart = (stories) => {
  if (!stories.length) {
    return '<tr><td colspan="7" style="text-align:center;color:#6b7280;">No stories queued to start</td></tr>';
  }
  return stories
    .map((story) => {
      const latestComment = story.latestComment ? escape(story.latestComment) : null;
      const commentAt = story.latestCommentAt ? escape(story.latestCommentAt.slice(0, 16)) : null;
      const commentBlock = latestComment
        ? `<div>${latestComment}${commentAt ? ` <div style="font-size:12px;color:#6b7280;">${commentAt}</div>` : ''}</div>`
        : '<span style="color:#6b7280;">No recent discussion</span>';
      const acceptanceBlock = story.acceptanceCriteria && story.acceptanceCriteria.length
        ? `
            <ul style="padding-left:16px;margin:4px 0;">
              ${story.acceptanceCriteria.map((crit) => `<li>${escape(crit)}</li>`).join('')}
            </ul>
          `
        : '<span style="color:#b91c1c;">Missing</span>';
      return `
      <tr>
        <td><a href="${escape(story.deepLink)}" style="color:#2563eb;">${escape(story.ref)}</a></td>
        <td>${escape(story.title)}</td>
        <td>${escape(story.goal || '')}</td>
        <td>${escape(story.sprintDueDateDisplay || '')}</td>
        <td>${escape(story.status || '')}</td>
        <td>${commentBlock}</td>
        <td>
          ${acceptanceBlock}
        </td>
      </tr>
      `;
    })
    .join('\n');
};

const renderCalendarBlocks = (blocks) => {
  if (!blocks.length) return '<li>No calendar blocks scheduled.</li>';
  return blocks
    .map((block) => `
      <li>
        <strong>${escape(block.startDisplay || '')}</strong> → ${escape(block.endDisplay || '')}
        <div>${escape(block.title)}${block.linkedTask ? ` · <a href="${escape(block.linkedTask.deepLink)}" style="color:#2563eb;">${escape(block.linkedTask.ref)}</a>` : ''}${block.linkedStory ? ` · <a href="${escape(block.linkedStory.deepLink)}" style="color:#2563eb;">${escape(block.linkedStory.ref)}</a>` : ''}</div>
      </li>
    `)
    .join('\n');
};

const renderPriorities = (priorities, blocks) => {
  const items = priorities.length
    ? priorities
        .map((item) => `
          <li>
            <a href="${escape(item.deepLink)}" style="color:#2563eb; font-weight:600;">${escape(item.ref)}</a>
            <span style="color:#4b5563;"> – ${escape(item.title)}</span>
            ${item.dueDateDisplay ? `<div style="font-size:12px;color:#6b7280;">Due ${escape(item.dueDateDisplay)}</div>` : ''}
          </li>
        `)
        .join('\n')
    : '<li>Nothing critical – consider backlog grooming.</li>';

  return `
    <ol style="padding-left:20px;">${items}</ol>
    <h4 style="margin-top:16px;">Today\'s calendar blocks</h4>
    <ul style="padding-left:20px;">${renderCalendarBlocks(blocks)}</ul>
  `;
};

const renderWorldSummary = (world) => {
  if (!world) return '<p>No world summary available.</p>';
  const parts = [];
  if (world.summary) parts.push(`<p>${escape(world.summary)}</p>`);
  if (world.weather) parts.push(`<p><strong>Weather:</strong> ${escape(world.weather)}</p>`);
  if (world.source) parts.push(`<p style="font-size:12px;color:#6b7280;">Source: ${escape(world.source)}</p>`);
  return parts.join('\n');
};

const renderFitness = (fitness) => {
  if (!fitness) return '<p>No fitness metrics yet. Connect Strava/Apple Health to enable insights.</p>';
  const blocks = [];
  if (fitness.lastWorkout) {
    const workout = fitness.lastWorkout;
    const dist = workout.distance_m ? `${(Number(workout.distance_m) / 1000).toFixed(2)} km` : null;
    const duration = workout.duration_s ? `${Math.round(workout.duration_s / 60)} min` : null;
    blocks.push(`
      <p><strong>Last workout:</strong> ${escape(workout.title || workout.provider || 'Workout')} (${dist || 'n/a'}, ${duration || 'n/a'})</p>
    `);
  }
  if (fitness.hrv) {
    const value = fitness.hrv.value ? `${Number(fitness.hrv.value).toFixed(1)} ms` : null;
    blocks.push(`<p><strong>HRV reading:</strong> ${value || 'n/a'} (${escape(fitness.hrv.capturedAt || '')})</p>`);
  }
  if (fitness.totals) {
    const distance = formatNumber(fitness.totals.distanceKm, 1);
    const hours = formatNumber(fitness.totals.timeHours, 1);
    const sessions = Number(fitness.totals.sessions);
    const summary = [
      distance ? `${distance} km` : null,
      hours ? `${hours} h` : null,
      Number.isFinite(sessions) && sessions > 0 ? `${sessions} sessions` : null,
    ].filter(Boolean).join(' · ');
    if (summary) {
      const days = fitness.rangeDays || 90;
      blocks.push(`<p><strong>Volume (last ${escape(String(days))} days):</strong> ${escape(summary)}</p>`);
    }
  }
  if (fitness.last30 && (fitness.last30.distanceKm || fitness.last30.avgPaceMinPerKm)) {
    const distance30 = formatNumber(fitness.last30.distanceKm, 1);
    const pace = formatNumber(fitness.last30.avgPaceMinPerKm, 2);
    const workouts = Number(fitness.last30.workouts);
    const parts = [
      distance30 ? `${distance30} km` : null,
      pace ? `${pace} min/km` : null,
      Number.isFinite(workouts) && workouts > 0 ? `${workouts} sessions` : null,
    ].filter(Boolean).join(' · ');
    if (parts) {
      blocks.push(`<p><strong>Last 30 days:</strong> ${escape(parts)}</p>`);
    }
  }
  if (fitness.hrv && (fitness.hrv.last7Avg != null || fitness.hrv.last30Avg != null)) {
    const hrv7 = formatNumber(fitness.hrv.last7Avg, 1);
    const hrv30 = formatNumber(fitness.hrv.last30Avg, 1);
    const trend = formatNumber(fitness.hrv.trendPct, 1);
    const trendLabel = trend ? `${Number(fitness.hrv.trendPct) >= 0 ? '+' : ''}${trend}% vs 30-day` : null;
    const pieces = [
      hrv7 ? `7-day ${hrv7} ms` : null,
      hrv30 ? `30-day ${hrv30} ms` : null,
      trendLabel,
    ].filter(Boolean).join(' · ');
    if (pieces) {
      blocks.push(`<p><strong>HRV trend:</strong> ${escape(pieces)}</p>`);
    }
  }
  if (fitness.hrZones) {
    const labels = {
      z1Time_s: 'Z1',
      z2Time_s: 'Z2',
      z3Time_s: 'Z3',
      z4Time_s: 'Z4',
      z5Time_s: 'Z5',
    };
    const segments = Object.entries(labels)
      .map(([key, label]) => {
        const duration = formatDurationFromSeconds(fitness.hrZones[key]);
        return duration ? `${label} ${duration}` : null;
      })
      .filter(Boolean);
    if (segments.length) {
      blocks.push(`<p><strong>HR zones:</strong> ${escape(segments.join(' · '))}</p>`);
    }
  }
  if (fitness.fitnessScore != null) {
    blocks.push(`<p><strong>Fitness score:</strong> ${escape(fitness.fitnessScore)}</p>`);
  }
  if (fitness.alerts && fitness.alerts.length) {
    blocks.push(`
      <ul style="color:#b91c1c;">
        ${fitness.alerts.map((alert) => `<li>${escape(alert)}</li>`).join('')}
      </ul>
    `);
  }
  if (!blocks.length) blocks.push('<p>No recent fitness activity logged.</p>');
  return blocks.join('\n');
};

const renderSchedulerChanges = (changes) => {
  if (!Array.isArray(changes) || !changes.length) {
    return '';
  }
  const rows = changes
    .map((change) => `
      <tr>
        <td>${escape(change.itemRef || change.itemId || '')}</td>
        <td>${escape(change.previousDue || '')}</td>
        <td>${escape(change.newDue || '')}</td>
        <td>${escape(change.reason || '')}</td>
      </tr>
    `)
    .join('\n');
  return `
    <h3 style="margin:24px 0 8px;">Scheduler adjustments</h3>
    <table role="presentation" style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#f3f4f6;text-align:left;">
          <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Item</th>
          <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Previous due</th>
          <th style="padding:8px;border-bottom:1px solid #e5e7eb;">New due</th>
          <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Reason</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
};

const buildLinkLabel = (href, label) => {
  if (!label) return '';
  if (!href) return escape(label);
  return `<a href="${escape(href)}" style="color:#38bdf8;">${escape(label)}</a>`;
};

const renderConversionTable = (items) => {
  if (!items || !items.length) {
    return '<p style="color:#94a3b8;">No conversions recorded.</p>';
  }
  const rows = items
    .map((item) => {
      const taskLabel = [item.taskRef, item.taskTitle && item.taskTitle !== item.taskRef ? item.taskTitle : null]
        .filter(Boolean)
        .map((part) => escape(part))
        .join(' – ');
      const storyLabel = [item.storyRef, item.storyTitle && item.storyTitle !== item.storyRef ? item.storyTitle : null]
        .filter(Boolean)
        .map((part) => escape(part))
        .join(' – ');
      const created = item.createdAt ? escape(item.createdAt.slice(0, 16)) : 'n/a';
      const source = item.source ? escape(item.source) : 'manual';
      const acceptance = Number.isFinite(item.acceptanceCount)
        ? `${item.acceptanceCount}${item.acceptanceAutoFilled ? ' ✓' : ''}`
        : 'n/a';
      return `
        <tr>
          <td style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">${buildLinkLabel(item.taskDeepLink, taskLabel)}</td>
          <td style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">${buildLinkLabel(item.storyDeepLink, storyLabel)}</td>
          <td style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">${escape(item.actor || 'AI')}</td>
          <td style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">${escape(source)}</td>
          <td style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">${escape(acceptance)}</td>
          <td style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">${created}</td>
        </tr>
      `;
    })
    .join('\n');
  return `
    <table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px;color:#e2e8f0;">
      <thead>
        <tr style="background:rgba(148,163,184,0.15);text-align:left;">
          <th style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">Task</th>
          <th style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">Story</th>
          <th style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">Actor</th>
          <th style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">Source</th>
          <th style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">Acceptance</th>
          <th style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">Logged</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
};

const renderDuplicateTable = (items) => {
  if (!items || !items.length) {
    return '<p style="color:#94a3b8;">No dedupe activity.</p>';
  }
  const rows = items
    .map((item) => {
      const canonicalLabelParts = [item.canonical?.ref, item.canonical?.title && item.canonical?.title !== item.canonical?.ref ? item.canonical.title : null]
        .filter(Boolean)
        .map((part) => escape(part));
      if (item.canonical?.reminderId) {
        canonicalLabelParts.push(`<span style="color:#94a3b8;">Reminder ${escape(item.canonical.reminderId)}</span>`);
      }
      const canonicalLabel = canonicalLabelParts.join(' – ');

      const duplicatesList = (item.duplicates || [])
        .map((dup) => {
          const parts = [dup.ref || dup.id, dup.title && dup.title !== dup.ref ? dup.title : null]
            .filter(Boolean)
            .map((part) => escape(part));
          if (dup.reminderId) {
            parts.push(`<span style="color:#94a3b8;">Reminder ${escape(dup.reminderId)}</span>`);
          }
          return `<li>${parts.join(' – ')}</li>`;
        })
        .join('');

      const keys = (item.keys || []).map((key) => `<code style="background:rgba(30,41,59,0.6);padding:2px 4px;border-radius:4px;color:#e2e8f0;">${escape(key)}</code>`).join(' ');
      const created = item.createdAt ? escape(item.createdAt.slice(0, 16)) : 'n/a';
      const resolution = item.hardDelete ? 'Hard delete' : 'Completed';

      return `
        <tr>
          <td style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">${buildLinkLabel(item.canonical?.deepLink, canonicalLabel)}</td>
          <td style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">
            <ul style="margin:0;padding-left:16px;">${duplicatesList}</ul>
          </td>
          <td style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">${keys || '<span style="color:#94a3b8;">n/a</span>'}</td>
          <td style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">${escape(item.actor || 'AI')}</td>
          <td style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">${escape(resolution)}</td>
          <td style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">${created}</td>
        </tr>
      `;
    })
    .join('\n');

  return `
    <table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px;color:#e2e8f0;">
      <thead>
        <tr style="background:rgba(148,163,184,0.15);text-align:left;">
          <th style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">Canonical task</th>
          <th style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">Duplicates resolved</th>
          <th style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">Keys</th>
          <th style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">Actor</th>
          <th style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">Outcome</th>
          <th style="padding:8px;border-bottom:1px solid rgba(148,163,184,0.3);">Logged</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
};

const renderDailySummaryEmail = (data) => {
  const profileName = data.profile?.displayName || data.profile?.name || data.profile?.email || 'BOB Member';
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Daily Summary</title>
  </head>
  <body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
    <div style="max-width:640px;margin:0 auto;padding:24px;">
      <header style="text-align:center;padding:24px;border-radius:12px;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;">
        <h1 style="margin:0;font-size:24px;">Good morning, ${escape(profileName)} ☀️</h1>
        <p style="margin:8px 0 0;">Here\'s your blended summary for ${escape(data.metadata.dayIso || '')}</p>
      </header>

      <section style="margin-top:24px;background:#fff;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <h2 style="margin-top:0;font-size:18px;color:#1f2937;">Tasks due today</h2>
        <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead>
            <tr style="background:#f3f4f6;text-align:left;">
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Theme</th>
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Goal</th>
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Story</th>
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Ref</th>
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Task</th>
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Due</th>
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Status</th>
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Latest comment</th>
            </tr>
          </thead>
          <tbody>
            ${renderTaskHierarchyRows(data.hierarchy || [])}
          </tbody>
        </table>
      </section>

      <section style="margin-top:24px;background:#fff;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <h2 style="margin-top:0;font-size:18px;color:#1f2937;">Stories to start</h2>
        <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead>
            <tr style="background:#f3f4f6;text-align:left;">
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Ref</th>
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Story</th>
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Goal</th>
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Sprint due</th>
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Status</th>
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Latest comment</th>
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Acceptance criteria</th>
            </tr>
          </thead>
          <tbody>
            ${renderStoriesToStart(data.storiesToStart || [])}
          </tbody>
        </table>
      </section>

      <section style="margin-top:24px;background:#fff;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <h2 style="margin-top:0;font-size:18px;color:#1f2937;">Priorities</h2>
        ${renderPriorities(data.priorities || [], data.calendarBlocks || [])}
      </section>

      ${renderSchedulerChanges(data.schedulerChanges)}

      <section style="margin-top:24px;background:#fff;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <h2 style="margin-top:0;font-size:18px;color:#1f2937;">World summary</h2>
        ${renderWorldSummary(data.worldSummary)}
      </section>

      <section style="margin-top:24px;background:#fff;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <h2 style="margin-top:0;font-size:18px;color:#1f2937;">Fitness</h2>
        ${renderFitness(data.fitness)}
      </section>

      <footer style="margin-top:24px;text-align:center;color:#6b7280;font-size:12px;">
        <p>Need to tweak this summary or unsubscribe? <a href="https://app.bob/notifications" style="color:#2563eb;">Manage notifications</a>.</p>
        <p>Generated at ${escape(data.metadata.generatedAt || '')} (${escape(data.metadata.timezone || '')}).</p>
      </footer>
    </div>
  </body>
</html>
  `;
};

const renderDataQualityEmail = ({ profile, snapshot }) => {
  const renderList = (items, fallback) => {
    if (!items || !items.length) return `<li>${escape(fallback)}</li>`;
    return items
      .map((item) => {
        const ref = item.ref || item.storyRef || item.taskRef || item.id;
        const title = item.title || item.description || item.message || ref;
        const link = item.deepLink || (ref ? `/story/${ref}` : null);
        return `<li>${link ? `<a href="${escape(link)}" style="color:#38bdf8;">${escape(ref)}</a>` : escape(ref || '')} – ${escape(title || '')}</li>`;
      })
      .join('\n');
  };

  const summary = snapshot.summaryStats || {};
  const conversionsHtml = renderConversionTable(snapshot.conversions || []);
  const duplicatesHtml = renderDuplicateTable(snapshot.dedupes || []);

  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Data Quality Report</title>
  </head>
  <body style="margin:0;padding:0;background:#0f172a;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:24px;">
      <header style="padding:24px;border-radius:12px;background:linear-gradient(135deg,#f97316,#db2777);">
        <h1 style="margin:0;font-size:24px;">Data Quality Audit ⚙️</h1>
        <p style="margin:8px 0 0;color:#fde68a;">Window ${escape(snapshot.window.startIso || '')} → ${escape(snapshot.window.endIso || '')}</p>
      </header>

      <section style="margin-top:24px;background:#1e293b;border-radius:12px;padding:20px;border:1px solid rgba(148,163,184,0.2);">
        <h2 style="margin-top:0;font-size:18px;color:#f1f5f9;">Summary</h2>
        <ul>
          <li><strong>${summary.conversions || 0}</strong> task → story conversions</li>
          <li><strong>${summary.dedupes || 0}</strong> duplicates resolved</li>
          <li><strong>${summary.missingAcceptance || 0}</strong> stories missing acceptance criteria</li>
          <li><strong>${summary.missingGoalLink || 0}</strong> stories missing goal linkage</li>
          <li><strong>${summary.errors || 0}</strong> errors flagged</li>
        </ul>
      </section>

      <section style="margin-top:24px;background:#1e293b;border-radius:12px;padding:20px;border:1px solid rgba(148,163,184,0.2);">
        <h3 style="margin-top:0;color:#f8fafc;">Conversions</h3>
        ${conversionsHtml}
        <h3 style="margin-top:24px;color:#f8fafc;">Duplicates</h3>
        ${duplicatesHtml}
        <h3 style="margin-top:24px;color:#f8fafc;">Missing acceptance criteria</h3>
        <ul>${renderList(snapshot.missingAcceptance, 'All stories have acceptance criteria')}</ul>
        <h3 style="margin-top:24px;color:#f8fafc;">Stories without goal linkage</h3>
        <ul>${renderList(snapshot.missingGoalLink, 'No linkage gaps detected')}</ul>
        ${snapshot.errors && snapshot.errors.length ? `
          <h3 style="margin-top:24px;color:#f87171;">Errors</h3>
          <ul>${renderList(snapshot.errors, 'No automation errors')}</ul>
        ` : ''}
      </section>

      <footer style="margin-top:24px;text-align:center;color:#94a3b8;font-size:12px;">
        <p>Need to investigate or re-run checks? Launch the automation console or trigger the callable.</p>
        <p>Recipient: ${escape(profile?.email || profile?.displayName || 'Unknown')}</p>
      </footer>
    </div>
  </body>
</html>
  `;
};

module.exports = {
  renderDailySummaryEmail,
  renderDataQualityEmail,
};
