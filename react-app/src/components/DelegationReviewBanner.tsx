/**
 * DelegationReviewBanner
 *
 * "The AI finished something and it is waiting on you."
 *
 * Delegation completion has been notify-by-email only, and the email is easy to miss — which
 * matters more here than for most notifications, because a delegated item deliberately does NOT
 * change lane when it completes. `aiDelegationStatus` is the only signal; the story or task sits
 * exactly where it was on the Kanban, so nothing on any board changes when work lands. Without
 * this section the queue is invisible until someone opens the item.
 *
 * Covers goals as well as stories and tasks: the cycle in functions/aiDelegation.js processes all
 * three, and a delegated goal has no card on any board at all.
 *
 * Renders null when nothing is awaiting review — NotificationStream hides empty sections.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { Bot, ExternalLink } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

/**
 * The canonical review state, matching isAwaitingReview in utils/delegationRouting.ts.
 *
 * Deliberately not including the legacy 'review' value that the server trigger still accepts:
 * nothing has written it since the two were reconciled, and a Firestore `in` query costs an
 * index for a value that should not exist.
 */
const REVIEW_STATE = 'human_review';

/** Collection → the route segment and the singular noun shown on the row. */
const SOURCES: Array<{ collection: string; path: string; label: string }> = [
  { collection: 'stories', path: 'stories', label: 'Story' },
  { collection: 'tasks', path: 'tasks', label: 'Task' },
  { collection: 'goals', path: 'goals', label: 'Goal' },
];

interface ReviewItem {
  id: string;
  ref: string;
  title: string;
  path: string;
  label: string;
  docLink: string | null;
  completedAt: number;
}

const toMillis = (value: any): number => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
};

const DelegationReviewBanner: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  // Keyed by collection so each subscription replaces only its own slice — a single array would
  // have the three snapshots overwrite each other.
  const [byCollection, setByCollection] = useState<Record<string, ReviewItem[]>>({});

  useEffect(() => {
    if (!currentUser?.uid) {
      setByCollection({});
      return;
    }

    // Two equality filters and no orderBy, so Firestore serves this from its automatic
    // single-field indexes — adding a sort here would demand three composite indexes this
    // project does not define. The list is small; it is sorted below.
    const unsubs = SOURCES.map(({ collection: name, path, label }) =>
      onSnapshot(
        query(
          collection(db, name),
          where('ownerUid', '==', currentUser.uid),
          where('aiDelegationStatus', '==', REVIEW_STATE),
        ),
        (snap) => {
          const items = snap.docs
            // Soft-deleted records are still returned by the query — most BOB surfaces forget
            // this and quietly count binned work.
            .filter((d) => !(d.data() as any)?.deleted)
            .map((d) => {
              const data = d.data() as any;
              return {
                id: d.id,
                ref: String(data.ref || d.id.slice(-6)),
                title: String(data.title || 'Untitled'),
                path,
                label,
                docLink: data.aiDelegationDocumentLink || data.documentLink || null,
                completedAt: toMillis(data.aiDelegationCompletedAt),
              };
            });
          setByCollection((prev) => ({ ...prev, [name]: items }));
        },
        // One collection failing its rules check must not blank the other two.
        () => setByCollection((prev) => ({ ...prev, [name]: [] })),
      ),
    );

    return () => unsubs.forEach((unsub) => unsub());
  }, [currentUser?.uid]);

  const items = useMemo(
    () => Object.values(byCollection).flat().sort((a, b) => b.completedAt - a.completedAt),
    [byCollection],
  );

  if (items.length === 0) return null;

  return (
    <div style={{ minWidth: 260 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: 6 }}>
        AI delegation — {items.length} awaiting review
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((item) => (
          <div
            key={`${item.path}:${item.id}`}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              background: 'var(--notion-hover, rgba(0,0,0,0.04))',
              border: '1px solid var(--warning, #d97706)', borderRadius: 6,
              padding: '7px 8px',
            }}
          >
            <Bot size={14} style={{ color: 'var(--warning, #d97706)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
            <span style={{ flex: 1, minWidth: 0 }}>
              <button
                onClick={() => navigate(`/${item.path}/${item.id}`)}
                title={item.title}
                style={{
                  background: 'transparent', border: 'none', padding: 0, textAlign: 'left',
                  fontSize: 12, fontWeight: 600, color: 'var(--text)', cursor: 'pointer',
                  display: 'block', width: '100%',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {item.ref} — {item.title}
              </button>
              <span style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginTop: 2 }}>
                {item.label} · ready for your sign-off
              </span>
              {item.docLink && (
                <a
                  href={item.docLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4,
                    fontSize: 10, fontWeight: 600, color: 'var(--brand, #5f77dc)',
                  }}
                >
                  <ExternalLink size={10} aria-hidden="true" />
                  Open document
                </a>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DelegationReviewBanner;
