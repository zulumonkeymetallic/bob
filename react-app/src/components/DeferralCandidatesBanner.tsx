/**
 * DeferralCandidatesBanner
 *
 * Compact, persistent banner (shown as a top-right toast that does NOT auto-dismiss).
 * Surfaces the 3 lowest-criticality stories whose linked goal has nothing in the
 * currently-selected sprint — i.e. the strongest candidates to defer out.
 *
 * "Goal not in this sprint" = the story's goalId is not among the goals that have
 * at least one story assigned to the active sprint.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { ArrowDownCircle } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { Story } from '../types';

// Stories that are finished or binned are never deferral candidates.
// Status: 0 backlog, 1 in-progress, 2 review, 3+ done, 4 bin.
function isActiveStory(story: Story): boolean {
  const status = (story as any).status;
  if (typeof status === 'number') return status >= 0 && status < 3;
  const s = String(status || '').toLowerCase();
  return !['done', 'complete', 'completed', 'bin', 'binned', 'archived'].includes(s);
}

function scoreOf(story: Story): number {
  const v = Number((story as any).aiCriticalityScore);
  // Missing scores sort last so genuinely low-scored items surface first.
  return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
}

const DeferralCandidatesBanner: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { selectedSprintId } = useSprint();
  const navigate = useNavigate();

  const [stories, setStories] = useState<Story[]>([]);

  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) { setStories([]); return; }
    const q = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
    );
    const unsub = onSnapshot(q,
      (snap) => setStories(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Story))),
      (err) => console.warn('DeferralCandidatesBanner stories:', err.code),
    );
    return () => unsub();
  }, [currentUser?.uid, currentPersona]);

  const candidates = useMemo(() => {
    // No specific sprint selected (e.g. "All sprints") → nothing to defer against.
    const sprintId = selectedSprintId && selectedSprintId !== '' ? selectedSprintId : null;
    if (!sprintId) return [] as Story[];

    // Goals represented in the active sprint.
    const goalsInSprint = new Set<string>();
    for (const s of stories) {
      if (String((s as any).sprintId || '') === sprintId) {
        const gid = String((s as any).goalId || '').trim();
        if (gid) goalsInSprint.add(gid);
      }
    }

    return stories
      .filter(isActiveStory)
      .filter((s) => {
        const gid = String((s as any).goalId || '').trim();
        return !!gid && !goalsInSprint.has(gid);
      })
      .sort((a, b) => scoreOf(a) - scoreOf(b))
      .slice(0, 3);
  }, [stories, selectedSprintId]);

  if (candidates.length === 0) return null;

  return (
    <div style={{ minWidth: 240 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <ArrowDownCircle size={13} style={{ color: 'var(--muted)' }} />
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>
          Deferral candidates
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {candidates.map((s) => {
          const ref = String((s as any).ref || '');
          const score = Number((s as any).aiCriticalityScore);
          return (
            <button
              key={s.id}
              onClick={() => navigate(`/stories/${s.id}`)}
              title={String((s as any).title || '')}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                background: 'var(--notion-hover, rgba(0,0,0,0.04))',
                border: '1px solid var(--border, #e5e7eb)', borderRadius: 6,
                padding: '5px 8px', cursor: 'pointer', textAlign: 'left',
                color: 'var(--text)',
              }}
            >
              {ref && (
                <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>
                  {ref}
                </span>
              )}
              <span style={{ fontSize: 12, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {String((s as any).title || 'Untitled')}
              </span>
              <span
                style={{
                  fontSize: 10, fontWeight: 700, flexShrink: 0,
                  background: 'var(--panel)', border: '1px solid var(--border, #e5e7eb)',
                  borderRadius: 10, padding: '1px 6px', color: 'var(--muted)',
                }}
              >
                {Number.isFinite(score) ? `AI ${score}` : 'AI —'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default DeferralCandidatesBanner;
