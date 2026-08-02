/**
 * PublicRoadmapView — /public/roadmap/:shareCode
 *
 * A shared roadmap, viewable by anyone with the link and no sign-in. Reads goals where
 * `canvasCode == shareCode`, which the Firestore `isCanvasPublished()` rule allows
 * unauthenticated.
 *
 * It renders RoadmapGrid in read-only mode rather than its own timeline. This page used to be
 * a separate bar-chart implementation, which meant the thing you shared looked nothing like
 * the thing you were looking at when you shared it — and was a third roadmap to keep in step
 * with the other two. Same component, no drag, no click-through, no toolbar.
 *
 * WHAT IS AND IS NOT SHARED: publishing stamps `canvasCode` on every goal the user owns
 * EXCEPT those marked `sharePrivate` (see ShareGoalsPanel). Nothing here filters — a goal that
 * reaches this query is a goal the owner published. Stories, tasks, capacity and calendar data
 * are never loaded at all, because RoadmapGrid skips its own subscriptions when goals are
 * passed in.
 */

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import RoadmapGrid from './planner/RoadmapGrid';
import type { Goal } from '../types';

const PublicRoadmapView: React.FC = () => {
  const { shareCode } = useParams<{ shareCode: string }>();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shareCode) { setError('Invalid share link'); setLoading(false); return; }
    getDocs(query(collection(db, 'goals'), where('canvasCode', '==', shareCode)))
      .then((snap) => {
        if (snap.empty) { setError('Roadmap not found, or access has been revoked.'); return; }
        setGoals(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Goal));
      })
      .catch(() => setError('Failed to load roadmap.'))
      .finally(() => setLoading(false));
  }, [shareCode]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="spinner-border" role="status" aria-label="Loading roadmap" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100vh', gap: 8, padding: 24, textAlign: 'center',
      }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Roadmap unavailable</h1>
        <p className="text-muted" style={{ margin: 0 }}>{error}</p>
      </div>
    );
  }

  return (
    // Full viewport height with the grid filling it: this is the whole page, not a panel on
    // one. RoadmapGrid needs a flex-column parent of bounded height to scroll correctly.
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg, #f8f9fa)' }}>
      <div style={{
        flexShrink: 0, padding: '12px 16px', borderBottom: '1px solid var(--line, #e5e7eb)',
        display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap',
      }}>
        <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Goal roadmap</h1>
        <span className="text-muted" style={{ fontSize: 12 }}>
          {goals.length} goal{goals.length === 1 ? '' : 's'} · shared read-only
        </span>
      </div>
      <RoadmapGrid goals={goals} showFilters={false} readOnly detail="quarter" />
    </div>
  );
};

export default PublicRoadmapView;
