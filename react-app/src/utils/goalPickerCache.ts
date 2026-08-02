/**
 * goalPickerCache — a warm list of goals for the "which goal is this under?" pickers.
 *
 * Those pickers used to fetch every goal (and, in the FAB's case, every story) on each open,
 * and render nothing until both finished. On a real account that is ~120 goals behind ~920
 * stories, so the goal box sat empty for seconds every single time — long enough to read as
 * "search is broken" rather than "search is slow".
 *
 * So: persist the last known list per user and hand it back synchronously on the next open,
 * then refresh from Firestore in the background and overwrite. The picker is a lookup over
 * titles the user themselves wrote; a list that is a few minutes stale is not wrong in any way
 * that matters, and a goal created since simply arrives with the refresh.
 *
 * localStorage, matching the sprint cache in SprintContext — same TTL-stamped payload shape,
 * same "never throw at the caller" contract, since private-mode browsers reject writes.
 */
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';

export interface GoalOption {
  id: string;
  title: string;
  ref?: string;
  theme?: string | number | null;
  status?: number | string | null;
  parentGoalId?: string | null;
}

interface CachePayload {
  uid: string;
  updatedAt: number;
  goals: GoalOption[];
}

/**
 * Long, because the fallback is not "stale data" but "an empty box for several seconds".
 * A refresh is fired on every open regardless, so the only window in which this matters is
 * the first paint.
 */
const TTL_MS = 24 * 60 * 60 * 1000;

const cacheKey = (uid: string) => `bob_goal_picker_cache_${uid}`;

/** In-memory tier, so a second modal open in the same session skips even the JSON parse. */
const memory = new Map<string, GoalOption[]>();

export function loadCachedGoals(uid: string): GoalOption[] | null {
  if (!uid) return null;
  const inMemory = memory.get(uid);
  if (inMemory) return inMemory;
  try {
    const raw = localStorage.getItem(cacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachePayload;
    if (parsed.uid !== uid || !Array.isArray(parsed.goals)) return null;
    if (Date.now() - parsed.updatedAt > TTL_MS) return null;
    memory.set(uid, parsed.goals);
    return parsed.goals;
  } catch {
    return null;
  }
}

export function persistGoals(uid: string, goals: GoalOption[]): void {
  if (!uid) return;
  memory.set(uid, goals);
  try {
    const payload: CachePayload = { uid, updatedAt: Date.now(), goals };
    localStorage.setItem(cacheKey(uid), JSON.stringify(payload));
  } catch {
    // Private mode, or the quota is full. The in-memory tier still works for this session.
  }
}

/**
 * Every goal the user owns, newest cache written as a side effect.
 *
 * Deliberately no `orderBy` and no status filter: ordering by a field drops documents that
 * lack it (the reason a previous version of this query hid every priority-less goal), and a
 * picker that silently omits completed goals cannot be used to file work against one.
 */
export async function fetchGoalsForPicker(uid: string): Promise<GoalOption[]> {
  const snap = await getDocs(query(collection(db, 'goals'), where('ownerUid', '==', uid)));
  const goals: GoalOption[] = snap.docs.map((d) => {
    const data = d.data() as any;
    return {
      id: d.id,
      title: String(data.title || ''),
      ref: data.ref || undefined,
      theme: data.theme ?? null,
      status: data.status ?? null,
      parentGoalId: data.parentGoalId || null,
    };
  });
  persistGoals(uid, goals);
  return goals;
}

/**
 * Rank goals against a free-text query, best first.
 *
 * Substring, not prefix — "cta" has to find "Improve CTA conversion", which is the specific
 * complaint that prompted this: a native <datalist> leaves matching to the browser, and the
 * value it produces then had to EXACTLY equal a goal title before the form would accept it,
 * so typing a fragment resolved to nothing at all.
 *
 * Matches on the ref too, so pasting GR-12345 finds the goal.
 */
export function rankGoals(goals: GoalOption[], search: string): GoalOption[] {
  const q = search.trim().toLowerCase();
  if (!q) {
    return [...goals].sort((a, b) => a.title.localeCompare(b.title));
  }

  const scored: Array<{ goal: GoalOption; score: number }> = [];
  for (const goal of goals) {
    const title = goal.title.toLowerCase();
    const ref = String(goal.ref || '').toLowerCase();
    let score = -1;

    if (title === q) score = 0;
    else if (ref && ref === q) score = 1;
    else if (title.startsWith(q)) score = 2;
    // Word-boundary hit ranks above a match buried mid-word, so "cta" prefers
    // "Improve CTA conversion" over "Punctate lesions".
    else if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(title)) score = 3;
    else if (title.includes(q)) score = 4;
    else if (ref.includes(q)) score = 5;

    if (score >= 0) scored.push({ goal, score });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.goal.title.localeCompare(b.goal.title))
    .map((x) => x.goal);
}
