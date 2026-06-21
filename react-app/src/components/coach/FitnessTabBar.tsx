/**
 * FitnessTabBar — iOS-style fixed bottom tab bar.
 *
 * Renders only on the five linked routes (Home / Fitness / Coach / Goals / Tasks).
 * Mounted once in App.tsx alongside the FloatingAssistantButton so it persists
 * across navigation within that route group without remounting on tab change.
 */

import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const BODY_CLASS = 'has-fitness-tab-bar';
const TAB_BAR_HEIGHT_PX = 64;

interface TabDef {
  key: string;
  label: string;
  icon: string;
  path: string;
  matches: (pathname: string) => boolean;
}

const TABS: TabDef[] = [
  { key: 'home',    label: 'Home',    icon: 'home',       path: '/dashboard', matches: p => p === '/' || p.startsWith('/dashboard') },
  { key: 'fitness', label: 'Fitness', icon: 'heartbeat',  path: '/fitness',   matches: p => p.startsWith('/fitness') },
  { key: 'coach',   label: 'Coach',   icon: 'dumbbell',   path: '/coach',     matches: p => p.startsWith('/coach') || p.startsWith('/ai-coach') },
  { key: 'goals',   label: 'Goals',   icon: 'bullseye',   path: '/goals',     matches: p => p.startsWith('/goals') },
  { key: 'tasks',   label: 'Tasks',   icon: 'list-check', path: '/tasks',     matches: p => p.startsWith('/tasks') || p.startsWith('/task/') },
];

const SHOW_ON = TABS.flatMap(t => [t.path]);

export const FitnessTabBar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;

  const visible = SHOW_ON.some(p => pathname === p || pathname.startsWith(`${p}/`))
    || pathname === '/ai-coach'
    || pathname.startsWith('/ai-coach/');

  useEffect(() => {
    if (!visible) return undefined;
    document.body.classList.add(BODY_CLASS);
    const prevPadding = document.body.style.paddingBottom;
    document.body.style.paddingBottom = `calc(${TAB_BAR_HEIGHT_PX}px + env(safe-area-inset-bottom, 0px))`;
    return () => {
      document.body.classList.remove(BODY_CLASS);
      document.body.style.paddingBottom = prevPadding;
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <nav
      aria-label="Fitness tabs"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1030,
        background: 'var(--bs-body-bg)',
        borderTop: '1px solid var(--bs-border-color)',
        boxShadow: '0 -2px 10px rgba(0,0,0,0.04)',
        paddingBottom: 'env(safe-area-inset-bottom, 0)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
          maxWidth: 680,
          margin: '0 auto',
        }}
      >
        {TABS.map(tab => {
          const active = tab.matches(pathname);
          const colour = active ? 'var(--bs-primary)' : 'var(--bs-secondary)';
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => navigate(tab.path)}
              aria-current={active ? 'page' : undefined}
              aria-label={tab.label}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '8px 4px 6px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                color: colour,
                fontSize: 11,
                fontWeight: active ? 600 : 500,
                cursor: 'pointer',
                transition: 'color 0.15s ease',
              }}
            >
              <i
                className={`fas fa-${tab.icon}`}
                aria-hidden="true"
                style={{ fontSize: 18, lineHeight: 1 }}
              />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default FitnessTabBar;
