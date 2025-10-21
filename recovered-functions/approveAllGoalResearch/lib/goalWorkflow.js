const DEFAULT_PROVIDER = 'gemini';
const DEFAULT_MODEL = 'gemini-1.5-flash';

const sanitizeString = (value, fallback = '') => {
  if (value == null) return fallback;
  const str = String(value).trim();
  return str.length ? str : fallback;
};

const normalizeOutline = (outlineRaw) => {
  if (!Array.isArray(outlineRaw)) return [];
  return outlineRaw
    .map((item) => {
      if (item == null) return null;
      if (typeof item === 'string') return item.trim();
      if (typeof item === 'object') {
        return sanitizeString(item.title || item.heading || item.name || '', '');
      }
      return null;
    })
    .map((item) => (item ? item.replace(/^[•\-\d\.\s]+/, '').trim() : null))
    .filter((item) => item && item.length > 0);
};

const normalizeNextActions = (actionsRaw) => {
  if (!Array.isArray(actionsRaw)) return [];
  return actionsRaw
    .map((action, index) => {
      if (!action) return null;
      const title = sanitizeString(
        action.title || action.name || action.summary || `Action ${index + 1}`,
        `Action ${index + 1}`
      );
      const description = sanitizeString(action.description || action.details || '', '');
      const minutesCandidates = [
        action.estimated_minutes,
        action.estimate_minutes,
        action.minutes,
        action.estimateMin,
        action.duration_minutes,
        action.duration,
      ];
      const minutes = minutesCandidates
        .map((value) => Number(value))
        .find((value) => Number.isFinite(value) && value > 0);
      const estimatedMinutes = minutes != null ? Math.round(minutes) : 60;
      const storyIndexRaw = action.storyIndex ?? action.story_index ?? action.story;
      let storyIndex = Number(storyIndexRaw);
      storyIndex = Number.isFinite(storyIndex) ? Math.max(0, Math.floor(storyIndex)) : null;

      return {
        title,
        description,
        estimatedMinutes,
        raw: action,
        storyIndex,
      };
    })
    .filter(Boolean);
};

const ensureUniqueTitles = (titles) => {
  const seen = new Map();
  return titles.map((original) => {
    const base = original.replace(/\s+/g, ' ').trim();
    const key = base.toLowerCase();
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
    if (count === 0) return base;
    return `${base} (${count + 1})`;
  });
};

const estimateStoryPoints = (minutesTotal) => {
  if (!Number.isFinite(minutesTotal) || minutesTotal <= 0) return 1;
  const hours = minutesTotal / 60;
  if (hours <= 2) return 2;
  if (hours <= 4) return 3;
  if (hours <= 8) return 5;
  if (hours <= 12) return 8;
  return 13;
};

const buildCalendarSuggestion = (storyTitle, totalMinutes) => {
  const duration = Math.max(45, Math.min(240, Math.round(totalMinutes * 0.6) || 90));
  return {
    label: storyTitle,
    durationMinutes: duration,
    rationale: `Focus block for story "${storyTitle}"`,
  };
};

async function generateGoalResearch({
  llmClient,
  goal,
  userId,
  provider = DEFAULT_PROVIDER,
  model = DEFAULT_MODEL,
}) {
  if (typeof llmClient !== 'function') {
    throw new Error('llmClient must be a function');
  }
  const goalTitle = sanitizeString(goal?.title, 'Goal');
  const goalDescription = sanitizeString(goal?.description || goal?.summary || '', '');
  const goalTheme = sanitizeString(goal?.theme || goal?.themeLabel || 'General', 'General');

  const researchPlanRaw = await llmClient({
    system:
      'You are a research planning agent. Return strict JSON only. ' +
      'Design a short research plan for the provided goal, including a research_prompt to dig deep, ' +
      'key_questions (max 5), a concise outline list, and initial_next_actions (3-7 items) each with title and estimated_minutes. ' +
      'Do not add prose or Markdown outside the JSON.',
    user: `Goal Title: ${goalTitle}\nGoal Description: ${goalDescription}\nTheme: ${goalTheme}`,
    purpose: 'goalResearchPlan',
    userId,
    expectJson: true,
    temperature: 0.2,
    provider,
    model,
  });

  let researchPlan;
  try {
    researchPlan = JSON.parse(researchPlanRaw || '{}');
  } catch (error) {
    researchPlan = {};
  }

  const researchPrompt = sanitizeString(researchPlan?.research_prompt, '');
  const questions = Array.isArray(researchPlan?.key_questions)
    ? researchPlan.key_questions.map((q) => sanitizeString(q, '')).filter(Boolean)
    : [];
  const outline = normalizeOutline(researchPlan?.outline);
  const nextActions = normalizeNextActions(researchPlan?.initial_next_actions);

  const researchDocMd = await llmClient({
    system:
      'You are an expert researcher. Compose a crisp, actionable research brief in Markdown. ' +
      'Begin with a 3-5 bullet executive summary, then key findings (placeholders allowed), then recommended next actions. Keep it under 800 words.',
    user:
      `Goal: ${goalTitle}\nResearch Prompt: ${researchPrompt}\nOutline: ${JSON.stringify(outline)}\n` +
      `Known Context: ${goalDescription}`,
    purpose: 'goalResearchDoc',
    userId,
    expectJson: false,
    temperature: 0.3,
    provider,
    model,
  });

  return {
    goalTitle,
    goalDescription,
    goalTheme,
    researchPrompt,
    questions,
    outline,
    nextActions,
    researchDocMd,
    researchPlan,
    provider,
    model,
  };
}

function buildStoryPlanFromResearch({
  goal,
  research,
  defaultTheme = 'Growth',
}) {
  const outline = normalizeOutline(research?.outline);
  const nextActions = normalizeNextActions(research?.nextActions);
  const theme = sanitizeString(goal?.theme || research?.goalTheme || defaultTheme, defaultTheme);
  const goalTitle = sanitizeString(goal?.title, 'Goal');

  const storyTitlesRaw = outline.length ? outline : [`${goalTitle}: Execution`];
  const storyTitles = ensureUniqueTitles(storyTitlesRaw);
  const stories = storyTitles.map((title, index) => ({
    index,
    title: title.slice(0, 140),
    description: `Focus area derived from research: ${title}`,
    theme,
    tasks: [],
    totalMinutes: 0,
  }));

  if (stories.length === 0) {
    stories.push({
      index: 0,
      title: `${goalTitle}: Execution`,
      description: `Auto-generated focus area for ${goalTitle}`,
      theme,
      tasks: [],
      totalMinutes: 0,
    });
  }

  let cursor = 0;
  nextActions.forEach((action) => {
    const targetIndex =
      Number.isInteger(action.storyIndex) && action.storyIndex < stories.length
        ? action.storyIndex
        : cursor % stories.length;
    const story = stories[targetIndex];
    cursor += 1;

    const task = {
      title: action.title.slice(0, 140),
      description: action.description.slice(0, 500),
      estimateMinutes: Math.max(15, Math.min(600, action.estimatedMinutes)),
      derivedFromResearch: true,
    };

    if (task.estimateMinutes >= 240) {
      // Oversized tasks should be converted to stories later.
      task.convertToStory = true;
    }

    story.tasks.push(task);
    story.totalMinutes += task.estimateMinutes;
  });

  stories.forEach((story) => {
    if (story.tasks.length === 0) {
      story.tasks.push({
        title: `Define detailed work for "${story.title}"`,
        description: 'Break down this focus area into actionable tasks.',
        estimateMinutes: 60,
        derivedFromResearch: false,
      });
      story.totalMinutes += 60;
    }
    story.points = estimateStoryPoints(story.totalMinutes);
    story.calendarSuggestion = buildCalendarSuggestion(story.title, story.totalMinutes);
  });

  const totalNextActions = nextActions.length;
  const convertCandidates = stories
    .flatMap((story) =>
      story.tasks
        .filter((task) => task.convertToStory)
        .map((task) => ({
          storyTitle: story.title,
          taskTitle: task.title,
          estimateMinutes: task.estimateMinutes,
        }))
    );

  return {
    stories: stories.map((story) => ({
      title: story.title,
      description: story.description,
      theme: story.theme,
      points: story.points,
      tasks: story.tasks,
      calendarSuggestion: story.calendarSuggestion,
      totalMinutes: story.totalMinutes,
    })),
    totalNextActions,
    convertCandidates,
    summary: {
      storyCount: stories.length,
      theme,
      oversizedTaskCount: convertCandidates.length,
    },
  };
}

module.exports = {
  generateGoalResearch,
  buildStoryPlanFromResearch,
};
