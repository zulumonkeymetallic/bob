import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Form, InputGroup, ListGroup, Spinner, Badge } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';

type ResultType = 'task' | 'story' | 'goal';

interface SearchResult {
  id: string;
  ref?: string;
  title: string;
  type: ResultType;
  path: string;
}

const GlobalSearchBar: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const navigate = useNavigate();
  const [queryText, setQueryText] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant?: 'warning' | 'danger' } | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const normalizedQuery = useMemo(() => queryText.trim().toLowerCase(), [queryText]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!currentUser || !currentPersona) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (normalizedQuery.length < 2) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const owner = currentUser.uid;
        const fetchSet = async (col: 'tasks' | 'stories' | 'goals', type: ResultType): Promise<SearchResult[]> => {
          console.log('[global-search] query start', { col, owner, persona: currentPersona, q: normalizedQuery });
          const base = [
            collection(db, col),
            where('ownerUid', '==', owner),
            where('persona', '==', currentPersona),
            orderBy('updatedAt', 'desc'),
            limit(30),
          ] as const;
          const snap = await getDocs(query(...base));
          console.log('[global-search] fetched', { col, size: snap.size });
          return snap.docs
            .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
            .filter((row) => {
              const title = String(row.title || '').toLowerCase();
              const ref = String(row.ref || row.reference || '').toLowerCase();
              return title.includes(normalizedQuery) || ref.includes(normalizedQuery);
            })
            .map((row) => {
              const ref = row.ref || row.reference || row.referenceNumber || row.displayId || null;
              const refOrId = ref || row.id;
              let path = '';
              if (type === 'task') path = `/tasks/${refOrId}`;
              if (type === 'story') path = `/stories/${refOrId}`;
              if (type === 'goal') path = `/goals/${refOrId}`;
              return {
                id: row.id,
                ref,
                title: row.title || refOrId,
                type,
                path,
              } as SearchResult;
            });
        };

        const [taskResults, storyResults, goalResults] = await Promise.all([
          fetchSet('tasks', 'task'),
          fetchSet('stories', 'story'),
          fetchSet('goals', 'goal'),
        ]);

        const merged = [...taskResults, ...storyResults, ...goalResults].slice(0, 25);
        console.log('[global-search] results merged', { q: normalizedQuery, tasks: taskResults.length, stories: storyResults.length, goals: goalResults.length, merged: merged.length });
        setResults(merged);
        setOpen(true);
      } catch (err: any) {
        console.warn('[global-search] failed', err);
        const msg = err?.message || '';
        if (msg.includes('indexes?create_composite') || msg.toLowerCase().includes('failed-precondition')) {
          setToast({ message: 'Search index is still building. Try again in a minute.', variant: 'warning' });
        } else if (msg.toLowerCase().includes('permission-denied')) {
          setToast({ message: 'Search unavailable: permission denied.', variant: 'danger' });
        } else {
          setToast({ message: 'Search failed. Please try again.', variant: 'warning' });
        }
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  }, [currentPersona, currentUser, normalizedQuery]);

  const handleSelect = (path: string) => {
    setOpen(false);
    setQueryText('');
    setResults([]);
    navigate(path);
  };

  return (
    <div ref={boxRef} style={{ position: 'relative', minWidth: '260px' }}>
      <InputGroup size="sm">
        <Form.Control
          placeholder="Search goals, stories, tasks"
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          onFocus={() => normalizedQuery.length >= 2 && setOpen(true)}
        />
        {loading && (
          <InputGroup.Text>
            <Spinner animation="border" size="sm" />
          </InputGroup.Text>
        )}
      </InputGroup>
      {open && results.length > 0 && (
        <ListGroup
          style={{
            position: 'absolute',
            top: '36px',
            right: 0,
            left: 0,
            zIndex: 1100,
            maxHeight: '320px',
            overflowY: 'auto',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          }}
        >
          {results.map((r) => (
            <ListGroup.Item
              action
              key={`${r.type}-${r.id}`}
              onClick={() => handleSelect(r.path)}
              className="d-flex justify-content-between align-items-start"
            >
              <div>
                <div className="fw-semibold">{r.title}</div>
                <div className="text-muted small">
                  {(r.ref || r.id)} · {r.type}
                </div>
              </div>
              <Badge bg={r.type === 'goal' ? 'success' : r.type === 'story' ? 'primary' : 'secondary'}>
                {r.type}
              </Badge>
            </ListGroup.Item>
          ))}
        </ListGroup>
      )}
      {open && !loading && results.length === 0 && normalizedQuery.length >= 2 && (
        <div
          style={{
            position: 'absolute',
            top: '36px',
            right: 0,
            left: 0,
            zIndex: 1100,
            background: 'var(--bs-body-bg)',
            border: '1px solid var(--bs-border-color)',
            padding: '8px',
            fontSize: '12px',
          }}
        >
          No matches.
        </div>
      )}
      {toast && (
        <div
          style={{
            position: 'absolute',
            top: '4px',
            right: '-4px',
            zIndex: 1200,
            fontSize: '12px',
            padding: '6px 10px',
            borderRadius: '6px',
            background: toast.variant === 'danger' ? '#f8d7da' : '#fff3cd',
            color: toast.variant === 'danger' ? '#842029' : '#664d03',
            border: `1px solid ${toast.variant === 'danger' ? '#f5c2c7' : '#ffe69c'}`,
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
};

export default GlobalSearchBar;
