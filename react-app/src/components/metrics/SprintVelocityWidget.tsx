/**
 * SprintVelocityWidget — Sprint velocity bar + theme ring donuts dashboard widget.
 *
 * Data sources:
 *   goals   — persona-filtered goals (for theme progress)
 *   stories — persona-filtered stories (sprint velocity + theme progress)
 *   SprintContext — current sprint
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Row, Col } from 'react-bootstrap';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { useSprint } from '../../contexts/SprintContext';
import { useTheme } from '../../contexts/ThemeContext';
import { ThemeRing } from './shared';

const THEME_META = [
  { id: 1, label: 'Health', emoji: '💪', color: '#10b981' },
  { id: 2, label: 'Growth', emoji: '📈', color: '#3b82f6' },
  { id: 3, label: 'Wealth', emoji: '💰', color: '#f59e0b' },
  { id: 4, label: 'Tribe', emoji: '🤝', color: '#8b5cf6' },
  { id: 5, label: 'Home', emoji: '🏡', color: '#ef4444' },
];

const SprintVelocityWidget: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { selectedSprintId, sprints: allSprints } = useSprint();
  const currentSprint = allSprints.find((s) => s.id === selectedSprintId) ?? null;
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [goals, setGoals] = useState<any[]>([]);
  const [stories, setStories] = useState<any[]>([]);

  const uid = currentUser?.uid;

  useEffect(() => {
    if (!uid || !currentPersona) return;
    const q = query(
      collection(db, 'goals'),
      where('ownerUid', '==', uid),
      where('persona', '==', currentPersona),
    );
    return onSnapshot(q, (snap) => setGoals(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, [uid, currentPersona]);

  useEffect(() => {
    if (!uid || !currentPersona) return;
    const q = query(
      collection(db, 'stories'),
      where('ownerUid', '==', uid),
      where('persona', '==', currentPersona),
    );
    return onSnapshot(q, (snap) => setStories(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, [uid, currentPersona]);

  const sprintStories = useMemo(() => {
    if (!currentSprint?.id) return [];
    return stories.filter((s) => s.sprintId === currentSprint.id);
  }, [stories, currentSprint]);

  const sprintDonePoints = sprintStories
    .filter((s) => Number(s.status) >= 4)
    .reduce((a, s) => a + (Number(s.points) || 0), 0);
  const sprintTotalPoints = sprintStories.reduce((a, s) => a + (Number(s.points) || 0), 0);
  const sprintVelocityPct =
    sprintTotalPoints === 0 ? 0 : Math.round((sprintDonePoints / sprintTotalPoints) * 100);

  const themeProgress = useMemo(() => {
    return THEME_META.map((t) => {
      const themeGoals = goals.filter((g) => g.theme === t.id || Number(g.theme) === t.id);
      if (themeGoals.length === 0) return { id: t.id, pct: 0 };
      const themeStories = stories.filter((s) => themeGoals.some((g) => g.id === s.goalId));
      const total = themeStories.reduce((a, s) => a + (Number(s.points) || 1), 0);
      const done = themeStories
        .filter((s) => Number(s.status) >= 4)
        .reduce((a, s) => a + (Number(s.points) || 1), 0);
      return { id: t.id, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
    });
  }, [goals, stories]);

  const border = isDark ? '#2d3748' : '#e2e8f0';
  const muted = isDark ? '#9ca3af' : '#6b7280';
  const barColor =
    sprintVelocityPct >= 80 ? '#10b981' : sprintVelocityPct >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Sprint Velocity
        </span>
      </div>
      <Row className="g-2">
        {/* Velocity bar */}
        <Col xs={12} sm={5}>
          <div
            style={{
              background: isDark ? '#1e2433' : '#ffffff',
              border: `1px solid ${border}`,
              borderRadius: 12,
              padding: '16px 18px',
              height: '100%',
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: muted,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: 8,
              }}
            >
              {currentSprint?.name ?? 'Current Sprint'}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 28, fontWeight: 700, color: isDark ? '#f1f5f9' : '#1e293b', lineHeight: 1 }}>
                {sprintDonePoints}
              </span>
              <span style={{ fontSize: 13, color: muted }}>/ {sprintTotalPoints} pts</span>
            </div>
            <div
              style={{
                background: isDark ? '#2d3748' : '#e5e7eb',
                borderRadius: 6,
                height: 8,
                overflow: 'hidden',
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  height: '100%',
                  borderRadius: 6,
                  width: `${sprintVelocityPct}%`,
                  background: barColor,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <div style={{ fontSize: 12, color: muted }}>
              {sprintVelocityPct}% complete · {sprintStories.length} stories
            </div>
          </div>
        </Col>

        {/* Theme rings */}
        {THEME_META.map((t) => {
          const data = themeProgress.find((p) => p.id === t.id);
          return (
            <Col key={t.id} style={{ minWidth: 80, flex: 1 }}>
              <ThemeRing theme={t} progressPct={data?.pct ?? 0} isDark={isDark} />
            </Col>
          );
        })}
      </Row>
    </div>
  );
};

export default SprintVelocityWidget;
