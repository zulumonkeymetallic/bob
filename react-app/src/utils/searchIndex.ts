/**
 * searchIndex — the warm corpus behind the toolbar's global search.
 *
 * ## What was wrong
 *
 * The search box queried Firestore on every keystroke: three `getDocs` calls (tasks, stories,
 * goals) behind a 250ms debounce, with nothing cached between them, so typing "hedges" ran five
 * complete searches from cold. Substring matching cannot be expressed as a Firestore query, so
 * each search read the 30 most recently updated documents and filtered them in JavaScript — and
 * when that window missed, which is what happens for anything not touched in the last few days,
 * it fell into a paginated deep scan of up to 600 documents per collection, `await`ed one
 * 120-document page at a time. Up to five serial round-trips times three collections, per
 * search. That is the multi-second wait, and it billed up to ~1,800 reads every time.
 *
 * ## What this does instead
 *
 * The whole account is 1,572 documents (130 goals, 1,033 stories, 409 tasks, counted 2026-08-08).
 * Filtering that in JavaScript takes well under a millisecond, so the corpus is fetched once per
 * session and every keystroke after that is a synchronous array scan. No debounce, no network,
 * and no stale-response race — there is nothing asynchronous left between a character and its
 * results, so a slow early query can no longer overwrite a later one's output.
 *
 * Two tiers, matching `goalPickerCache`: in-memory, then localStorage, then Firestore. The
 * cached copy is returned immediately and a refresh runs in the background.
 *
 * ## Deliberate query choices
 *
 * No `orderBy`. Firestore drops documents that lack the ordering field, and the old query
 * ordered by `updatedAt` — so anything never updated since creation was invisible to search.
 * Fetching the collection whole avoids that, and needs no composite index.
 *
 * No `persona` in the `where` either, for the same reason: it excludes documents where the field
 * is absent. Persona is applied client-side by `visibleForPersona`, which treats a missing
 * persona as visible — the rule the goal picker in `GlobalSearchBar` already used.
 */
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { excludeSoftDeleted } from './softDelete';
import { toMillis } from './timestamps';

export type SearchEntityType = 'task' | 'story' | 'goal';

export interface SearchRow {
  id: string;
  type: SearchEntityType;
  title: string;
  ref?: string;
  /**
   * Memory tier only — `persistIndex` strips it. See the note there: descriptions are most of
   * the payload and localStorage has a hard quota shared with every other cache in the app.
   */
  description?: string;
  persona?: string | null;
  updatedAt?: number;
}

interface CachePayload {
  uid: string;
  updatedAt: number;
  rows: SearchRow[];
}

/**
 * Long, for the same reason as the goal picker's: the fallback is not "slightly stale results"
 * but "the spinner again". A refresh is fired on every warm-up regardless, so this only governs
 * the first paint after a cold start.
 */
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * A ceiling, not a page size — the real collections are an order of magnitude below it. Without
 * an `orderBy` a truncated read would drop an arbitrary subset rather than the oldest, so this
 * exists to bound a pathological account, not to shape normal results. `indexWasTruncated`
 * reports when it bites.
 */
const MAX_DOCS_PER_COLLECTION = 4000;

/** Enough to match on, far short of storing the document. Search is a substring test. */
const DESCRIPTION_CHARS = 240;

const CACHE_KEY = (uid: string) => `bob_search_index_${uid}`;

const memory = new Map<string, SearchRow[]>();
const inFlight = new Map<string, Promise<SearchRow[]>>();
const truncated = new Set<string>();

const COLLECTIONS: Array<{ name: 'tasks' | 'stories' | 'goals'; type: SearchEntityType }> = [
  { name: 'tasks', type: 'task' },
  { name: 'stories', type: 'story' },
  { name: 'goals', type: 'goal' },
];

/** True when a collection hit `MAX_DOCS_PER_COLLECTION`, i.e. the index is knowingly partial. */
export function indexWasTruncated(uid: string): boolean {
  return truncated.has(uid);
}

export function loadCachedIndex(uid: string): SearchRow[] | null {
  if (!uid) return null;
  const inMemory = memory.get(uid);
  if (inMemory) return inMemory;
  try {
    const raw = localStorage.getItem(CACHE_KEY(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachePayload;
    if (parsed.uid !== uid || !Array.isArray(parsed.rows)) return null;
    if (Date.now() - parsed.updatedAt > TTL_MS) return null;
    memory.set(uid, parsed.rows);
    return parsed.rows;
  } catch {
    return null;
  }
}

/**
 * Descriptions are dropped on the way to localStorage. They are the bulk of the payload, and a
 * cold start that can match titles and refs instantly is worth far more than one that can also
 * match description text but risks blowing the quota for every other cache on the origin. The
 * background refresh restores description matching a moment later.
 */
function persistIndex(uid: string, rows: SearchRow[]): void {
  if (!uid) return;
  memory.set(uid, rows);
  try {
    const slim = rows.map(({ description, ...rest }) => rest);
    const payload: CachePayload = { uid, updatedAt: Date.now(), rows: slim };
    localStorage.setItem(CACHE_KEY(uid), JSON.stringify(payload));
  } catch {
    // Private mode, or the quota is full. The in-memory tier still serves this session.
  }
}

function toRow(id: string, data: any, type: SearchEntityType): SearchRow {
  const ref = data.ref || data.reference || data.referenceNumber || data.displayId || undefined;
  const description = String(data.description || '').slice(0, DESCRIPTION_CHARS);
  return {
    id,
    type,
    title: String(data.title || ''),
    ref: ref ? String(ref) : undefined,
    description: description || undefined,
    persona: data.persona ?? null,
    updatedAt: toMillis(data.updatedAt) ?? undefined,
  };
}

/** Every searchable document the user owns, newest cache written as a side effect. */
export async function fetchSearchIndex(uid: string): Promise<SearchRow[]> {
  if (!uid) return [];
  const existing = inFlight.get(uid);
  if (existing) return existing;

  const request = (async () => {
    const perCollection = await Promise.all(
      COLLECTIONS.map(async ({ name, type }) => {
        const snap = await getDocs(query(
          collection(db, name),
          where('ownerUid', '==', uid),
          limit(MAX_DOCS_PER_COLLECTION),
        ));
        if (snap.size >= MAX_DOCS_PER_COLLECTION) truncated.add(uid);
        // Soft-deleted documents are merged-away iOS duplicates. Search listed them until now:
        // excludeSoftDeleted was imported by GlobalSearchBar but only ever applied to the goal
        // list it hands the edit modals.
        return excludeSoftDeleted(snap.docs.map((d) => toRow(d.id, d.data(), type)));
      }),
    );
    const rows = perCollection.flat();
    persistIndex(uid, rows);
    return rows;
  })().finally(() => inFlight.delete(uid));

  inFlight.set(uid, request);
  return request;
}

/** Forget everything for a user — persona switches do not need this, sign-out does. */
export function clearSearchIndex(uid: string): void {
  memory.delete(uid);
  truncated.delete(uid);
  try {
    localStorage.removeItem(CACHE_KEY(uid));
  } catch {
    // Nothing to do; the in-memory tier is already gone.
  }
}

/**
 * A document with no `persona` belongs to whoever is looking. Most of the older records have no
 * persona field at all, and hiding them would make search worse than it was.
 */
export function visibleForPersona(rows: SearchRow[], persona?: string | null): SearchRow[] {
  if (!persona) return rows;
  return rows.filter((row) => !row.persona || row.persona === persona);
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Rank rows against a free-text query, best first.
 *
 * The ladder is `rankGoals`' one, extended with a description tier at the bottom — the old search
 * treated a title hit and a buried description hit as equally good and then ordered the lot by
 * how recently they were touched, which is why typing an exact title could still leave it
 * several rows down.
 *
 * Empty query returns nothing, not everything: this feeds a dropdown, not a list page.
 */
export function rankSearchRows(rows: SearchRow[], search: string): SearchRow[] {
  const q = String(search || '').trim().toLowerCase();
  if (!q) return [];

  const boundary = new RegExp(`\\b${escapeRegExp(q)}`);
  const scored: Array<{ row: SearchRow; score: number }> = [];

  for (const row of rows) {
    const title = row.title.toLowerCase();
    const ref = String(row.ref || '').toLowerCase();
    let score = -1;

    if (title === q) score = 0;
    else if (ref && ref === q) score = 1;
    else if (title.startsWith(q)) score = 2;
    // Word-boundary hit beats one buried mid-word, so "book" prefers "Book hotel in Beijing"
    // over "Rebook the bloodwork".
    else if (boundary.test(title)) score = 3;
    else if (title.includes(q)) score = 4;
    else if (ref.includes(q)) score = 5;
    else if (row.description && row.description.toLowerCase().includes(q)) score = 6;

    if (score >= 0) scored.push({ row, score });
  }

  return scored
    .sort((a, b) => (
      a.score - b.score
      || (b.row.updatedAt || 0) - (a.row.updatedAt || 0)
      || a.row.title.localeCompare(b.row.title)
    ))
    .map((x) => x.row);
}
