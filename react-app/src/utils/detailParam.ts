/**
 * detailParam — parsing for the `?detail=<type>:<ref>` search param that mirrors the open
 * entity detail pane.
 *
 * Deliberately separate from the hook that uses it (hooks/useDetailPaneUrlSync). The hook
 * imports react-router-dom, which is ESM-only from v7 and cannot currently be resolved by
 * CRA's Jest — anything importing it becomes untestable. Keeping the parsing pure means the
 * part with the edge cases is the part that can be tested.
 */

export type DetailType = 'goal' | 'story' | 'task';

export const DETAIL_COLLECTIONS: Record<DetailType, 'goals' | 'stories' | 'tasks'> = {
  goal: 'goals',
  story: 'stories',
  task: 'tasks',
};

const isDetailType = (v: string): v is DetailType =>
  v === 'goal' || v === 'story' || v === 'task';

/**
 * `story:ST-12345` → { type, ref }.
 *
 * Splits on the FIRST colon only, because a raw Firestore doc id is a legitimate ref and may
 * contain more. Anything malformed returns null rather than throwing: the param is shareable
 * and hand-editable, and it is read in an effect that runs on every route.
 */
export const parseDetailParam = (
  raw: string | null | undefined,
): { type: DetailType; ref: string } | null => {
  if (!raw) return null;
  const idx = raw.indexOf(':');
  if (idx <= 0) return null;
  const type = raw.slice(0, idx);
  const ref = raw.slice(idx + 1).trim();
  return isDetailType(type) && ref ? { type, ref } : null;
};

/** The inverse: what the URL should say for a given open item. */
export const formatDetailParam = (type: DetailType, refOrId: string): string =>
  `${type}:${refOrId}`;
