/**
 * Time-of-Day Population Service
 *
 * Handles:
 * 1. Auto-populating time_of_day when user enters explicit time (HH:MM)
 * 2. Batch keyword inference for blank time_of_day fields on stories/tasks
 * 3. Optional LLM fallback (disabled by default) for ambiguous titles
 * 4. Classification from DateTime objects to morning/afternoon/evening buckets
 */

const admin = require('firebase-admin');

const MORNING_HOURS = [5, 6, 7, 8, 9, 10, 11, 12]; // 05:00 - 12:59
const AFTERNOON_HOURS = [13, 14, 15, 16, 17, 18]; // 13:00 - 18:59
const EVENING_HOURS = [19, 20, 21, 22, 23, 0, 1, 2, 3, 4]; // 19:00 - 04:59

/**
 * Convert hour (0-23) to time-of-day bucket
 * @param {number} hour - Hour from 0-23
 * @returns {string} - 'morning' | 'afternoon' | 'evening'
 */
function classifyHourToTimeOfDay(hour) {
  const h = Number(hour);
  if (MORNING_HOURS.includes(h)) return 'morning';
  if (AFTERNOON_HOURS.includes(h)) return 'afternoon';
  return 'evening';
}

/**
 * Parse time string (HH:MM or H:MM) and return time_of_day bucket
 * @param {string} timeStr - Time string like "14:30" or "9:15"
 * @returns {string|null} - 'morning' | 'afternoon' | 'evening' | null
 */
function parseTimeStringToTimeOfDay(timeStr) {
  if (!timeStr) return null;
  const match = String(timeStr || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  return classifyHourToTimeOfDay(hour);
}

/**
 * Infer time_of_day from title + description using keywords.
 * Order matters — evening is checked last to avoid false positives from "afternoon" containing "pm".
 * @param {string} title
 * @param {string} description
 * @returns {string|null}
 */
function inferTimeOfDayFromContent(title, description) {
  const content = `${title} ${description}`.toLowerCase();

  // Morning: 05:00–12:59
  const morningKeywords = [
    // time signals
    'morning', 'early', 'dawn', 'sunrise', 'wake up', 'wake-up', 'alarm clock',
    // food/drink
    'breakfast', 'oatmeal', 'overnight oat', 'porridge', 'cereal', 'eggs', 'toast', 'coffee', 'juice', 'smoothie',
    // health supplements (taken in AM)
    'supplement', 'protein shake', 'creatine', 'inhaler', 'vitamins', 'protein',
    // personal care (AM) — avoid 'shower' alone as it matches "showerhead" in cleaning tasks
    'morning shower', 'take a shower', 'have a shower', 'shave', 'brush teeth', 'get dressed', 'get ready',
    // exercise
    'workout', 'gym', 'go for a run', 'jog', 'walk the dog', 'walk dog', 'stretch', 'yoga', 'meditation', 'meditat', 'journal',
    // morning chores — avoid 'run' alone (matches "run descale program")
    'make bed', 'mow lawn', 'mow the lawn', 'water plants', 'water the plants',
    'take out trash', 'take out bins', 'school run', 'drop off',
    // progress tracking (AM habit)
    'progress photo', 'weigh in',
  ];

  // Afternoon: 13:00–18:59
  const afternoonKeywords = [
    // time signals
    'afternoon', 'midday', 'noon', 'post-lunch', 'lunch time',
    // food
    'lunch', 'afternoon snack', 'meal prep',
    // work/tasks
    'meeting', 'standup', 'stand-up', 'call', 'collaboration', 'presentation', 'review',
    // errands
    'errand', 'grocery', 'groceries', 'shopping', 'pickup', 'pick up kids', 'collect',
    // car / vehicle
    'wash car', 'car wash', 'wash exterior', 'tyre', 'tire', 'screenwash', 'wax car',
    // outdoor chores (weekend afternoon)
    'garden', 'gardening', 'mow', 'rake', 'weed', 'prune', 'pruning', 'trim hedge',
    'sweep patio', 'patio', 'driveway', 'gutter', 'clear debris',
    // general household cleaning
    'clean', 'cleaning', 'vacuum', 'hoover', 'laundry', 'washing machine', 'dishes', 'dishwasher',
    'tidy', 'sweep', 'mop', 'dust', 'wipe down', 'scrub', 'deep clean',
    // bathroom/plumbing
    'bathroom', 'toilet', 'shower head', 'showerhead', 'descale', 'limescale',
    // bedding/linen
    'linens', 'linen', 'bed linen', 'change bed', 'towels', 'bath mat',
    // home maintenance
    'boiler', 'radiator', 'bleed', 'chimney', 'smoke alarm', 'carbon monoxide',
    'drain', 'filter', 'grout', 'fridge', 'turnover',
    // windows/exterior
    'window clean', 'clean windows', 'pressure wash',
  ];

  // Evening: 19:00–04:59
  const eveningKeywords = [
    // time signals
    'evening', 'night', 'sunset', 'dusk', 'after work', 'after-work', 'wind down', 'decompress',
    // food
    'dinner', 'supper', 'takeaway', 'takeout', 'cook dinner',
    // personal care (PM/bedtime)
    'retainer', 'night retainer', 'mouth guard', 'floss', 'flossing', 'night cream', 'moisturise',
    'moisturize', 'night moisturizer', 'face wash', 'face mask', 'skincare night', 'contact lenses',
    'contacts out', 'remove contacts', 'take contacts out', 'eye drops', 'melatonin',
    'bedtime', 'bed time', 'sleep', 'sleep routine', 'night routine',
    // leisure
    'tv', 'television', 'netflix', 'streaming', 'movie', 'film', 'show', 'episode',
    'gaming', 'video game', 'game night', 'board game',
    'read', 'reading', 'book', 'novel', 'podcast', 'audiobook',
    // relaxation/recovery
    'bath', 'soak', 'relax', 'unwind', 'sauna',
    // admin after work
    'timesheet', 'timesheets', 'weekly shop', 'online shop',
    // late misc
    'pm', 'night owl',
  ];

  if (morningKeywords.some(kw => content.includes(kw))) return 'morning';
  if (afternoonKeywords.some(kw => content.includes(kw))) return 'afternoon';
  if (eveningKeywords.some(kw => content.includes(kw))) return 'evening';

  return null;
}

// Task open-status values (not done): 0=todo, 1=in-progress
const TASK_OPEN_STATUSES = [0, 1];
// Story open-status values (not done): 4+ = done
const STORY_OPEN_STATUSES = [0, 1, 2, 3];

/**
 * Return true if a timeOfDay value is missing/blank.
 * Covers null, undefined, empty string, and the literal string 'null'.
 */
function isMissingTimeOfDay(value) {
  return value == null || value === '' || value === 'null';
}

/**
 * Batch keyword inference for open stories/tasks with blank time_of_day.
 * Runs nightly to populate missing values.
 * LLM is opt-in via options.useLlm (default false) — keyword inference covers most cases.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} userId
 * @param {Object} options
 * @param {number} [options.limit=100]
 * @param {string[]} [options.entityTypes=['story','task']]
 * @param {boolean} [options.useLlm=false] - Enable Gemini fallback for titles with no keyword match
 * @returns {Promise<{processed: number, updated: number, errors: number}>}
 */
async function populateBlankTimeOfDay(db, userId, options = {}) {
  const { limit = 100, entityTypes = ['story', 'task'], useLlm = false } = options;
  let processed = 0;
  let updated = 0;
  let errors = 0;

  // Only load AI client when LLM is opted in
  let aiClient = null;
  if (useLlm) {
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      aiClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
    } catch (e) {
      console.warn('[timeOfDayPopulator] Could not load GoogleGenerativeAI — useLlm ignored:', e?.message);
    }
  }

  async function llmInfer(entityType, id, title, description) {
    if (!aiClient || !title) return null;
    try {
      const model = aiClient.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const context = entityType === 'task'
        ? 'scheduled for (chore, routine, or one-off task)'
        : 'worked on (project story or feature)';
      const prompt = `What time of day should this ${entityType} be ${context}?
Title: "${title}"
Description: "${description || ''}"

Respond with ONLY one word: morning, afternoon, or evening.
- morning: 05:00-12:59 (wake-up, breakfast, exercise, early chores)
- afternoon: 13:00-18:59 (lunch, errands, collaboration, daytime cleaning)
- evening: 19:00-04:59 (dinner, bedtime routines, retainer, TV, reading)

If unclear, respond morning.`;
      const result = await model.generateContent(prompt);
      const text = (result?.response?.text() || '').toLowerCase().trim();
      if (text.includes('afternoon')) return 'afternoon';
      if (text.includes('evening')) return 'evening';
      return 'morning';
    } catch (err) {
      console.warn(`[timeOfDayPopulator] LLM failed for ${entityType} ${id}:`, err?.message);
      return null;
    }
  }

  try {
    // --- Tasks ---
    if (entityTypes.includes('task')) {
      // Fetch open tasks; filter timeOfDay in-memory to avoid composite index
      const tasksSnap = await db.collection('tasks')
        .where('ownerUid', '==', userId)
        .where('status', 'in', TASK_OPEN_STATUSES)
        .limit(limit * 4)
        .get();

      const needsTimeOfDay = tasksSnap.docs.filter(d => {
        const data = d.data();
        return !data.deleted && isMissingTimeOfDay(data.timeOfDay);
      });

      for (const taskDoc of needsTimeOfDay.slice(0, limit)) {
        processed++;
        try {
          const task = taskDoc.data();
          const title = task.title || '';
          const description = task.description || '';

          let inferred = inferTimeOfDayFromContent(title, description);
          if (!inferred) inferred = await llmInfer('task', taskDoc.id, title, description);

          if (inferred) {
            await db.collection('tasks').doc(taskDoc.id).update({
              timeOfDay: inferred,
              timeOfDayPopulatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            updated++;
          } else {
            console.log(`[timeOfDayPopulator] No match for task "${title}" (${taskDoc.id}) — skipping`);
          }
        } catch (taskErr) {
          console.warn(`[timeOfDayPopulator] Failed to process task ${taskDoc.id}:`, taskErr?.message);
          errors++;
        }
      }
    }

    // --- Stories ---
    if (entityTypes.includes('story')) {
      const storiesSnap = await db.collection('stories')
        .where('ownerUid', '==', userId)
        .where('status', 'in', STORY_OPEN_STATUSES)
        .limit(limit * 4)
        .get();

      const needsTimeOfDay = storiesSnap.docs.filter(d => {
        const data = d.data();
        return !data.deleted && isMissingTimeOfDay(data.timeOfDay);
      });

      for (const storyDoc of needsTimeOfDay.slice(0, limit)) {
        processed++;
        try {
          const story = storyDoc.data();
          const title = story.title || '';
          const description = story.description || '';

          let inferred = inferTimeOfDayFromContent(title, description);
          if (!inferred) inferred = await llmInfer('story', storyDoc.id, title, description);

          if (inferred) {
            await db.collection('stories').doc(storyDoc.id).update({
              timeOfDay: inferred,
              timeOfDayPopulatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            updated++;
          } else {
            console.log(`[timeOfDayPopulator] No match for story "${title}" (${storyDoc.id}) — skipping`);
          }
        } catch (storyErr) {
          console.warn(`[timeOfDayPopulator] Failed to process story ${storyDoc.id}:`, storyErr?.message);
          errors++;
        }
      }
    }

  } catch (error) {
    console.error('[timeOfDayPopulator] Batch processing failed:', error?.message);
    errors++;
  }

  return { processed, updated, errors };
}

module.exports = {
  classifyHourToTimeOfDay,
  parseTimeStringToTimeOfDay,
  inferTimeOfDayFromContent,
  populateBlankTimeOfDay,
};
