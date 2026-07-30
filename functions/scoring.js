/**
 * BOB's criticality scorer.
 *
 * This algorithm runs in TWO places because BOB has to work fully offline:
 *   here, and bob-ios/BOB/Sources/Sync/WorkItemScoring.swift
 *
 * That duplication is deliberate, and PORTING_CONTRACT 2.3 is the record of what it
 * costs — four divergences that survived until someone read both listings side by side,
 * plus a fifth (theme ids vs names) found on 2026-07-28. Extracted into its own module
 * so it can be exercised by scoring.test.js against the same golden vectors the iOS
 * suite uses.
 *
 * Change a constant here and you change it in the Swift file and in scoringVectors.json,
 * in the same commit.
 */

/**
 * Canonical theme id from either representation Firestore actually holds: an integer id,
 * a display name ("Health & Fitness"), a legacy fragment ("Growth"), or a numeric string.
 * Mirrors WorkItemScoring.normalisedThemeId in the iOS app; the two are pinned together
 * by bob-ios/BOBTests/ScoringVectors.json.
 */
const THEME_NAME_KEYS = [
  [1, ['health', 'fitness']],
  [2, ['career', 'professional']],
  [3, ['finance', 'wealth']],
  [4, ['learning', 'education']],
  [5, ['family', 'relationship']],
  [6, ['hobby', 'hobbies']],
  [7, ['travel', 'adventure']],
  [8, ['home', 'living']],
  [9, ['spiritual', 'growth']],
  [10, ['chore']],
  [11, ['rest', 'recovery']],
  [12, ['work (main', 'main gig']],
  [13, ['sleep']],
  [15, ['side gig']],
];

function normaliseThemeId(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const name = String(raw || '').toLowerCase().trim();
  if (!name) return null;
  if (/^\d+$/.test(name)) return parseInt(name, 10);
  for (const [id, keys] of THEME_NAME_KEYS) {
    if (keys.some((k) => name.includes(k))) return id;
  }
  return null;
}

function computeCriticalityScore({ dueDateMs, createdAtMs, goalDueMs, theme, points, taskType }) {
  let score = 0;
  const now = Date.now();

  // Due date urgency
  if (dueDateMs) {
    const days = Math.max(-30, Math.min(120, (dueDateMs - now) / 86400000));
    if (days <= 0) score += 40;
    else if (days <= 3) score += 30;
    else if (days <= 7) score += 22;
    else if (days <= 14) score += 15;
    else if (days <= 30) score += 8;
  }

  // Age
  if (createdAtMs) {
    const ageDays = Math.max(0, (now - createdAtMs) / 86400000);
    if (ageDays > 30) score += 15;
    else if (ageDays > 14) score += 10;
    else if (ageDays > 7) score += 6;
  }

  // Theme weighting.
  //
  // Firestore stores `theme` as BOTH an id and a name — on a 500-story sample of the
  // owner's account, 314 ints and 174 strings. This block used to match names only, via
  // String(theme).includes('health'), so an id of 1 stringified to "1", matched nothing,
  // and scored as unthemed. iOS had the mirror-image bug (it read `theme as? Int` and
  // dropped every name to nil), so for any themed item one engine added 10 and the other
  // added 0 — an exact inversion, on roughly two thirds of themed stories.
  //
  // Both sides now normalise to the canonical 16-theme id first. Pinned by the shared
  // golden vectors in bob-ios/BOBTests/ScoringVectors.json — change this and change those.
  const themeId = normaliseThemeId(theme);
  if ([1, 2, 3, 4, 9].includes(themeId)) score += 10;   // Health, Career, Wealth, Learning, Spiritual
  else if (themeId === 6) score -= 5;                    // Hobbies & Interests

  // Goal due date
  if (goalDueMs) {
    const daysGoal = Math.max(-30, Math.min(180, (goalDueMs - now) / 86400000));
    if (daysGoal <= 0) score += 15;
    else if (daysGoal <= 7) score += 10;
    else if (daysGoal <= 30) score += 5;
  }

  // Size: smaller tasks due soon get a nudge; very large items less likely to be immediate
  if (points != null) {
    if (points <= 2) score += 6;
    else if (points >= 8) score -= 4;
  }

  // Cap passive/recurring types to prevent them appearing in Top 3 or dominating AI ranking:
  //   chore / habit / routine → max 30 (surfaced in daily plan, not sprint board)
  //   read / watch            → max 10 (media consumption, not actionable work)
  const type = String(taskType || '').toLowerCase();
  if (['chore', 'habit', 'routine'].includes(type)) {
    score = Math.min(30, score);
  } else if (['read', 'watch'].includes(type)) {
    score = Math.min(10, score);
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

module.exports = { computeCriticalityScore, normaliseThemeId };
