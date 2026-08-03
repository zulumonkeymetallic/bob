/**
 * Soft deletion — `deleted: true` means "hide this", and until 2026-08-03 nothing on the web
 * honoured it.
 *
 * ## Why this exists
 *
 * The iOS duplicate merge (DuplicateReviewSheet in bob-ios) does not hard-delete the losing
 * copies. It sets `deleted: true`, deliberately, so a wrong merge is recoverable — its comment
 * says "`deleted: true` is what the server filters on".
 *
 * That was not true. No web query, no list, no board and no Kanban surface filtered on it, and
 * the Firestore snapshot did not either. So every duplicate Jim merged on iOS stayed fully
 * visible on the web, which read as "the deduplication is not working".
 *
 * Measured on 2026-08-03, before this landed: 220 open stories and 3 open tasks carried
 * `deleted: true` and were still on screen. Filtering them out takes the open-story duplicate
 * count from 139 groups / 209 redundant copies to **zero** — the merges had all worked. One
 * story title existed 14 times on the board; 13 of those were already merged away.
 *
 * ## Why a client-side filter rather than a query
 *
 * Firestore cannot express "field is false OR missing" in one `where`. The overwhelming
 * majority of documents have no `deleted` field at all, so `where('deleted', '==', false)`
 * would return almost nothing. The filter has to happen after the read.
 */

/** True when a document has been soft-deleted and should not be shown. */
export const isSoftDeleted = (item: any): boolean => item?.deleted === true;

/**
 * Drop soft-deleted documents from a list.
 *
 * Strictly `=== true`: `deleted` is absent on most documents and must not be coerced, and a
 * stray `deleted: 'false'` string from an old writer must not hide a live item.
 */
export const excludeSoftDeleted = <T,>(items: T[]): T[] =>
  (items || []).filter((item) => !isSoftDeleted(item));
