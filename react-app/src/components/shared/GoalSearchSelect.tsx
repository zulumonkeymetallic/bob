/**
 * GoalSearchSelect — single-select goal picker with real substring search.
 *
 * Replaces the `<input list=...>` + `<datalist>` pattern used across the add/edit modals. That
 * pattern has two defects the moment you have more than a handful of goals:
 *
 *  1. Matching is the browser's, not ours — behaviour differs between Chrome, Firefox and
 *     Safari, and none of them will match a ref or rank the hits.
 *  2. The typed value had to EXACTLY equal a goal title before the form would resolve it to an
 *     id. Typing a fragment like "cta" and tabbing away cleared the selection and produced
 *     "No goal matches", which is indistinguishable from search being broken.
 *
 * Here the input is a query, the list is ours, and selection happens by choosing a row —
 * so a fragment is a perfectly good way to find something.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Form, Spinner } from 'react-bootstrap';
import { Check, ChevronDown, X } from 'lucide-react';
import { GLOBAL_THEMES } from '../../constants/globalThemes';
import { goalThemeColor } from '../../utils/storyCardFormatting';
import { rankGoals, type GoalOption } from '../../utils/goalPickerCache';
import { themeVars } from '../../utils/themeVars';
import { Z } from '../../utils/layoutTokens';

/** Enough to scroll through; past this, typing another character beats scrolling. */
const MAX_VISIBLE = 50;
const LIST_MAX_H = 280;

interface GoalSearchSelectProps {
  goals: GoalOption[];
  /** Selected goal id, or '' for none. */
  value: string;
  onChange: (goalId: string, goal: GoalOption | null) => void;
  placeholder?: string;
  /** Shows a spinner in the field while the first load is in flight. */
  loading?: boolean;
  disabled?: boolean;
  id?: string;
}

const GoalSearchSelect: React.FC<GoalSearchSelectProps> = ({
  goals, value, onChange, placeholder = 'Search goals by title or ref...', loading = false, disabled, id,
}) => {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => goals.find((g) => g.id === value) || null, [goals, value]);
  const matches = useMemo(() => rankGoals(goals, search), [goals, search]);
  const visible = matches.slice(0, MAX_VISIBLE);

  // Reset the highlight whenever the result set changes, so Enter never picks a row that
  // scrolled out from under the user's last keystroke.
  useEffect(() => { setActiveIndex(0); }, [search, goals]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
      setSearch('');
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  /**
   * The list is portalled to <body> and positioned in viewport coordinates.
   *
   * It cannot be an absolutely-positioned child: these pickers live inside a Bootstrap modal
   * whose body scrolls, and any overflow ancestor clips an absolute child — the dropdown
   * showed exactly one row and the rest was cut off. A portal escapes the clip; the cost is
   * having to track the anchor's position ourselves.
   */
  const [rect, setRect] = useState<{ top: number; left: number; width: number; flip: boolean } | null>(null);
  const reposition = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const flip = below < LIST_MAX_H && r.top > below;
    setRect({
      top: flip ? r.top - Math.min(LIST_MAX_H, r.top - 8) - 4 : r.bottom + 4,
      left: r.left,
      width: r.width,
      flip,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) { setRect(null); return; }
    reposition();
    // `true` for capture: the modal body is the element that actually scrolls, and a scroll
    // event on it does not bubble to window.
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition]);

  const choose = useCallback((goal: GoalOption) => {
    onChange(goal.id, goal);
    setSearch('');
    setOpen(false);
  }, [onChange]);

  const clear = useCallback(() => {
    onChange('', null);
    setSearch('');
    setOpen(true);
    inputRef.current?.focus();
  }, [onChange]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActiveIndex((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        if (next < 0) return visible.length - 1;
        if (next >= visible.length) return 0;
        return next;
      });
      return;
    }
    if (e.key === 'Enter') {
      // Only swallow Enter when it is actually selecting something — otherwise it must reach
      // the surrounding form.
      if (open && visible[activeIndex]) {
        e.preventDefault();
        choose(visible[activeIndex]);
      }
      return;
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();   // do not close the modal we are sitting in
      setOpen(false);
      setSearch('');
    }
  };

  const themeColorFor = (goal: GoalOption) =>
    goalThemeColor(goal as any, GLOBAL_THEMES) || 'var(--brand, #5f77dc)';

  // The field shows the query while searching and the chosen goal otherwise, so the selection
  // stays visible instead of being wiped the moment the box takes focus.
  const displayValue = open ? search : (selected?.title ?? '');

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <Form.Control
          id={id}
          ref={inputRef as any}
          value={displayValue}
          disabled={disabled}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={selected ? selected.title : placeholder}
          autoComplete="off"
          style={{ paddingRight: 56 }}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        <div style={{
          position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
          display: 'flex', alignItems: 'center', gap: 4, pointerEvents: 'none',
        }}>
          {loading && <Spinner animation="border" size="sm" />}
          {selected && !loading && (
            <button
              type="button"
              onClick={clear}
              title="Clear selection"
              style={{
                pointerEvents: 'auto', background: 'none', border: 'none', padding: 0,
                lineHeight: 0, color: themeVars.muted as string, cursor: 'pointer',
              }}
            >
              <X size={14} />
            </button>
          )}
          <ChevronDown size={14} style={{ color: themeVars.muted as string }} />
        </div>
      </div>

      {open && rect && createPortal(
        <div
          ref={listRef}
          role="listbox"
          style={{
            position: 'fixed', top: rect.top, left: rect.left, width: rect.width,
            // Must clear the modal this is usually anchored inside — see Z.menuInModal for why
            // that is 9999 here rather than Bootstrap's 1055.
            zIndex: Z.menuInModal,
            background: 'var(--card, #fff)', color: themeVars.text as string,
            border: '1px solid var(--line, #e5e7eb)', borderRadius: 6,
            boxShadow: '0 6px 20px rgba(0,0,0,0.28)',
            maxHeight: LIST_MAX_H, overflowY: 'auto',
          }}
        >
          {goals.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 13, color: themeVars.muted as string }}>
              {loading ? 'Loading goals…' : 'No goals found.'}
            </div>
          )}
          {goals.length > 0 && visible.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 13, color: themeVars.muted as string }}>
              Nothing matches “{search.trim()}”.
            </div>
          )}
          {visible.map((goal, i) => {
            const isActive = i === activeIndex;
            const isSelected = goal.id === value;
            const isDone = Number(goal.status) === 4;
            return (
              <div
                key={goal.id}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIndex(i)}
                // mousedown, not click: the input's blur would otherwise close the list before
                // the click landed.
                onMouseDown={(e) => { e.preventDefault(); choose(goal); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                  cursor: 'pointer', fontSize: 13,
                  background: isActive ? 'var(--panel, #f3f4f6)' : 'transparent',
                }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: 4, flexShrink: 0,
                  background: themeColorFor(goal),
                }} />
                <span style={{
                  flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap', opacity: isDone ? 0.6 : 1,
                }}>
                  {goal.title || '(untitled)'}
                </span>
                {isDone && (
                  <span style={{ fontSize: 10, color: themeVars.muted as string, flexShrink: 0 }}>done</span>
                )}
                {goal.ref && (
                  <span style={{ fontSize: 10, color: themeVars.muted as string, flexShrink: 0 }}>{goal.ref}</span>
                )}
                {isSelected && <Check size={13} style={{ flexShrink: 0 }} />}
              </div>
            );
          })}
          {matches.length > visible.length && (
            <div style={{
              padding: '6px 10px', fontSize: 11, color: themeVars.muted as string,
              borderTop: '1px solid var(--line, #e5e7eb)',
            }}>
              Showing {visible.length} of {matches.length} — keep typing to narrow it down.
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
};

export default GoalSearchSelect;
