/**
 * FitnessTabBar — iOS-style fixed bottom tab bar.
 *
 * Renders only on the five linked routes (Home / Fitness / Coach / Goals / Tasks), and only
 * on mobile-width screens. Had no device check at all until 2026-07-25 — it showed on these
 * routes at ANY viewport width, stacking with SidebarLayout's own desktop sidebar rail and
 * reading as two navigation menus on screen simultaneously even on a full desktop window.
 * Mounted once in App.tsx alongside the FloatingAssistantButton so it persists
 * across navigation within that route group without remounting on tab change.
 */

import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, Heart, Dumbbell, Target, ListChecks, type LucideIcon } from 'lucide-react';
import { useDeviceInfo } from '../../utils/deviceDetection';

const BODY_CLASS = 'has-fitness-tab-bar';
const TAB_BAR_HEIGHT_PX = 64;

interface TabDef {
  key: string;
  label: string;
  Icon: LucideIcon;
  path: string;
  matches: (pathname: string) => boolean;
}

// Health is one entry, not two.
//
// Fitness and Coach were separate tabs pointing at separate sections. Both now live in
// the health hub, so a single Health tab lands on it — and the hub opens on its Coach tab
// on a phone, so the coach is still exactly one tap from here.
//
// Finance Coach keeps its own address at /coach/finance and is reached from the finance
// section, not from this bar.
const TABS: TabDef[] = [
  { key: 'home',    label: 'Home',    Icon: Home,       path: '/dashboard', matches: p => p === '/' || p.startsWith('/dashboard') },
  {
    key: 'health', label: 'Health', Icon: Heart, path: '/health',
    matches: p => p.startsWith('/health') || p.startsWith('/fitness') || p.startsWith('/metrics')
      || p.startsWith('/workouts') || p === '/ai-coach' || p.startsWith('/ai-coach/'),
  },
  { key: 'coach',   label: 'Finance', Icon: Dumbbell,  path: '/coach/finance', matches: p => p.startsWith('/coach') },
  { key: 'goals',   label: 'Goals',   Icon: Target,     path: '/goals',     matches: p => p.startsWith('/goals') },
  { key: 'tasks',   label: 'Tasks',   Icon: ListChecks, path: '/tasks',     matches: p => p.startsWith('/tasks') || p.startsWith('/task/') },
];

// The bar shows on any path a tab claims, not only on the tab's own path — otherwise it
// vanishes the moment you switch to /health/zones or /health/workouts.
const SHOW_ON = ['/dashboard', '/health', '/fitness', '/metrics', '/workouts', '/coach', '/goals', '/tasks'];

export const FitnessTabBar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isMobile } = useDeviceInfo();
  const pathname = location.pathname;

  const visible = isMobile && (
    SHOW_ON.some(p => pathname === p || pathname.startsWith(`${p}/`))
    || pathname === '/ai-coach'
    || pathname.startsWith('/ai-coach/')
  );

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
          const Icon = tab.Icon;
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
              <Icon size={20} strokeWidth={active ? 2.25 : 2} aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default FitnessTabBar;
