/**
 * useDetailPaneUrlSync — keeps the open entity detail in the URL as `?detail=<type>:<ref>`.
 *
 * Without this the detail pane is pure component state: reload, or send someone the link you
 * are looking at, and it comes back empty. That is tolerable when the detail is a transient
 * overlay; it is not once the tablet shell makes it half the screen.
 *
 * A SEARCH PARAM, not a route segment. A segment would need a nested child route per list
 * route, and `/goals/:id` is already taken — it renders GoalsManagement plus a modal, which is
 * a different thing. A param is orthogonal to routing, so it works identically on all ~55
 * destinations with no changes to the route table, on phone, tablet and desktop alike.
 *
 * Mount once, in the layout shell.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSidebar } from '../contexts/SidebarContext';
import { resolveEntityByRef } from '../utils/entityLookup';
import { DETAIL_COLLECTIONS, formatDetailParam, parseDetailParam } from '../utils/detailParam';

export const useDetailPaneUrlSync = (): void => {
  const { selectedItem, selectedType, isVisible, showSidebar } = useSidebar();
  const [searchParams, setSearchParams] = useSearchParams();
  const param = searchParams.get('detail');

  // The value the URL and the context currently agree on. Both effects below check it before
  // acting, which is what stops them ping-ponging: the write sets the URL and records it here,
  // so the read sees its own change and does nothing.
  const syncedRef = useRef<string | null>(null);

  // Hydration gate. On a fresh load with `?detail=` present the context is necessarily empty,
  // so the write effect below would compute "nothing is open", strip the param, and destroy
  // the value the read effect was about to resolve — the pane silently failed to restore.
  // Seeded from the param on the first render, before any effect can touch the URL.
  //
  // State rather than a ref: releasing the gate has to re-run the write effect, which is what
  // clears a param whose entity turned out not to exist. With a ref the stale value sat in the
  // URL until the next unrelated interaction, and got copied into any link shared from there.
  const [hydrated, setHydrated] = useState(() => !parseDetailParam(param));

  const describe = useCallback((): string | null => {
    if (!isVisible || !selectedItem || !selectedType) return null;
    const ref = (selectedItem as any).ref || (selectedItem as any).referenceNumber || selectedItem.id;
    return formatDetailParam(selectedType, ref);
  }, [isVisible, selectedItem, selectedType]);

  // context → URL
  useEffect(() => {
    if (!hydrated) return;
    const desired = describe();
    if (desired === param) {
      syncedRef.current = desired;
      return;
    }
    syncedRef.current = desired;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (desired) next.set('detail', desired);
        else next.delete('detail');
        return next;
      },
      // replace, so opening and closing details does not fill the back button with noise.
      { replace: true },
    );
  }, [describe, hydrated, param, setSearchParams]);

  // URL → context (deep links, reloads, back/forward)
  useEffect(() => {
    if (!param || param === syncedRef.current) return;
    const parsed = parseDetailParam(param);
    if (!parsed) {
      // Malformed param: open the gate so the write effect can tidy it away.
      setHydrated(true);
      return;
    }

    let cancelled = false;
    syncedRef.current = param;
    (async () => {
      const entity = await resolveEntityByRef<any>(DETAIL_COLLECTIONS[parsed.type], parsed.ref);
      if (cancelled) return;
      if (entity) showSidebar(entity, parsed.type);
      // Released whether or not the lookup succeeded. A stale or deleted ref leaves the pane
      // closed and the write effect then clears the param, rather than stranding the user on
      // an error screen or wedging the gate shut so the URL never updates again.
      setHydrated(true);
    })();

    return () => { cancelled = true; };
  }, [param, showSidebar]);
};

export default useDetailPaneUrlSync;
