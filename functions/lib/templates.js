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

const formatCurrency = (value, currency = 'GBP') => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const rounded = num.toFixed(2);
  if (currency === 'GBP') return `£${rounded}`;
  if (currency === 'USD') return `$${rounded}`;
  if (currency === 'EUR') return `€${rounded}`;
  return `${currency} ${rounded}`;
};

const formatPence = (pence, currency = 'GBP') => {
  const num = Number(pence);
  if (!Number.isFinite(num)) return null;
  return formatCurrency(num / 100, currency);
};

const FINANCE_BUCKET_LABELS = {
  mandatory: 'Mandatory',
  discretionary: 'Discretionary',
  optional: 'Discretionary',
  savings: 'Savings',
  short_saving: 'Short-term Saving',
  long_saving: 'Long-term Saving',
  investment: 'Investment',
  debt_repayment: 'Debt Repayment',
  income: 'Income',
  net_salary: 'Net Salary',
  irregular_income: 'Irregular Income',
  bank_transfer: 'Transfers',
  unknown: 'Uncategorised',
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
    ? priorities.slice(0, 3)
        .map((item) => {
          const typeLabel = item.type === 'story' ? 'Story' : 'Task';
          const ref = item.ref || item.title || typeLabel;
          const link = item.deepLink
            ? `<a href="${escape(item.deepLink)}" style="color:#2563eb;font-weight:700;">${escape(ref)}</a>`
            : `<span style="font-weight:700;color:#111827;">${escape(ref)}</span>`;
          const scoreBits = [];
          const scoreRounded = Number.isFinite(Number(item.score)) ? Math.round(Number(item.score)) : null;
          const priorityRounded = Number.isFinite(Number(item.priorityScore)) ? Math.round(Number(item.priorityScore)) : null;
          const urgencyRounded = Number.isFinite(Number(item.urgencyScore)) ? Math.round(Number(item.urgencyScore)) : null;
          if (scoreRounded != null) scoreBits.push(`Score ${scoreRounded}`);
          if (priorityRounded != null) scoreBits.push(`Priority ${priorityRounded}`);
          if (urgencyRounded != null) scoreBits.push(`Urgency ${urgencyRounded}`);
          const score = scoreBits.length
            ? `<span style="margin-left:6px;padding:2px 8px;border-radius:999px;background:#eef2ff;color:#4338ca;font-size:12px;">${scoreBits.join(' · ')}</span>`
            : '';
          const due = item.dueDateDisplay ? `<span style="color:#6b7280;font-size:12px;"> · Due ${escape(item.dueDateDisplay)}</span>` : '';
          return `
          <li style="margin-bottom:10px;line-height:1.5;">
            <span style="display:inline-block;margin-right:8px;padding:2px 8px;border-radius:999px;background:#ecfeff;color:#0ea5e9;font-size:12px;">${escape(typeLabel)}</span>
            ${link}
            <span style="color:#4b5563;"> — ${escape(item.title || '')}</span>
            ${score}${due}
          </li>
          `;
        })
        .join('\n')
    : '<li>Nothing critical – consider backlog grooming.</li>';

  return `
    <ol style="padding-left:20px;margin:0 0 8px;">${items}</ol>
    <h4 style="margin-top:16px;">Today\'s calendar blocks</h4>
    <ul style="padding-left:20px;">${renderCalendarBlocks(blocks)}</ul>
  `;
};

const renderAiFocus = (focus) => {
  if (!focus || !Array.isArray(focus.items) || focus.items.length === 0) {
    return '<p style="color:#6b7280;">No AI focus yet—once tasks/stories are scored, you’ll see today’s top three with due dates and links.</p>';
  }

  const intro = focus.summary
    ? `<p style="margin:0 0 12px;">${escape(focus.summary)}</p>`
    : '<p style="margin:0 0 12px;">AI triaged your day. Start with these three, in order:</p>';

  const itemsHtml = focus.items
    .slice(0, 3)
    .map((item, idx) => {
      const rank = idx + 1;
      const bucketChip = item.bucket
        ? `<span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;background:#eef2ff;color:#4338ca;font-size:12px;">${escape(item.bucket)}</span>`
        : '';
      const label = [item.ref, item.title].filter(Boolean).join(' — ');
      const link = item.deepLink
        ? `<a href="${escape(item.deepLink)}" style="color:#2563eb;font-weight:600;">${escape(label)}</a>`
        : `<span style="font-weight:600;color:#111827;">${escape(label)}</span>`;
      const confidence = Number.isFinite(item.confidence) ? Math.round(item.confidence * 100) : null;
      return `
        <li style="margin-bottom:14px;">
          <div style="font-weight:700;color:#111827;">#${rank} ${link}${bucketChip}</div>
          <div style="color:#1f2937;">${escape(item.title || '')}</div>
          ${item.reason ? `<div style="font-size:13px;color:#4b5563;">Why: ${escape(item.reason)}</div>` : ''}
          ${item.nextStep ? `<div style="font-size:13px;color:#111827;">Next: ${escape(item.nextStep)}</div>` : ''}
          ${item.dueDisplay ? `<div style="font-size:12px;color:#6b7280;">Due ${escape(item.dueDisplay)}</div>` : ''}
          ${confidence != null ? `<div style="font-size:12px;color:#6b7280;">Confidence ${escape(String(confidence))}%</div>` : ''}
        </li>
      `;
    })
    .join('\n');

  const ask = focus.ask ? `<p style="margin-top:16px;font-weight:600;">Ask: ${escape(focus.ask)}</p>` : '';
  const attribution = `<p style="margin-top:12px;font-size:12px;color:#9ca3af;">${focus.mode === 'fallback' ? 'Heuristic focus (AI unavailable).' : `Generated by ${escape(focus.model || 'AI Assistant')}`} ${focus.generatedAt ? `· ${escape(focus.generatedAt)}` : ''}</p>`;

  return `${intro}<ol style="padding-left:20px;margin:0;">${itemsHtml}</ol>${ask}${attribution}`;
};

/**
 * Render the daily briefing block as HTML.
 * @param {Object} briefing - Briefing payload produced by the AI assistant or heuristics.
 * @param {('ai'|'fallback')} [briefing.mode] - Generation mode; 'ai' for model output or 'fallback' for heuristic.
 * @param {string} [briefing.model] - Model identifier used to generate the briefing.
 * @param {string} [briefing.generatedAt] - ISO timestamp for when the briefing was generated.
 * @param {Array<{ title?: string, description?: string, tips?: string[] }>} [briefing.items] - Bullet items with optional tips.
 * @returns {string} HTML string safe to embed into email templates.
 */
const renderDailyBriefing = (briefing) => {
  if (!briefing) {
    return '<p style="color:#6b7280;">Daily briefing will appear once the nightly automation runs.</p>';
  }
  const headline = briefing.headline
    ? `<p style="margin:0 0 8px;font-weight:600;font-size:16px;color:#111827;">${escape(briefing.headline)}</p>`
    : '';
  const body = briefing.body
    ? `<p style="margin:0 0 8px;color:#1f2937;">${escape(briefing.body)}</p>`
    : '';
  const checklist = briefing.checklist
    ? `<p style="margin:0;color:#4b5563;font-size:13px;">${escape(briefing.checklist)}</p>`
    : '';
  const attribution = `<p style="margin-top:12px;font-size:12px;color:#9ca3af;">${briefing.mode === 'fallback' ? 'Heuristic summary' : `Generated by ${escape(briefing.model || 'AI Assistant')}`} ${briefing.generatedAt ? `· ${escape(briefing.generatedAt)}` : ''}</p>`;
  return `${headline}${body}${checklist}${attribution}`;
};

const renderMaintenanceSummary = (maintenance) => {
  if (!maintenance) {
    return '<p style="color:#6b7280;">No automation summary available.</p>';
  }

  const parts = [];
  if (maintenance.reminders && maintenance.reminders.groupsCreated != null) {
    parts.push(`<li>${escape(String(maintenance.reminders.groupsCreated))} reminder duplicate groups flagged</li>`);
  }
  if (maintenance.dedupe) {
    parts.push(`<li>${escape(String(maintenance.dedupe.resolved || 0))} duplicate tasks merged (processed ${escape(String(maintenance.dedupe.processed || 0))})</li>`);
  }
  if (maintenance.dueDates) {
    parts.push(`<li>${escape(String(maintenance.dueDates.adjustedTop || 0))} tasks pulled into today/tomorrow; ${escape(String(maintenance.dueDates.deferred || 0))} deferred</li>`);
  }
  if (maintenance.conversions) {
    parts.push(`<li>${escape(String(maintenance.conversions.converted || 0))} oversized tasks converted to stories</li>`);
  }
  if (maintenance.calendar) {
    parts.push(`<li>${escape(String(maintenance.calendar.planned || 0))} calendar blocks scheduled (${escape(String(maintenance.calendar.unscheduled || 0))} pending)</li>`);
  }
  const listHtml = parts.length ? `<ul style="margin:0;padding-left:20px;">${parts.join('')}</ul>` : '<p style="color:#6b7280;">No notable automation changes.</p>';

  const topItems = Array.isArray(maintenance.priority?.top) ? maintenance.priority.top.slice(0, 5) : [];
  const topHtml = topItems.length
    ? `<ol style="margin-top:12px;padding-left:20px;">${topItems.map((item) => `
        <li>
          <span style="font-weight:600;color:#111827;">${escape(item.title || item.taskId || item.id || 'Task')}</span>
          ${item.bucket ? `<span style="margin-left:8px;padding:2px 8px;border-radius:999px;background:#fee2e2;color:#b91c1c;font-size:12px;">${escape(item.bucket)}</span>` : ''}
          ${item.score != null ? `<div style="font-size:12px;color:#6b7280;">Score ${escape(String(item.score))}</div>` : ''}
        </li>
      `).join('')}</ol>`
    : '';

  const generatedAt = maintenance.completedAt ? `<p style="margin-top:12px;font-size:12px;color:#9ca3af;">Completed ${escape(maintenance.completedAt)}</p>` : '';

  return `${listHtml}${topHtml}${generatedAt}`;
};

const renderWorldSummary = (world) => {
  if (!world) return '<p>No world summary available.</p>';
  const parts = [];
  if (world.summary) parts.push(`<p>${escape(world.summary)}</p>`);
  if (world.weather) parts.push(`<p><strong>Weather:</strong> ${escape(world.weather)}</p>`);
  if (world.source) parts.push(`<p style="font-size:12px;color:#6b7280;">Source: ${escape(world.source)}</p>`);
  return parts.join('\n');
};

const renderSchedule = (blocks) => {
  if (!Array.isArray(blocks) || !blocks.length) {
    return '<p style="color:#6b7280;">No calendar blocks scheduled today.</p>';
  }
  const items = blocks
    .slice(0, 5)
    .map((block) => {
      const title = block.title || block.category || 'Block';
      const time = block.startDisplay || block.startIso || '';
      const theme = block.theme ? `<span style="margin-left:8px;font-size:12px;padding:2px 8px;border-radius:999px;background:#dbebff;color:#1d4ed8;">${escape(block.theme)}</span>` : '';
      const linkTask = block.linkedTask ? ` · <a href="${escape(block.linkedTask.deepLink)}" style="color:#2563eb;">${escape(block.linkedTask.ref)}</a>` : '';
      const linkStory = block.linkedStory ? ` · <a href="${escape(block.linkedStory.deepLink)}" style="color:#2563eb;">${escape(block.linkedStory.ref)}</a>` : '';
      return `<li><strong>${escape(time)}</strong> — ${escape(title)}${theme}${linkTask}${linkStory}</li>`;
    })
    .join('\n');
  return `<ul style="padding-left:20px;">${items}</ul>`;
};

const renderPlannerOutput = (summary, blocks) => {
  if (!summary || !Array.isArray(blocks) || !blocks.length) {
    return '<p style="color:#6b7280;">No AI planner blocks were created for today.</p>';
  }

  const themeRows = summary.byTheme && summary.byTheme.length
    ? summary.byTheme
      .map((row) => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${escape(row.theme || 'General')}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${escape(formatNumber(row.hours || 0, 1) || '0.0')} h</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${escape(row.count || 0)}</td>
        </tr>
      `).join('\n')
    : '<tr><td colspan="3" style="padding:8px;color:#6b7280;text-align:center;">No theme breakdown available.</td></tr>';

  const maxRows = 12;
  const blockRows = blocks.slice(0, maxRows).map((block) => {
    const timeLabel = [block.startDisplay, block.endDisplay].filter(Boolean).join(' – ');
    const goal = block.linkedGoal;
    const story = block.linkedStory;
    const task = block.linkedTask;
    const entity = task || story || null;
    const goalLabel = goal
      ? `${escape(goal.title || 'Goal')}${goal.ref ? ` (${escape(goal.ref)})` : ''}`
      : '—';
    const goalLink = goal?.deepLink
      ? `<a href="${escape(goal.deepLink)}" style="color:#2563eb;">${goalLabel}</a>`
      : goalLabel;
    const entityLabel = entity
      ? `${escape(entity.ref || '')}${entity.ref ? ' — ' : ''}${escape(block.title || '')}`
      : escape(block.title || '');
    const entityLink = entity?.deepLink
      ? `<a href="${escape(entity.deepLink)}" style="color:#2563eb;">${entityLabel}</a>`
      : entityLabel || '—';
    const bobLink = block.deepLink
      ? `<a href="${escape(block.deepLink)}" style="color:#2563eb;">BOB</a>`
      : '';
    const gcalLink = block.googleLink
      ? `<a href="${escape(block.googleLink)}" style="color:#2563eb;">GCal</a>`
      : '';
    const links = [bobLink, gcalLink].filter(Boolean).join(' · ') || '—';
    return `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${escape(timeLabel || '')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${escape(block.theme || 'General')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${goalLink}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${entityLink}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${links}</td>
      </tr>
    `;
  }).join('\n');

  const truncatedNote = blocks.length > maxRows
    ? `<div style="margin-top:8px;color:#6b7280;font-size:12px;">Showing ${maxRows} of ${blocks.length} planner blocks.</div>`
    : '';

  return `
    <div style="margin-bottom:12px;color:#111827;">
      <strong>${escape(summary.totalBlocks || 0)}</strong> blocks •
      <strong>${escape(formatNumber(summary.totalHours || 0, 1) || '0.0')} h</strong> scheduled by the planner today.
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px;">
      <thead>
        <tr>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Theme</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Hours</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Blocks</th>
        </tr>
      </thead>
      <tbody>${themeRows}</tbody>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Time</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Theme</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Goal</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Story/Task</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Links</th>
        </tr>
      </thead>
      <tbody>${blockRows}</tbody>
    </table>
    ${truncatedNote}
  `;
};

const renderKpiSummary = (kpis) => {
  if (!kpis) return '<p style="color:#6b7280;">No KPI metrics available.</p>';
  const cards = [];
  if (kpis.sprint) {
    const progress = kpis.sprint.percentComplete != null ? `${kpis.sprint.percentComplete}%` : 'n/a';
    const daysLeft = kpis.sprint.daysRemaining != null ? `${kpis.sprint.daysRemaining} days left` : 'Days remaining n/a';
    const status = kpis.sprint.status ? kpis.sprint.status : 'Status n/a';
    const bar = kpis.sprint.percentComplete != null
      ? `<div style="height:6px;border-radius:999px;background:#e5e7eb;overflow:hidden;"><div style="width:${Math.min(kpis.sprint.percentComplete, 100)}%;background:#2563eb;height:6px;"></div></div>`
      : '';
    cards.push(`
      <div style="border:1px solid #e5e7eb;border-radius:12px;padding:12px;">
        <div style="font-size:12px;color:#6b7280;">Sprint</div>
        <div style="font-weight:700;color:#111827;margin:4px 0;">${escape(kpis.sprint.name || 'Active sprint')}</div>
        <div style="font-size:13px;color:#374151;">${escape(progress)} · ${escape(daysLeft)}</div>
        <div style="font-size:12px;color:${kpis.sprint.status === 'Behind' ? '#b91c1c' : '#059669'};margin-top:4px;">${escape(status)}</div>
        ${bar}
      </div>
    `);
  }
  if (kpis.fitness) {
    cards.push(`
      <div style="border:1px solid #e5e7eb;border-radius:12px;padding:12px;">
        <div style="font-size:12px;color:#6b7280;">Fitness score</div>
        <div style="font-weight:700;color:#111827;margin:6px 0;">${escape(String(kpis.fitness.score))}</div>
        <div style="font-size:12px;color:#6b7280;">From last 90 days</div>
      </div>
    `);
  }
  if (kpis.budget) {
    const remaining = formatCurrency(kpis.budget.remaining, kpis.budget.currency) || 'n/a';
    const total = formatCurrency(kpis.budget.totalBudget, kpis.budget.currency) || 'n/a';
    const used = kpis.budget.utilisation != null ? `${kpis.budget.utilisation}% used` : 'Utilisation n/a';
    const bar = kpis.budget.utilisation != null
      ? `<div style="height:6px;border-radius:999px;background:#e5e7eb;overflow:hidden;"><div style="width:${Math.min(kpis.budget.utilisation, 100)}%;background:#f59e0b;height:6px;"></div></div>`
      : '';
    cards.push(`
      <div style="border:1px solid #e5e7eb;border-radius:12px;padding:12px;">
        <div style="font-size:12px;color:#6b7280;">Budget remaining</div>
        <div style="font-weight:700;color:#111827;margin:6px 0;">${escape(remaining)}</div>
        <div style="font-size:12px;color:#6b7280;">${escape(used)} · ${escape(total)} total</div>
        ${bar}
      </div>
    `);
  }
  if (!cards.length) return '<p style="color:#6b7280;">No KPI metrics available.</p>';
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;">${cards.join('')}</div>`;
};

const renderGoalKpiStatusTable = (goalKpiStatus) => {
  const rows = Array.isArray(goalKpiStatus?.rows) ? goalKpiStatus.rows : [];
  if (!rows.length) {
    return '<p style="color:#6b7280;">No active sprint goals with KPI status available.</p>';
  }
  const sprintName = goalKpiStatus?.sprintName || 'Active sprint';
  const expectedLabel = Number.isFinite(Number(goalKpiStatus?.expectedProgressPct))
    ? `${Math.round(Number(goalKpiStatus.expectedProgressPct))}% expected`
    : 'Expected progress n/a';
  const maxRows = 25;
  const body = rows.slice(0, maxRows).map((row) => {
    const goalRef = row.goalRef ? `${escape(row.goalRef)} — ` : '';
    const goalLabel = `${goalRef}${escape(row.goalTitle || row.goalId || 'Goal')}`;
    const goalCell = row.goalDeepLink
      ? `<a href="${escape(row.goalDeepLink)}" style="color:#2563eb;">${goalLabel}</a>`
      : goalLabel;
    const progress = Number.isFinite(Number(row.progressPct)) ? `${Math.round(Number(row.progressPct))}%` : 'n/a';
    const status = String(row.status || 'No KPI');
    const statusColor = status === 'Behind' ? '#b91c1c' : status === 'On target' ? '#059669' : '#6b7280';
    return `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${goalCell}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escape(row.kpiSummary || 'No KPI attached')}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escape(progress)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;color:${statusColor};font-weight:700;">${escape(status)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escape(row.reason || '')}</td>
      </tr>
    `;
  }).join('\n');
  const overflow = rows.length > maxRows
    ? `<div style="margin-top:8px;color:#6b7280;font-size:12px;">Showing ${maxRows} of ${rows.length} goals.</div>`
    : '';
  return `
    <div style="margin-bottom:10px;color:#374151;font-size:13px;">
      <strong>${escape(sprintName)}</strong> • ${escape(expectedLabel)}
    </div>
    <table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#f3f4f6;text-align:left;">
          <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Goal</th>
          <th style="padding:8px;border-bottom:1px solid #e5e7eb;">KPI attached</th>
          <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Progress</th>
          <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Status</th>
          <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Why</th>
        </tr>
      </thead>
      <tbody>
        ${body}
      </tbody>
    </table>
    ${overflow}
  `;
};

const renderPriorityNarrative = (narrative) => {
  if (!narrative) {
    return '<p style="color:#6b7280;">No prioritization narrative yet. Run the nightly chain to generate.</p>';
  }
  const summary = narrative.summary ? `<p style="margin:0 0 12px;">${escape(narrative.summary)}</p>` : '';
  const ask = narrative.ask ? `<p style="margin:0;font-weight:600;">Ask: ${escape(narrative.ask)}</p>` : '';
  const attribution = `<p style="margin-top:12px;font-size:12px;color:#9ca3af;">${narrative.mode === 'fallback' ? 'Heuristic prioritization.' : `Generated by ${escape(narrative.model || 'AI')}`} ${narrative.generatedAt ? `· ${escape(narrative.generatedAt)}` : ''}</p>`;
  return `${summary}${ask}${attribution}`;
};

const renderActiveWorklist = (items, narrative) => {
  if (!Array.isArray(items) || !items.length) {
    return '<p style="color:#6b7280;">No active sprint items to display.</p>';
  }
  const modelHint = items.find((item) => item.aiTextModel)?.aiTextModel || null;
  const modelLabel = modelHint || narrative?.model || null;
  const note = modelLabel
    ? `<p style="margin:0 0 8px;font-size:12px;color:#6b7280;">AI priority scores include text analysis (${escape(modelLabel)}).</p>`
    : '';
  const rows = items
    .slice(0, 12)
    .map((item) => {
      const ref = item.ref || item.title || 'Item';
      const link = item.deepLink
        ? `<a href="${escape(item.deepLink)}" style="color:#2563eb;">${escape(ref)}</a>`
        : escape(ref);
      const score = item.aiScore != null ? Math.round(Number(item.aiScore)) : '—';
      const model = item.aiTextModel || modelLabel;
      const scoreLabel = model ? `${score} (${escape(model)})` : String(score);
      const reason = item.aiReason ? escape(item.aiReason) : 'Active sprint priority.';
      return `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${link}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escape(item.title || '')}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escape(item.type || '')}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escape(item.theme || '')}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${scoreLabel}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${reason}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escape(item.dueDisplay || '')}</td>
        </tr>
      `;
    })
    .join('\n');
  return `
    ${note}
    <table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#f3f4f6;text-align:left;">
          <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Ref</th>
          <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Title</th>
          <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Type</th>
          <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Theme</th>
          <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Score</th>
          <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Reason</th>
          <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Due</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
};

const renderDailySummaryWithLinks = (items) => {
  if (!Array.isArray(items) || !items.length) {
    return '<div style="margin-top:12px;padding:12px;background:#f8fafc;border-radius:10px;color:#334155;font-size:13px;">No active tasks or stories for today.</div>';
  }
  
  const highPriorityItems = items
    .filter(item => item.aiScore && item.aiScore >= 70)
    .slice(0, 5);
    
  if (!highPriorityItems.length) {
    return '<div style="margin-top:12px;padding:12px;background:#f8fafc;border-radius:10px;color:#334155;font-size:13px;">No high-priority items identified for today.</div>';
  }
  
  const itemsList = highPriorityItems
    .map((item) => {
      const ref = item.ref || item.title || 'Item';
      const link = item.deepLink
        ? `<a href="${escape(item.deepLink)}" style="color:#2563eb;text-decoration:none;font-weight:600;">${escape(ref)}</a>`
        : escape(ref);
      const title = item.title && item.title !== ref ? ` - ${escape(item.title)}` : '';
      const score = item.aiScore != null ? Math.round(Number(item.aiScore)) : '';
      const scoreDisplay = score ? ` (Score: ${score})` : '';
      return `<li style="margin-bottom:8px;">${link}${title}${scoreDisplay}</li>`;
    })
    .join('');
    
  return `
    <div style="margin-top:12px;padding:12px;background:#e0f2fe;border-radius:10px;">
      <h4 style="margin:0 0 8px;color:#0369a1;font-size:14px;">Today's High Priority Items:</h4>
      <ul style="margin:0;padding-left:20px;color:#0c4a6e;">${itemsList}</ul>
    </div>
  `;
};

const renderAIPriorityDetails = (items) => {
  if (!Array.isArray(items) || !items.length) {
    return '<p style="color:#6b7280;">No prioritization data available.</p>';
  }
  
  const scoredItems = items
    .filter(item => item.aiScore != null && item.aiReason)
    .slice(0, 8);
    
  if (!scoredItems.length) {
    return '<p style="color:#6b7280;">AI scoring in progress - check back later.</p>';
  }
  
  const rows = scoredItems
    .map((item) => {
      const ref = item.ref || item.title || 'Item';
      const link = item.deepLink
        ? `<a href="${escape(item.deepLink)}" style="color:#2563eb;">${escape(ref)}</a>`
        : escape(ref);
      const score = item.aiScore != null ? Math.round(Number(item.aiScore)) : '—';
      const reason = item.aiReason ? escape(item.aiReason) : '—';
      const textScore = item.aiTextScore ? ` (Text: ${escape(item.aiTextScore)})` : '';
      return `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${link}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escape(item.title || '')}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:600;color:${score >= 80 ? '#dc2626' : score >= 60 ? '#ea580c' : '#059669'};">${score}${textScore}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${reason}</td>
        </tr>
      `;
    })
    .join('\n');
    
  return `
    <table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#f3f4f6;text-align:left;">
          <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Ref</th>
          <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Title</th>
          <th style="padding:8px;border-bottom:1px solid #e5e7eb;">AI Score</th>
          <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Reasoning</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
};

const renderMonzo = (monzo) => {
  if (!monzo) return '<p style="color:#6b7280;">Connect Monzo to track spending.</p>';
  const parts = [];
  if (monzo.totals) {
    const spent = monzo.totals.spent != null ? `£${Number(monzo.totals.spent).toFixed(2)}` : 'n/a';
    const budget = monzo.totals.budget != null ? `£${Number(monzo.totals.budget).toFixed(2)}` : 'n/a';
    const remaining = monzo.totals.remaining != null ? `£${Number(monzo.totals.remaining).toFixed(2)}` : 'n/a';
    parts.push(`<li><strong>Spent:</strong> ${escape(spent)} · <strong>Budget:</strong> ${escape(budget)} · <strong>Left:</strong> ${escape(remaining)}</li>`);
  }
  if (Array.isArray(monzo.categories) && monzo.categories.length) {
    const cats = monzo.categories.slice(0, 3).map((cat) => {
      const amount = cat.spent != null ? `£${Number(cat.spent).toFixed(2)}` : 'n/a';
      const name = cat.category || cat.name || 'Category';
      return `<li>${escape(name)} — ${escape(amount)}</li>`;
    }).join('\n');
    parts.push(`<li><strong>Top Categories:</strong><ul style="padding-left:20px;margin-top:4px;">${cats}</ul></li>`);
  }
  if (!parts.length) {
    return '<p style="color:#6b7280;">No recent Monzo activity.</p>';
  }
  return `<ul style="padding-left:20px;">${parts.join('')}</ul>`;
};

const renderFinanceSummary = (summary, currency = 'GBP') => {
  if (!summary || !summary.transactionCount) {
    return '<p style="color:#6b7280;">No Monzo transactions captured for this period.</p>';
  }

  const spent = formatPence(summary.totalSpendPence || 0, currency) || '£0.00';
  const income = formatPence(summary.totalIncomePence || 0, currency) || '£0.00';
  const mandatorySpendPence = Number.isFinite(Number(summary.mandatorySpendPence))
    ? Number(summary.mandatorySpendPence)
    : Math.abs(Math.min(Number(summary?.buckets?.mandatory || 0), 0));
  const discretionarySpendPence = Number.isFinite(Number(summary.discretionarySpendPence))
    ? Number(summary.discretionarySpendPence)
    : Math.abs(Math.min(Number(summary?.buckets?.discretionary || summary?.buckets?.optional || 0), 0));
  const uncategorisedFromBuckets = ['unknown', 'uncategorized', 'uncategorised']
    .reduce((sum, key) => sum + Math.abs(Math.min(Number(summary?.buckets?.[key] || 0), 0)), 0);
  const uncategorisedSpendPence = Number.isFinite(Number(summary.uncategorisedSpendPence))
    ? Number(summary.uncategorisedSpendPence)
    : uncategorisedFromBuckets;
  const lastSync = summary.lastSyncDisplay || summary.lastSyncAt || null;
  const bucketRows = Object.entries(summary.buckets || {})
    .filter(([bucket]) => bucket !== 'bank_transfer' && bucket !== 'unknown')
    .map(([bucket, amount]) => ({
      bucket,
      label: FINANCE_BUCKET_LABELS[bucket] || bucket,
      amount: Math.abs(Number(amount || 0)),
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);
  const bucketHtml = bucketRows.length
    ? `
      <table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;">
        <thead>
          <tr style="background:#f3f4f6;text-align:left;">
            <th style="padding:6px;border-bottom:1px solid #e5e7eb;">Bucket</th>
            <th style="padding:6px;border-bottom:1px solid #e5e7eb;text-align:right;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${bucketRows.map((row) => `
            <tr>
              <td style="padding:6px;border-bottom:1px solid #e5e7eb;">${escape(row.label)}</td>
              <td style="padding:6px;border-bottom:1px solid #e5e7eb;text-align:right;">${escape(formatPence(row.amount, currency) || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
    : '<p style="color:#6b7280;margin:6px 0 0;">No bucket totals yet.</p>';

  const topMerchants = Array.isArray(summary.topMerchants) ? summary.topMerchants : [];
  const merchantHtml = topMerchants.length
    ? `
      <ul style="padding-left:18px;margin:8px 0 0;">
        ${topMerchants.map((m) => `
          <li>${escape(m.merchant || 'Unknown')} — ${escape(formatPence(m.totalPence || 0, currency) || '')}</li>
        `).join('')}
      </ul>
    `
    : '<p style="color:#6b7280;margin:6px 0 0;">No merchant totals yet.</p>';

  const anomalies = Array.isArray(summary.anomalies) ? summary.anomalies : [];
  const anomalyHtml = anomalies.length
    ? `
      <ul style="padding-left:18px;margin:8px 0 0;">
        ${anomalies.slice(0, 5).map((a) => `
          <li>${escape(a.merchant || 'Unknown')} — ${escape(formatPence(a.amountPence || 0, currency) || '')} <span style="color:#6b7280;">(${escape(a.reason || 'Anomaly')})</span></li>
        `).join('')}
      </ul>
    `
    : '<p style="color:#6b7280;margin:6px 0 0;">No anomalies detected.</p>';

  return `
    <div>
      <p style="margin:0 0 6px;">
        <strong>Total spent:</strong> ${escape(spent)} •
        <strong style="margin-left:8px;">Income:</strong> ${escape(income)}
      </p>
      <p style="margin:0 0 6px;">
        <strong>Mandatory:</strong> ${escape(formatPence(mandatorySpendPence, currency) || '£0.00')} •
        <strong style="margin-left:8px;">Discretionary:</strong> ${escape(formatPence(discretionarySpendPence, currency) || '£0.00')} •
        <strong style="margin-left:8px;">Uncategorised:</strong> ${escape(formatPence(uncategorisedSpendPence, currency) || '£0.00')}
      </p>
      ${lastSync ? `<p style="margin:0 0 6px;color:#6b7280;font-size:12px;"><strong>Last sync:</strong> ${escape(lastSync)}</p>` : ''}
      <p style="margin:0;color:#6b7280;font-size:12px;">${summary.transactionCount} transactions · ${summary.spendCount} spend · ${summary.incomeCount} income</p>
      ${bucketHtml}
      <h4 style="margin:12px 0 4px;font-size:14px;color:#111827;">Top Merchants</h4>
      ${merchantHtml}
      <h4 style="margin:12px 0 4px;font-size:14px;color:#111827;">Spend Anomalies</h4>
      ${anomalyHtml}
    </div>
  `;
};

const renderSavingsRunway = (runway, currency = 'GBP') => {
  if (!runway || !Array.isArray(runway.topRows) || runway.topRows.length === 0) {
    return '<p style="color:#6b7280;">No linked savings pots with runway data yet.</p>';
  }

  const rows = runway.topRows.map((row) => {
    const target = formatCurrency(row.targetAmount || 0, currency) || `${currency} 0.00`;
    const balance = formatCurrency(row.linkedPotBalance || 0, currency) || `${currency} 0.00`;
    const avgMonthly = row.avgMonthlyAllocation && row.avgMonthlyAllocation > 0
      ? (formatCurrency(row.avgMonthlyAllocation, currency) || `${currency} 0.00`)
      : 'Insufficient history';
    const remaining = formatCurrency(row.remainingAmount || 0, currency) || `${currency} 0.00`;
    const eta = row.monthsToTarget == null
      ? 'TBD'
      : (Number(row.monthsToTarget) <= 0 ? 'Funded' : `${Math.ceil(Number(row.monthsToTarget))} mo`);

    return `
      <tr>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb;">${escape(row.goalTitle || 'Goal')}</td>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb;text-align:right;">${escape(target)}</td>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb;text-align:right;">${escape(balance)}</td>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb;text-align:right;">${escape(avgMonthly)}</td>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb;text-align:right;">${escape(remaining)}</td>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb;text-align:right;">${escape(eta)}</td>
      </tr>
    `;
  }).join('');

  const freshness = runway.updatedDisplay
    ? `Updated ${escape(runway.updatedDisplay)}${runway.isStale ? ' · stale' : ''}`
    : 'Update timestamp unavailable';

  return `
    <p style="margin:0 0 6px;color:#6b7280;font-size:12px;">${freshness}</p>
    <table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#f3f4f6;text-align:left;">
          <th style="padding:6px;border-bottom:1px solid #e5e7eb;">Goal</th>
          <th style="padding:6px;border-bottom:1px solid #e5e7eb;text-align:right;">Target</th>
          <th style="padding:6px;border-bottom:1px solid #e5e7eb;text-align:right;">Pot Balance</th>
          <th style="padding:6px;border-bottom:1px solid #e5e7eb;text-align:right;">Avg / mo</th>
          <th style="padding:6px;border-bottom:1px solid #e5e7eb;text-align:right;">Remaining</th>
          <th style="padding:6px;border-bottom:1px solid #e5e7eb;text-align:right;">ETA</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
};

const renderChecklist = (checklist) => {
  if (!checklist || !Array.isArray(checklist.items) || !checklist.items.length) {
    return '<p style="color:#6b7280;">Nothing flagged for today—great job!</p>';
  }

  const groups = new Map();
  checklist.items.forEach((item) => {
    const key = item.category || 'Today';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  const sections = Array.from(groups.entries()).map(([category, items]) => {
    const rows = items.map((item) => {
      const title = item.title || 'Item';
      const due = item.dueDisplay ? `<span style="margin-left:6px;font-size:12px;color:#6b7280;">${escape(item.dueDisplay)}</span>` : '';
      const bucket = item.bucket ? `<span style="margin-left:8px;font-size:11px;padding:2px 8px;border-radius:999px;background:#e0e7ff;color:#312e81;">${escape(item.bucket)}</span>` : '';
      const reason = item.reason ? `<div style="font-size:12px;color:#4b5563;margin-top:2px;">${escape(item.reason)}</div>` : '';
      const nextStep = item.nextStep ? `<div style="font-size:12px;color:#1f2937;margin-top:2px;">Next: ${escape(item.nextStep)}</div>` : '';
      const ref = item.ref ? `<span style="margin-left:6px;font-size:12px;color:#9ca3af;">${escape(item.ref)}</span>` : '';
      const indicator = item.checkable === false
        ? '<span style="display:inline-block;width:12px;height:12px;margin-right:6px;border-radius:999px;background:#d1fae5;"></span>'
        : '<span style="display:inline-block;width:12px;height:12px;margin-right:6px;border:1px solid #d1d5db;border-radius:2px;"></span>';
      return `
        <li style="margin-bottom:10px;list-style:none;">
          <div style="display:flex;align-items:flex-start;gap:8px;">
            ${indicator}
            <div>
              <div style="font-weight:600;color:#111827;">${escape(title)}${ref}${due}${bucket}</div>
              ${reason}${nextStep}
            </div>
          </div>
        </li>
      `;
    }).join('');
    return `
      <div style="margin-bottom:16px;">
        <h4 style="margin:0 0 8px;font-size:15px;color:#374151;">${escape(category)}</h4>
        <ul style="padding-left:0;margin:0;">${rows}</ul>
      </div>
    `;
  });

  return sections.join('\n');
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
  const financeWindowDays = Number(data?.metadata?.financeWindowDays || 5);
  const financeWindowLabel = data?.metadata?.financeWindowLabel || `last ${financeWindowDays} days`;
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
        <p style="margin:8px 0 0;">Here’s your daily game plan for ${escape(data.metadata.dayIso || '')}</p>
      </header>

      <section style="margin-top:24px;background:#fff;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <h2 style="margin-top:0;font-size:18px;color:#1f2937;">Daily Brief</h2>
        ${renderBriefing(data.dailyBrief)}
        ${renderDailySummaryWithLinks(data.activeWorkItems || [])}
      </section>

      <section style="margin-top:24px;background:#fff;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <h2 style="margin-top:0;font-size:18px;color:#1f2937;">Dashboard Alerts</h2>
        ${renderDashboardAlerts(data.dashboardAlerts || [])}
      </section>

      <section style="margin-top:24px;background:#fff;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <h2 style="margin-top:0;font-size:18px;color:#1f2937;">AI Prioritization</h2>
        ${renderPriorityNarrative(data.priorityNarrative || data.aiFocus)}
        ${renderAIPriorityDetails(data.activeWorkItems || [])}
      </section>

      ${data.financeDaily ? `
      <section style="margin-top:24px;background:#fff;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <h2 style="margin-top:0;font-size:18px;color:#1f2937;">Spend Summary (Last ${financeWindowDays} Days)</h2>
        <p style="margin-top:0;color:#6b7280;font-size:12px;">Window: ${escape(financeWindowLabel)}</p>
        ${renderFinanceSummary(data.financeDaily, data.monzo?.currency || 'GBP')}
        ${data.financeCommentary ? `<div style="margin-top:12px;padding:12px;background:#f8fafc;border-radius:10px;color:#334155;font-size:13px;">${escape(data.financeCommentary)}</div>` : ''}
      </section>
      ` : ''}

      ${data.savingsRunway ? `
      <section style="margin-top:24px;background:#fff;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <h2 style="margin-top:0;font-size:18px;color:#1f2937;">Savings Runway</h2>
        ${renderSavingsRunway(data.savingsRunway, data.monzo?.currency || 'GBP')}
      </section>
      ` : ''}

      <section style="margin-top:24px;background:#fff;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <h2 style="margin-top:0;font-size:18px;color:#1f2937;">Key Metrics</h2>
        ${renderKpiSummary(data.kpis)}
      </section>

      <section style="margin-top:24px;background:#fff;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <h2 style="margin-top:0;font-size:18px;color:#1f2937;">Goal KPI Status (Active Sprint)</h2>
        ${renderGoalKpiStatusTable(data.goalKpiStatus)}
      </section>

      <section style="margin-top:24px;background:#fff;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <h2 style="margin-top:0;font-size:18px;color:#1f2937;">Today\'s Schedule</h2>
        ${renderSchedule(data.calendarBlocks || [])}
      </section>

      <section style="margin-top:24px;background:#fff;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <h2 style="margin-top:0;font-size:18px;color:#1f2937;">AI Planner Output</h2>
        ${renderPlannerOutput(data.plannerSummary, data.plannerBlocks || [])}
      </section>

      <section style="margin-top:24px;background:#fff;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <h2 style="margin-top:0;font-size:18px;color:#1f2937;">Active Sprint Worklist</h2>
        ${renderActiveWorklist(data.activeWorkItems || [], data.priorityNarrative || data.aiFocus)}
      </section>

      <footer style="margin-top:24px;text-align:center;color:#6b7280;font-size:12px;">
        <p>Generated at ${escape(data.metadata.generatedAt || '')} (${escape(data.metadata.timezone || '')}).</p>
      </footer>
    </div>
  </body>
</html>
  `;
};

const renderDashboardAlerts = (alerts = []) => {
  if (!Array.isArray(alerts) || alerts.length === 0) {
    return '<p style="color:#6b7280;">No banner alerts today.</p>';
  }

  const toPercentInt = (value, fallback = null) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.round(num));
  };

  const renderAlertMessage = (alert) => {
    if (alert?.type !== 'budget_guardrail') {
      return escape(alert?.message || '');
    }

    const discretionarySharePct = toPercentInt(alert?.discretionarySharePct);
    const monthElapsedPct = toPercentInt(alert?.monthElapsedPct);

    if (discretionarySharePct == null || monthElapsedPct == null) {
      return 'Discretionary spend is ahead of month progress.';
    }

    // Budget guardrail wording is intentionally scoped to month-progress context only.
    return `Discretionary spend is ${discretionarySharePct}% with ${monthElapsedPct}% of the month elapsed.`;
  };

  const toColor = (severity) => {
    if (severity === 'critical') return { bg: '#fef2f2', border: '#ef4444', text: '#991b1b' };
    if (severity === 'warning') return { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' };
    return { bg: '#eff6ff', border: '#2563eb', text: '#1e3a8a' };
  };

  return alerts
    .slice(0, 6)
    .map((alert) => {
      const colors = toColor(alert?.severity);
      const actionHref = alert?.ctaPath ? escape(alert.ctaPath) : null;
      const action = actionHref
        ? `<div style="margin-top:8px;"><a href="${actionHref}" style="font-size:12px;color:#2563eb;font-weight:600;">Open ${escape(alert.ctaPath)}</a></div>`
        : '';
      return `
        <div style="margin-bottom:10px;padding:12px;border-radius:10px;border-left:4px solid ${colors.border};background:${colors.bg};">
          <div style="font-size:13px;font-weight:700;color:${colors.text};">${escape(alert?.title || 'Alert')}</div>
          <div style="font-size:13px;color:#334155;margin-top:4px;">${renderAlertMessage(alert)}</div>
          ${action}
        </div>
      `;
    })
    .join('');
};

const renderWeeklyFinanceSummaryEmail = (data) => {
  const profileName = data.profile?.displayName || data.profile?.name || data.profile?.email || 'BOB Member';
  const windowLabel = data.metadata?.windowLabel || data.metadata?.weekLabel || data.metadata?.weekIso || 'this week';
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Weekly Spend Summary</title>
  </head>
  <body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
    <div style="max-width:640px;margin:0 auto;padding:24px;">
      <header style="text-align:center;padding:24px;border-radius:12px;background:linear-gradient(135deg,#0ea5e9,#22c55e);color:#fff;">
        <h1 style="margin:0;font-size:24px;">Weekly Spend Snapshot</h1>
        <p style="margin:8px 0 0;">Hi ${escape(profileName)} — here’s your summary for ${escape(windowLabel)}.</p>
      </header>

      <section style="margin-top:24px;background:#fff;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <h2 style="margin-top:0;font-size:18px;color:#1f2937;">Weekly Spend Summary</h2>
        ${renderFinanceSummary(data.financeSummary, data.currency || data.monzo?.currency || 'GBP')}
        ${data.financeCommentary ? `<div style="margin-top:12px;padding:12px;background:#f8fafc;border-radius:10px;color:#334155;font-size:13px;">${escape(data.financeCommentary)}</div>` : ''}
      </section>

      <footer style="margin-top:24px;text-align:center;color:#6b7280;font-size:12px;">
        <p>Generated at ${escape(data.metadata?.generatedAt || '')} (${escape(data.metadata?.timezone || '')}).</p>
      </footer>
    </div>
  </body>
</html>
  `;
};

const renderSpendAnomalyEmail = ({ profile, anomalies = [], currency = 'GBP', metadata = {} }) => {
  const profileName = profile?.displayName || profile?.name || profile?.email || 'BOB Member';
  const windowLabel = metadata.windowLabel || 'recent activity';
  const rows = anomalies.slice(0, 10).map((a) => {
    const amount = formatPence(a.amountPence || 0, currency) || '£0.00';
    return `
      <tr>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb;">${escape(a.merchant || 'Unknown')}</td>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb;text-align:right;">${escape(amount)}</td>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb;">${escape(a.reason || 'Anomaly')}</td>
      </tr>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Spend Anomaly Alert</title>
  </head>
  <body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
    <div style="max-width:640px;margin:0 auto;padding:24px;">
      <header style="padding:20px;border-radius:12px;background:#ef4444;color:#fff;text-align:center;">
        <h1 style="margin:0;font-size:22px;">Spend Anomaly Alert</h1>
        <p style="margin:8px 0 0;">Hi ${escape(profileName)} — we spotted unusually high spend in ${escape(windowLabel)}.</p>
      </header>

      <section style="margin-top:20px;background:#fff;border-radius:12px;padding:16px;border:1px solid #e5e7eb;">
        <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead>
            <tr style="background:#f3f4f6;text-align:left;">
              <th style="padding:6px;border-bottom:1px solid #e5e7eb;">Merchant</th>
              <th style="padding:6px;border-bottom:1px solid #e5e7eb;text-align:right;">Amount</th>
              <th style="padding:6px;border-bottom:1px solid #e5e7eb;">Reason</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </section>

      <footer style="margin-top:20px;text-align:center;color:#6b7280;font-size:12px;">
        <p>Generated at ${escape(metadata.generatedAt || '')} (${escape(metadata.timezone || '')}).</p>
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
        const link = item.deepLink || null;
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
          <li><strong>${summary.autoPointed || 0}</strong> items auto-pointed by AI</li>
          <li><strong>${summary.autoTimeOfDay || 0}</strong> items given AI time-of-day suggestion</li>
          <li><strong>${summary.missingPoints || 0}</strong> stories still missing points</li>
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
        ${(snapshot.autoPointing && snapshot.autoPointing.length) ? `
          <h3 style="margin-top:24px;color:#f8fafc;">AI Auto-pointed (${snapshot.autoPointing.length})</h3>
          <ul>${snapshot.autoPointing.map((r) => `<li><strong>${escape(r.entityType || 'item')}</strong>: ${escape(r.points != null ? `${r.points} pts` : '')}${r.timeOfDay ? ` · ${escape(r.timeOfDay)}` : ''} — ${escape(r.title || r.entityId || '')}</li>`).join('\n')}</ul>
        ` : ''}
        ${(snapshot.autoTimeOfDay && snapshot.autoTimeOfDay.length) ? `
          <h3 style="margin-top:24px;color:#f8fafc;">AI Time-of-day suggestions (${snapshot.autoTimeOfDay.length})</h3>
          <ul>${snapshot.autoTimeOfDay.map((r) => `<li><strong>${escape(r.entityType || 'item')}</strong>: ${escape(r.timeOfDay || '')} — ${escape(r.title || r.entityId || '')}</li>`).join('\n')}</ul>
        ` : ''}
        ${(snapshot.missingPoints && snapshot.missingPoints.length) ? `
          <h3 style="margin-top:24px;color:#f8fafc;">Stories still missing points</h3>
          <ul>${renderList(snapshot.missingPoints, 'All active stories have points')}</ul>
        ` : ''}
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

const renderBriefing = (data) => {
  if (!data || (!data.lines && !data.weather)) {
    return `<p style="color:#6b7280;">No briefing available today.</p>`;
  }
  const linesHtml = Array.isArray(data.lines) && data.lines.length
    ? `<ul style="padding-left:18px;margin:0;">${data.lines.map((line) => `<li style="margin-bottom:4px;">${escape(line)}</li>`).join('')}</ul>`
    : '';
  const weatherHtml = data.weather
    ? `<div style="margin-top:12px;padding:12px;border-radius:8px;background:#f3f4f6;">
        <strong>Weather:</strong> ${escape(data.weather.summary || '')}
        ${data.weather.temp ? `<div style="font-size:13px;color:#6b7280;">${escape(data.weather.temp)}</div>` : ''}
      </div>`
    : '';
  const newsHtml = Array.isArray(data.news) && data.news.length
    ? `<div style="margin-top:12px;">
        <strong>News:</strong>
        <ul style="padding-left:18px;margin:4px 0 0;">${data.news.map((item) => `<li>${escape(item)}</li>`).join('')}</ul>
      </div>`
    : '';
  return `${linesHtml}${weatherHtml}${newsHtml}`;
};

const renderProgressSummary = (goalProgress, sprintProgress, budgetProgress) => {
  if (!goalProgress && !sprintProgress && !budgetProgress) {
    return `<p style="color:#6b7280;">No metrics available.</p>`;
  }
  const cards = [];
  if (goalProgress) {
    cards.push(`
      <div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;">
        <strong style="display:block;font-size:14px;color:#1f2937;">Goals</strong>
        <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">${goalProgress.completed}/${goalProgress.total} complete</div>
        ${goalProgress.percentComplete != null ? `<div style="height:6px;border-radius:999px;background:#eef2ff;overflow:hidden;"><div style="width:${goalProgress.percentComplete}%;background:#4f46e5;height:6px;"></div></div>` : ''}
      </div>
    `);
  }
  if (sprintProgress) {
    cards.push(`
      <div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;">
        <strong style="display:block;font-size:14px;color:#1f2937;">Current Sprint</strong>
        <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">${escape(sprintProgress.sprintName || 'Sprint')} · ${sprintProgress.completedStories}/${sprintProgress.totalStories} done</div>
        ${sprintProgress.percentComplete != null ? `<div style="height:6px;border-radius:999px;background:#d1fae5;overflow:hidden;"><div style="width:${sprintProgress.percentComplete}%;background:#059669;height:6px;"></div></div>` : ''}
      </div>
    `);
  }
  if (budgetProgress && budgetProgress.length) {
    const top = budgetProgress[0];
    cards.push(`
      <div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;">
        <strong style="display:block;font-size:14px;color:#1f2937;">Budget (${escape(top.key || 'Spending')})</strong>
        <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">${Number(top.actual || 0).toFixed(0)} spent of ${Number(top.budget || 0).toFixed(0)}</div>
        ${top.utilisation != null ? `<div style="height:6px;border-radius:999px;background:#fef3c7;overflow:hidden;"><div style="width:${Math.min(top.utilisation, 100)}%;background:#f59e0b;height:6px;"></div></div>` : ''}
      </div>
    `);
  }
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;">${cards.join('')}</div>`;
};

const renderSprintBacklog = (pendingStories) => {
  if (!pendingStories || !pendingStories.length) return '';
  const rows = pendingStories
    .map((story) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${escape(story.ref || '')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${story.deepLink ? `<a href="${escape(story.deepLink)}" style="color:#2563eb;">${escape(story.title || '')}</a>` : escape(story.title || '')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${escape(story.goal || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${escape(story.status || '')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${escape(story.dueDisplay || '—')}</td>
      </tr>
    `)
    .join('');
  return `
    <section style="margin-top:24px;background:#fff;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
      <h2 style="margin-top:0;font-size:18px;color:#1f2937;">Stories awaiting kickoff</h2>
      <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#f3f4f6;text-align:left;">
            <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Ref</th>
            <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Story</th>
            <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Goal</th>
            <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Status</th>
            <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Due</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
};

module.exports = {
  renderDailySummaryEmail,
  renderWeeklyFinanceSummaryEmail,
  renderSpendAnomalyEmail,
  renderDataQualityEmail,
};
