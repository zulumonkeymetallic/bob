/**
 * PublicRoadmapView — /public/roadmap/:shareCode
 *
 * Read-only goal timeline for publicly shared roadmaps.
 * Queries goals where canvasCode == shareCode (no auth required).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { GLOBAL_THEMES } from '../constants/globalThemes';
import type { Goal } from '../types';

const THEME_MAP = Object.fromEntries(GLOBAL_THEMES.map(t => [t.id, t]));

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function goalYear(goal: Goal): number {
  const ms = goal.endDate ?? goal.startDate ?? 0;
  return new Date(ms).getFullYear();
}

function barWidth(goal: Goal, minMs: number, totalMs: number): { left: string; width: string } {
  const start = goal.startDate ?? minMs;
  const end = goal.endDate ?? start;
  const l = Math.max(0, ((start - minMs) / totalMs) * 100);
  const w = Math.max(0.5, ((end - start) / totalMs) * 100);
  return { left: `${l.toFixed(1)}%`, width: `${Math.min(100 - l, w).toFixed(1)}%` };
}

const PublicRoadmapView: React.FC = () => {
  const { shareCode } = useParams<{ shareCode: string }>();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shareCode) { setError('Invalid share link'); setLoading(false); return; }
    getDocs(query(collection(db, 'goals'), where('canvasCode', '==', shareCode)))
      .then(snap => {
        if (snap.empty) { setError('Roadmap not found or access has been revoked.'); return; }
        setGoals(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Goal));
      })
      .catch(() => setError('Failed to load roadmap.'))
      .finally(() => setLoading(false));
  }, [shareCode]);

  const { minMs, maxMs, totalMs } = useMemo(() => {
    const dates = goals.flatMap(g => [g.startDate, g.endDate].filter(Boolean) as number[]);
    if (!dates.length) return { minMs: 0, maxMs: 0, totalMs: 1 };
    const minMs = Math.min(...dates);
    const maxMs = Math.max(...dates);
    return { minMs, maxMs, totalMs: Math.max(1, maxMs - minMs) };
  }, [goals]);

  // Group by theme
  const byTheme = useMemo(() => {
    const map = new Map<number, Goal[]>();
    for (const g of goals) {
      const t = Number(g.theme) || 0;
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push(g);
    }
    // Sort each group by startDate
    for (const arr of map.values()) arr.sort((a, b) => (a.startDate ?? 0) - (b.startDate ?? 0));
    return map;
  }, [goals]);

  // Year axis
  const years = useMemo(() => {
    if (!totalMs) return [];
    const result: { year: number; left: string; width: string }[] = [];
    const startYear = new Date(minMs).getFullYear();
    const endYear = new Date(maxMs).getFullYear();
    for (let y = startYear; y <= endYear; y++) {
      const yStart = new Date(y, 0, 1).getTime();
      const yEnd = new Date(y + 1, 0, 1).getTime();
      const left = Math.max(0, ((yStart - minMs) / totalMs) * 100);
      const w = Math.min(100 - left, ((Math.min(yEnd, maxMs) - Math.max(yStart, minMs)) / totalMs) * 100);
      result.push({ year: y, left: `${left.toFixed(1)}%`, width: `${Math.max(1, w).toFixed(1)}%` });
    }
    return result;
  }, [minMs, maxMs, totalMs]);

  if (loading) {
    return (
      <div className="d-flex align-items-center justify-content-center" style={{ height: '100vh' }}>
        <div className="spinner-border text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container py-5 text-center">
        <h4 className="text-muted">{error}</h4>
        <p className="text-muted small">The roadmap may not exist or sharing may have been disabled.</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bs-body-bg, #fff)' }}>
      {/* Header */}
      <div className="border-bottom px-4 py-3 d-flex align-items-center justify-content-between">
        <div>
          <span className="fw-bold fs-5">Goal Roadmap</span>
          <span className="badge bg-secondary ms-2 fw-normal" style={{ fontSize: '0.7rem' }}>
            Read-only · Shared view
          </span>
        </div>
        <div className="text-muted small">{goals.length} goals</div>
      </div>

      <div className="container-fluid px-4 py-4">
        {/* Year axis */}
        <div className="position-relative mb-2" style={{ height: 24, marginLeft: 160 }}>
          {years.map(({ year, left, width }) => (
            <div
              key={year}
              className="position-absolute border-start text-muted"
              style={{ left, width, fontSize: '0.7rem', paddingLeft: 4, top: 0, bottom: 0, overflow: 'hidden' }}
            >
              {year}
            </div>
          ))}
        </div>

        {/* Theme groups */}
        {Array.from(byTheme.entries()).map(([themeId, themeGoals]) => {
          const theme = THEME_MAP[themeId];
          const color = theme?.color ?? '#6c757d';
          const label = theme?.label ?? 'Other';
          return (
            <div key={themeId} className="mb-4">
              <div
                className="d-flex align-items-center gap-2 mb-2 pb-1 border-bottom"
                style={{ borderColor: `${color}44` }}
              >
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
                <span className="fw-semibold small" style={{ color }}>{label}</span>
                <span className="text-muted small">({themeGoals.length})</span>
              </div>

              <div className="vstack gap-1">
                {themeGoals.map(goal => {
                  const { left, width } = barWidth(goal, minMs, totalMs);
                  const isMilestone = (goal as any).goalKind === 'milestone' &&
                    (goal.endDate ?? 0) - (goal.startDate ?? 0) < 14 * 86400000;
                  const progress = (goal as any).progress ?? 0;

                  return (
                    <div key={goal.id} className="d-flex align-items-center" style={{ minHeight: 32 }}>
                      {/* Label */}
                      <div
                        className="text-truncate small pe-2 text-muted"
                        style={{ width: 160, flexShrink: 0 }}
                        title={goal.title}
                      >
                        {goal.title}
                      </div>
                      {/* Bar track */}
                      <div className="position-relative flex-grow-1" style={{ height: 20 }}>
                        {isMilestone ? (
                          /* Star marker */
                          <div
                            className="position-absolute d-flex align-items-center"
                            style={{ left, top: 0, bottom: 0, transform: 'translateX(-50%)' }}
                            title={`${goal.title} · ${fmtDate(goal.startDate ?? null)}`}
                          >
                            <span style={{ color, fontSize: '1rem', lineHeight: 1 }}>★</span>
                          </div>
                        ) : (
                          <div
                            className="position-absolute rounded"
                            style={{
                              left,
                              width,
                              top: 2,
                              bottom: 2,
                              background: `${color}33`,
                              border: `1px solid ${color}88`,
                              overflow: 'hidden',
                            }}
                            title={`${goal.title} · ${fmtDate(goal.startDate ?? null)} → ${fmtDate(goal.endDate ?? null)}`}
                          >
                            {progress > 0 && (
                              <div
                                style={{
                                  height: '100%',
                                  width: `${progress}%`,
                                  background: `${color}66`,
                                }}
                              />
                            )}
                          </div>
                        )}
                      </div>
                      {/* Date range */}
                      <div className="text-muted ps-2 flex-shrink-0" style={{ fontSize: '0.68rem', width: 170 }}>
                        {fmtDate(goal.startDate ?? null)} – {fmtDate(goal.endDate ?? null)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-center py-4 border-top text-muted small">
        Shared via BOB · <a href="https://bob.jc1.tech" target="_blank" rel="noreferrer">bob.jc1.tech</a>
      </div>
    </div>
  );
};

export default PublicRoadmapView;
