import React, { useEffect, useMemo, useState } from 'react';
import { Card, ProgressBar, Badge } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { useSprint } from '../contexts/SprintContext';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Story, Goal } from '../types';
import { GLOBAL_THEMES, getThemeById } from '../constants/globalThemes';
import { isStatus } from '../utils/statusHelpers';

const ThemeBreakdown: React.FC = () => {
  const { currentUser } = useAuth();
  const { selectedSprintId } = useSprint();
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);

  useEffect(() => {
    if (!currentUser) return;

    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid)
    );
    const unsubStories = onSnapshot(storiesQuery, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Story[];
      setStories(data);
    });

    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid)
    );
    const unsubGoals = onSnapshot(goalsQuery, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Goal[];
      setGoals(data);
    });

    return () => { unsubStories(); unsubGoals(); };
  }, [currentUser]);

  const rows = useMemo(() => {
    // Filter stories by sprint when selected, else include all
    const filteredStories = (selectedSprintId === '' || !selectedSprintId)
      ? stories
      : stories.filter(s => (s as any).sprintId === selectedSprintId);

    // Build stats by themeId (numeric) and also handle legacy string themes
    type Row = { key: string; label: string; goals: number; stories: number; doneStories: number };
    const map = new Map<string, Row>();

    // From goals (preferred canonical theme as number)
    for (const g of goals) {
      const key = typeof g.theme === 'number' ? String(g.theme) : String(g.theme || 'Unknown');
      const label = typeof g.theme === 'number' ? getThemeById(g.theme).label : String(g.theme || 'Unknown');
      const r = map.get(key) || { key, label, goals: 0, stories: 0, doneStories: 0 };
      r.goals += 1;
      map.set(key, r);
    }
    // From stories
    for (const s of filteredStories) {
      const key = typeof s.theme === 'number' ? String(s.theme) : String(s.theme || 'Unknown');
      const label = typeof s.theme === 'number' ? getThemeById(s.theme).label : String(s.theme || 'Unknown');
      const r = map.get(key) || { key, label, goals: 0, stories: 0, doneStories: 0 };
      r.stories += 1;
      if (isStatus((s as any).status, 'done')) r.doneStories += 1;
      map.set(key, r);
    }

    // Ensure all known themes have an entry for visual consistency
    for (const t of GLOBAL_THEMES) {
      const key = String(t.id);
      if (!map.has(key)) map.set(key, { key, label: t.label, goals: 0, stories: 0, doneStories: 0 });
    }

    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [goals, stories, selectedSprintId]);

  return (
    <Card className="h-100">
      <Card.Header>
        <h5 className="mb-0">Theme Progress</h5>
      </Card.Header>
      <Card.Body>
        {rows.map(r => {
          const pct = r.stories > 0 ? Math.round((r.doneStories / r.stories) * 100) : 0;
          return (
            <div key={r.key} className="mb-3">
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <strong>{r.label}</strong>
                  <Badge bg="light" text="dark" className="ms-2">{r.goals} goals</Badge>
                  <Badge bg="light" text="dark" className="ms-2">{r.stories} stories</Badge>
                </div>
                <span className="small text-muted">{pct}%</span>
              </div>
              <ProgressBar now={pct} className="mt-1" style={{ height: 6 }} />
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="text-muted">No data</div>
        )}
      </Card.Body>
    </Card>
  );
};

export default ThemeBreakdown;
