/**
 * Focus-goals section for the NotificationStream popover.
 * Shows every isBannerGoal-flagged goal as a plain row with a progress bar
 * (story completion), matching DeferralCandidatesBanner's list style.
 * Clicking a row or "View all" navigates to /focus-goals.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Goal, Story } from '../types';
import { getThemeById, getThemeByName, GLOBAL_THEMES } from '../constants/globalThemes';

const BANNER_TAGS = new Set(['banner', 'daily-banner', 'focus-banner', 'rotation-banner', 'project45']);

function isBannerEligible(goal: Goal): boolean {
  const tags = Array.isArray((goal as any).tags)
    ? (goal as any).tags.map((t: any) => String(t || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const hasTag = tags.some((t: string) => BANNER_TAGS.has(t));
  const hasField =
    (goal as any).showInDashboardBanner === true ||
    (goal as any).dashboardBanner === true ||
    (goal as any).isBannerGoal === true;
  // Exclude binned goals (status 4)
  const status = Number((goal as any).status ?? 0);
  return (hasTag || hasField) && status !== 4;
}

function resolveGoalTheme(themeValue: any): { color: string; label: string } {
  if (themeValue == null) return { color: GLOBAL_THEMES[0].color, label: GLOBAL_THEMES[0].label };
  if (typeof themeValue === 'number') {
    const t = getThemeById(themeValue);
    return { color: t.color, label: t.label };
  }
  if (typeof themeValue === 'string' && themeValue.trim()) {
    const t = getThemeByName(themeValue.trim());
    return { color: t.color, label: t.label };
  }
  return { color: GLOBAL_THEMES[0].color, label: GLOBAL_THEMES[0].label };
}

const GlobalGoalFocusBanner: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const navigate = useNavigate();

  const [goals, setGoals]   = useState<Goal[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [pots, setPots]     = useState<Record<string, { name: string; balance: number }>>({});

  // Goals subscription
  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) { setGoals([]); return; }
    const q = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
    );
    const unsub = onSnapshot(q,
      (snap) => setGoals(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Goal))),
      (err) => console.warn('GlobalGoalFocusBanner goals:', err.code),
    );
    return () => unsub();
  }, [currentUser?.uid, currentPersona]);

  // Stories subscription (for per-goal completion progress)
  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) { setStories([]); return; }
    const q = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
    );
    const unsub = onSnapshot(q,
      (snap) => setStories(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Story))),
      (err) => console.warn('GlobalGoalFocusBanner stories:', err.code),
    );
    return () => unsub();
  }, [currentUser?.uid, currentPersona]);

  // Monzo pots subscription (for savings progress)
  useEffect(() => {
    if (!currentUser?.uid) { setPots({}); return; }
    const q = query(collection(db, 'monzo_pots'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(q,
      (snap) => {
        const map: Record<string, { name: string; balance: number }> = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          if (data.potId) map[data.potId] = { name: data.name || '', balance: data.balance || 0 };
        });
        setPots(map);
      },
      () => { /* non-critical */ },
    );
    return () => unsub();
  }, [currentUser?.uid]);

  const bannerGoals = useMemo(
    () => goals.filter(isBannerEligible).sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''))),
    [goals],
  );

  // Per-goal story completion stats
  const storyStats = useMemo(() => {
    const map = new Map<string, { total: number; done: number }>();
    for (const s of stories) {
      const gid = (s as any).goalId;
      if (!gid) continue;
      const status = Number((s as any).status ?? 0);
      if (status === 4) continue;
      const cur = map.get(gid) ?? { total: 0, done: 0 };
      cur.total++;
      if (status === 3) cur.done++;
      map.set(gid, cur);
    }
    return map;
  }, [stories]);

  if (bannerGoals.length === 0) return null;

  return (
    <div style={{ minWidth: 260 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>
          Focus goals
        </span>
        <button
          onClick={() => navigate('/focus-goals')}
          style={{ background: 'none', border: 'none', padding: 0, fontSize: 10, color: 'var(--brand, #5f77dc)', cursor: 'pointer', textDecoration: 'underline' }}
        >
          View all
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {bannerGoals.map((goal) => {
          const { color: themeColor } = resolveGoalTheme((goal as any).theme);
          const stats = storyStats.get(goal.id);
          const total = stats?.total ?? null;
          const done = stats?.done ?? null;
          const progressPercent = total ? Math.round(((done ?? 0) / total) * 100) : 0;

          const kpis = Array.isArray((goal as any).kpis) ? (goal as any).kpis : [];
          const kpiLabel = kpis.length > 0
            ? kpis.slice(0, 2).map((k: any) => `${k.name}: ${k.target}${k.unit ?? ''}`).join(' · ')
            : undefined;

          const potId = (goal as any).monzoPotId || (goal as any).linkedPotId || (goal as any).potId;
          const potBalance = potId && pots[potId] ? pots[potId].balance : 0;
          const estimated = Number((goal as any).estimatedCost || 0);
          const hasSavings = estimated > 0 && potId;
          const savingsPct = hasSavings
            ? Math.min(100, Math.round(((potBalance / 100) / estimated) * 100))
            : null;

          const metaLabel = [
            total != null ? `${done ?? 0}/${total} stories` : null,
            kpiLabel,
            savingsPct != null ? `Savings ${savingsPct}%` : null,
          ].filter(Boolean).join(' · ');

          return (
            <button
              key={goal.id}
              onClick={() => navigate('/focus-goals')}
              style={{
                display: 'block', width: '100%',
                background: 'var(--notion-hover, rgba(0,0,0,0.04))',
                border: '1px solid var(--border, #e5e7eb)', borderRadius: 6,
                padding: '5px 8px', textAlign: 'left', cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={goal.title}>
                  {goal.title}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, flexShrink: 0, color: 'var(--muted)' }}>{progressPercent}%</span>
              </div>
              <div style={{ height: 4, background: 'var(--border, #e5e7eb)', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progressPercent}%`, background: themeColor, borderRadius: 2 }} />
              </div>
              {metaLabel && (
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{metaLabel}</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default GlobalGoalFocusBanner;
