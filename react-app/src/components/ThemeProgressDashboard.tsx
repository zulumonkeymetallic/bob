import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Container } from 'react-bootstrap';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { Goal, Story, Sprint } from '../types';
import { getThemeById, migrateThemeValue } from '../constants/globalThemes';
import { themeVars } from '../utils/themeVars';

const SPRINT_WINDOW = 5;

const toMillis = (value: any): number => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (value?.toMillis) return value.toMillis();
  if (value?.seconds) return value.seconds * 1000;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const isStoryDone = (status: any): boolean => {
  if (typeof status === 'number') return status >= 4;
  const str = String(status || '').toLowerCase();
  return ['done', 'complete', 'completed', 'closed', 'archived'].some((s) => str.includes(s));
};

const isGoalDone = (status: any): boolean => {
  if (typeof status === 'number') return status >= 2;
  const str = String(status || '').toLowerCase();
  return ['done', 'complete', 'completed', 'closed', 'archived'].some((s) => str.includes(s));
};

const resolveThemeId = (value: any): number => {
  return migrateThemeValue(value);
};

type PotInfo = {
  name: string;
  balance: number;
  currency: string;
};

const ThemeProgressDashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { sprints } = useSprint();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [pots, setPots] = useState<Record<string, PotInfo>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [goalsLoading, setGoalsLoading] = useState(true);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [potsLoading, setPotsLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) {
      setGoals([]);
      setStories([]);
      setGoalsLoading(false);
      setStoriesLoading(false);
      return;
    }

    setGoalsLoading(true);
    setStoriesLoading(true);

    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );
    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );

    const goalsUnsub = onSnapshot(
      goalsQuery,
      (snap) => {
        setGoals(snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) })) as Goal[]);
        setGoalsLoading(false);
      },
      () => setGoalsLoading(false),
    );

    const storiesUnsub = onSnapshot(
      storiesQuery,
      (snap) => {
        setStories(snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) })) as Story[]);
        setStoriesLoading(false);
      },
      () => setStoriesLoading(false),
    );

    return () => {
      goalsUnsub();
      storiesUnsub();
    };
  }, [currentUser, currentPersona]);

  useEffect(() => {
    if (!currentUser) {
      setPots({});
      setPotsLoading(false);
      return;
    }

    setPotsLoading(true);
    const potsQuery = query(
      collection(db, 'monzo_pots'),
      where('ownerUid', '==', currentUser.uid)
    );
    const unsub = onSnapshot(
      potsQuery,
      (snap) => {
        const map: Record<string, PotInfo> = {};
        snap.docs.forEach((doc) => {
          const data = doc.data() as any;
          const baseId = data.potId || doc.id;
          if (!baseId) return;
          const info: PotInfo = {
            name: data.name || baseId,
            balance: Number(data.balance || 0) || 0,
            currency: data.currency || 'GBP'
          };
          const register = (id: string) => {
            if (!id) return;
            map[id] = info;
          };
          register(baseId);
          if (currentUser?.uid) {
            if (baseId.startsWith(`${currentUser.uid}_`)) {
              register(baseId.replace(`${currentUser.uid}_`, ''));
            } else {
              register(`${currentUser.uid}_${baseId}`);
            }
          }
        });
        setPots(map);
        setPotsLoading(false);
      },
      () => setPotsLoading(false)
    );

    return () => unsub();
  }, [currentUser]);

  const upcomingSprints = useMemo(() => {
    const now = Date.now();
    const filtered = (sprints || [])
      .filter((s: Sprint) => {
        const status = String((s as any).status || '').toLowerCase();
        if (['done', 'complete', 'completed', 'closed', 'archived'].includes(status)) return false;
        const startMs = toMillis((s as any).startDate || (s as any).start || (s as any).createdAt);
        return !startMs || startMs >= now - 7 * 24 * 60 * 60 * 1000;
      })
      .sort((a: Sprint, b: Sprint) => {
        const aStart = toMillis((a as any).startDate || (a as any).start || (a as any).createdAt);
        const bStart = toMillis((b as any).startDate || (b as any).start || (b as any).createdAt);
        return aStart - bStart;
      });
    return filtered.slice(0, SPRINT_WINDOW);
  }, [sprints]);

  const sprintIds = useMemo(() => new Set(upcomingSprints.map((s) => s.id)), [upcomingSprints]);

  const sprintCapacity = useMemo(() => {
    const map = new Map<string, number>();
    upcomingSprints.forEach((s) => {
      const cap = Number((s as any).capacityPoints || (s as any).capacity || 20) || 0;
      map.set(s.id, cap);
    });
    return map;
  }, [upcomingSprints]);

  const sprintTotals = useMemo(() => {
    const totals = new Map<string, number>();
    stories.forEach((story) => {
      const sprintId = (story as any).sprintId;
      if (!sprintId) return;
      const points = Number((story as any).points || 0) || 0;
      if (isStoryDone((story as any).status)) return;
      totals.set(sprintId, (totals.get(sprintId) || 0) + points);
    });
    return totals;
  }, [stories]);

  const currency = useMemo(() => {
    const first = Object.values(pots)[0];
    return first?.currency || 'GBP';
  }, [pots]);

  const formatMoney = (value: number) => value.toLocaleString('en-GB', { style: 'currency', currency });

  const getGoalPotInfo = (goal: Goal) => {
    const potId = (goal as any).linkedPotId || goal.potId || null;
    if (!potId) return null;
    return pots[String(potId)] || null;
  };

  const themeRows = useMemo(() => {
    const goalById = new Map(goals.map((g) => [g.id, g]));
    const buckets = new Map<string, any>();

    const ensureBucket = (themeId: number) => {
      const theme = getThemeById(themeId);
      const key = theme.label || theme.name;
      if (!buckets.has(key)) {
        buckets.set(key, {
          theme,
          goalsTotal: 0,
          goalsDone: 0,
          storiesTotal: 0,
          storiesDone: 0,
          pointsTotal: 0,
          pointsDone: 0,
          pointsBySprint: {} as Record<string, number>,
          savingsTotal: 0,
          savingsSaved: 0
        });
      }
      return buckets.get(key);
    };

    goals.forEach((goal) => {
      const themeId = resolveThemeId((goal as any).theme);
      const bucket = ensureBucket(themeId);
      bucket.goalsTotal += 1;
      if (isGoalDone((goal as any).status)) bucket.goalsDone += 1;
      const estimated = Number((goal as any).estimatedCost || 0) || 0;
      const potInfo = getGoalPotInfo(goal);
      const saved = potInfo?.balance ? potInfo.balance / 100 : 0;
      bucket.savingsTotal += estimated;
      bucket.savingsSaved += saved;
    });

    stories.forEach((story) => {
      const goal = story.goalId ? goalById.get(story.goalId) : null;
      const themeValue = (story as any).theme ?? (goal as any)?.theme ?? 0;
      const themeId = resolveThemeId(themeValue);
      const bucket = ensureBucket(themeId);
      const points = Number((story as any).points || 0) || 0;
      bucket.storiesTotal += 1;
      bucket.pointsTotal += points;
      if (isStoryDone((story as any).status)) {
        bucket.storiesDone += 1;
        bucket.pointsDone += points;
      }
      const sprintId = (story as any).sprintId;
      if (sprintId && sprintIds.has(sprintId)) {
        bucket.pointsBySprint[sprintId] = (bucket.pointsBySprint[sprintId] || 0) + points;
      }
    });

    return Array.from(buckets.values()).sort((a, b) => b.pointsTotal - a.pointsTotal);
  }, [goals, stories, sprintIds, pots]);

  const overallStats = useMemo(() => {
    let totalPoints = 0;
    let donePoints = 0;
    let totalStories = 0;
    let doneStories = 0;
    let totalGoals = goals.length;
    let doneGoals = 0;
    let savingsTotal = 0;
    let savingsSaved = 0;
    goals.forEach((goal) => {
      if (isGoalDone((goal as any).status)) doneGoals += 1;
      const estimated = Number((goal as any).estimatedCost || 0) || 0;
      const potInfo = getGoalPotInfo(goal);
      const saved = potInfo?.balance ? potInfo.balance / 100 : 0;
      savingsTotal += estimated;
      savingsSaved += saved;
    });
    stories.forEach((story) => {
      totalStories += 1;
      const points = Number((story as any).points || 0) || 0;
      totalPoints += points;
      if (isStoryDone((story as any).status)) {
        doneStories += 1;
        donePoints += points;
      }
    });
    const pointsPct = totalPoints > 0 ? Math.round((donePoints / totalPoints) * 100) : 0;
    const storyPct = totalStories > 0 ? Math.round((doneStories / totalStories) * 100) : 0;
    const goalPct = totalGoals > 0 ? Math.round((doneGoals / totalGoals) * 100) : 0;
    const savingsPct = savingsTotal > 0 ? Math.round((savingsSaved / savingsTotal) * 100) : 0;
    const overallParts: number[] = [];
    if (totalPoints > 0) overallParts.push(pointsPct);
    if (totalGoals > 0) overallParts.push(goalPct);
    if (savingsTotal > 0) overallParts.push(savingsPct);
    const overallPct = overallParts.length
      ? Math.round(overallParts.reduce((sum, value) => sum + value, 0) / overallParts.length)
      : 0;
    return {
      totalPoints,
      donePoints,
      pointsPct,
      totalStories,
      doneStories,
      storyPct,
      totalGoals,
      doneGoals,
      goalPct,
      savingsTotal,
      savingsSaved,
      savingsPct,
      overallPct
    };
  }, [goals, stories, pots]);

  const toggleTheme = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const overallBreakdown = useMemo(() => {
    const parts = [];
    if (overallStats.savingsTotal > 0) parts.push(`Savings ${overallStats.savingsPct}%`);
    if (overallStats.totalPoints > 0) parts.push(`Story points ${overallStats.pointsPct}%`);
    if (overallStats.totalGoals > 0) parts.push(`Goals ${overallStats.goalPct}%`);
    return parts.join(' • ');
  }, [overallStats]);

  const scrollToThemes = () => {
    const target = document.getElementById('theme-progress-list');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const loading = goalsLoading || storiesLoading || potsLoading;

  return (
    <Container fluid className="py-4" style={{ maxWidth: 1200 }}>
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <div>
          <h3 className="mb-1">Theme Progress &amp; Capacity</h3>
          <div className="text-muted small">
            Story points are treated as hours. Capacity uses sprint capacity points. Overall progress reflects all goals and stories in this persona.
          </div>
        </div>
        <div className="text-muted small">
          Capacity window: next {upcomingSprints.length} sprint{upcomingSprints.length === 1 ? '' : 's'}
        </div>
      </div>

      {!loading && (
        <div className="d-flex flex-wrap gap-3 mb-4">
          <div
            role="button"
            onClick={scrollToThemes}
            title={overallBreakdown || 'No progress metrics yet'}
            style={{
              flex: '1 1 220px',
              border: `1px solid ${themeVars.border}`,
              borderRadius: 12,
              padding: 16,
              background: themeVars.card as string,
              boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
              cursor: 'pointer'
            }}
          >
            <div className="text-muted small">Overall progress</div>
            <div style={{ fontWeight: 700, fontSize: 20 }}>
              {overallStats.overallPct}%
            </div>
            <div className="text-muted small">Hover for breakdown</div>
          </div>
          <div
            style={{
              flex: '1 1 220px',
              border: `1px solid ${themeVars.border}`,
              borderRadius: 12,
              padding: 16,
              background: themeVars.card as string,
              boxShadow: '0 2px 6px rgba(0,0,0,0.06)'
            }}
          >
            <div className="text-muted small">Overall story points</div>
            <div style={{ fontWeight: 700, fontSize: 20 }}>
              {overallStats.donePoints}/{overallStats.totalPoints} pts
            </div>
            <div className="text-muted small">{overallStats.pointsPct}% complete</div>
          </div>
          <div
            style={{
              flex: '1 1 220px',
              border: `1px solid ${themeVars.border}`,
              borderRadius: 12,
              padding: 16,
              background: themeVars.card as string,
              boxShadow: '0 2px 6px rgba(0,0,0,0.06)'
            }}
          >
            <div className="text-muted small">Overall stories</div>
            <div style={{ fontWeight: 700, fontSize: 20 }}>
              {overallStats.doneStories}/{overallStats.totalStories}
            </div>
            <div className="text-muted small">{overallStats.storyPct}% complete</div>
          </div>
          <div
            style={{
              flex: '1 1 220px',
              border: `1px solid ${themeVars.border}`,
              borderRadius: 12,
              padding: 16,
              background: themeVars.card as string,
              boxShadow: '0 2px 6px rgba(0,0,0,0.06)'
            }}
          >
            <div className="text-muted small">Overall goals</div>
            <div style={{ fontWeight: 700, fontSize: 20 }}>
              {overallStats.doneGoals}/{overallStats.totalGoals}
            </div>
            <div className="text-muted small">{overallStats.goalPct}% complete</div>
          </div>
          <div
            style={{
              flex: '1 1 220px',
              border: `1px solid ${themeVars.border}`,
              borderRadius: 12,
              padding: 16,
              background: themeVars.card as string,
              boxShadow: '0 2px 6px rgba(0,0,0,0.06)'
            }}
          >
            <div className="text-muted small">Overall savings</div>
            <div style={{ fontWeight: 700, fontSize: 20 }}>
              {overallStats.savingsTotal > 0
                ? `${formatMoney(overallStats.savingsSaved)} / ${formatMoney(overallStats.savingsTotal)}`
                : 'No savings targets'}
            </div>
            <div className="text-muted small">
              {overallStats.savingsTotal > 0
                ? `${overallStats.savingsPct}% funded`
                : 'Link goals to pots to track'}
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="text-muted">Loading themes…</div>
      )}

      {!loading && themeRows.length === 0 && (
        <div className="text-muted">No stories or goals found for this persona.</div>
      )}

      {!loading && (
        <div id="theme-progress-list">
          {themeRows.map((row) => {
        const themeKey = row.theme.label || row.theme.name;
        const pointsPct = row.pointsTotal > 0 ? Math.round((row.pointsDone / row.pointsTotal) * 100) : 0;
        const storyPct = row.storiesTotal > 0 ? Math.round((row.storiesDone / row.storiesTotal) * 100) : 0;
        const goalPct = row.goalsTotal > 0 ? Math.round((row.goalsDone / row.goalsTotal) * 100) : 0;
        const savingsPct = row.savingsTotal > 0 ? Math.round((row.savingsSaved / row.savingsTotal) * 100) : 0;
        const isOpen = !!expanded[themeKey];
        return (
          <div
            key={themeKey}
            style={{
              border: `1px solid ${themeVars.border}`,
              borderRadius: 12,
              padding: 16,
              background: themeVars.card as string,
              marginBottom: 16,
              boxShadow: '0 2px 6px rgba(0,0,0,0.06)'
            }}
          >
            <div className="d-flex align-items-center justify-content-between">
              <div className="d-flex align-items-center gap-2">
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: row.theme.color,
                    display: 'inline-block'
                  }}
                />
                <strong>{row.theme.label}</strong>
              </div>
              <button
                type="button"
                onClick={() => toggleTheme(themeKey)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: themeVars.muted as string,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer'
                }}
              >
                {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span style={{ fontSize: 12 }}>{isOpen ? 'Hide' : 'Details'}</span>
              </button>
            </div>

            <div className="d-flex flex-wrap gap-3 mt-3">
              <div>
                <div className="text-muted small">Goals</div>
                <div style={{ fontWeight: 600 }}>{row.goalsDone}/{row.goalsTotal} ({goalPct}%)</div>
              </div>
              <div>
                <div className="text-muted small">Stories</div>
                <div style={{ fontWeight: 600 }}>{row.storiesDone}/{row.storiesTotal} ({storyPct}%)</div>
              </div>
              <div>
                <div className="text-muted small">Story points</div>
                <div style={{ fontWeight: 600 }}>{row.pointsDone}/{row.pointsTotal} ({pointsPct}%)</div>
              </div>
              {(row.savingsTotal > 0 || row.savingsSaved > 0) && (
                <div>
                  <div className="text-muted small">Savings</div>
                  <div style={{ fontWeight: 600 }}>
                    {formatMoney(row.savingsSaved)} / {formatMoney(row.savingsTotal)} ({savingsPct}%)
                  </div>
                </div>
              )}
            </div>

            <div style={{ height: 6, background: 'rgba(0,0,0,0.08)', borderRadius: 999, overflow: 'hidden', marginTop: 10 }}>
              <div style={{ width: `${pointsPct}%`, height: '100%', background: row.theme.color }} />
            </div>

            {isOpen && (
              <div style={{ marginTop: 16 }}>
                {upcomingSprints.length === 0 ? (
                  <div className="text-muted small">No upcoming sprints with capacity configured.</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: themeVars.muted as string }}>
                        <th style={{ padding: '6px 8px' }}>Sprint</th>
                        <th style={{ padding: '6px 8px' }}>Theme points</th>
                        <th style={{ padding: '6px 8px' }}>Sprint capacity</th>
                        <th style={{ padding: '6px 8px' }}>Free capacity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {upcomingSprints.map((sprint) => {
                        const themePoints = row.pointsBySprint[sprint.id] || 0;
                        const cap = sprintCapacity.get(sprint.id) || 0;
                        const used = sprintTotals.get(sprint.id) || 0;
                        const free = cap - used;
                        return (
                          <tr key={sprint.id} style={{ borderTop: `1px solid ${themeVars.border}` }}>
                            <td style={{ padding: '6px 8px', fontWeight: 600 }}>{sprint.name || sprint.id}</td>
                            <td style={{ padding: '6px 8px' }}>{themePoints} pts</td>
                            <td style={{ padding: '6px 8px' }}>{cap} pts</td>
                            <td style={{ padding: '6px 8px', color: free < 0 ? '#dc2626' : '#059669' }}>{free} pts</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        );
          })}
        </div>
      )}
    </Container>
  );
};

export default ThemeProgressDashboard;
