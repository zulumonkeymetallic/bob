/**
 * ToolbarBannerIcon
 *
 * A single bell-style icon that lives inline in the toolbar. Only renders
 * (as chrome) once its wrapped banner actually has content — detected via
 * MutationObserver on the always-mounted (but visually hidden until opened)
 * content wrapper, same technique the old floating toast stack used. Clicking
 * the icon opens a bounded popover anchored below it; clicking outside or
 * pressing Escape closes it.
 *
 * `prominent` escalates the badge/icon styling — driven by the parent row
 * when more than one banner category is active at once.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';

interface ToolbarBannerIconProps {
  id: string;
  icon: LucideIcon;
  label: string;
  prominent: boolean;
  onVisibilityChange: (id: string, visible: boolean) => void;
  children: React.ReactNode;
}

const ToolbarBannerIcon: React.FC<ToolbarBannerIconProps> = ({ id, icon: Icon, label, prominent, onVisibilityChange, children }) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [hasContent, setHasContent] = useState(false);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const check = () => setHasContent(el.childElementCount > 0);
    check();
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    onVisibilityChange(id, hasContent);
    if (!hasContent) setOpen(false);
  }, [id, hasContent, onVisibilityChange]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: hasContent ? 'block' : 'none' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        title={label}
        style={{
          position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 30, height: 30,
          background: prominent ? 'var(--bg-accent, rgba(95,119,220,0.12))' : 'transparent',
          border: prominent ? '1px solid var(--brand, #5f77dc)' : '1px solid transparent',
          borderRadius: 8,
          color: prominent ? 'var(--brand, #5f77dc)' : 'var(--text, #000)',
          cursor: 'pointer',
        }}
      >
        <Icon size={16} />
        <span
          style={{
            position: 'absolute', top: 2, right: 2,
            width: prominent ? 8 : 6, height: prominent ? 8 : 6,
            borderRadius: '50%',
            background: prominent ? 'var(--brand, #5f77dc)' : 'var(--muted, #9ca3af)',
            border: '1.5px solid var(--panel, #fff)',
          }}
        />
      </button>

      <div
        style={{
          display: open ? 'block' : 'none',
          position: 'absolute', top: '100%', right: 0, marginTop: 6,
          width: 'min(88vw, 340px)',
          maxHeight: 420,
          overflowY: 'auto',
          background: 'var(--panel, #fff)',
          border: '1px solid var(--border, #e5e7eb)',
          borderRadius: 10,
          padding: 8,
          zIndex: 1045,
        }}
      >
        <div ref={innerRef}>{children}</div>
      </div>
    </div>
  );
};

export default ToolbarBannerIcon;
