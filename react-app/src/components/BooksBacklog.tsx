import React, { useEffect, useMemo, useState } from 'react';
import { Card, Button, ButtonGroup, Form, Badge, Row, Col, Table, Modal, Alert, Pagination, Spinner } from 'react-bootstrap';
import { collection, onSnapshot, query, where, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { Goal, Sprint } from '../types';
import { findSprintForDate } from '../utils/taskSprintHelpers';
import { generateRef } from '../utils/referenceGenerator';

interface BookItem {
  id: string;
  hardcoverId: string;
  title: string;
  subtitle?: string | null;
  authors?: string[];
  coverImage?: string | null;
  status?: 'to-read' | 'reading' | 'read' | string;
  addedAt?: number | null;
  rating?: number;
  lastConvertedStoryId?: string;
  lastConvertedAt?: number;
  completedAt?: number | null;
}

interface ConvertPayload {
  goalId: string;
  sprintId: string | null;
  targetDate: string;
  rating: number;
}

const BooksBacklog: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { sprints } = useSprint();
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [books, setBooks] = useState<BookItem[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'to-read' | 'reading' | 'read' | 'unconverted' | 'converted'>('all');
  const [selected, setSelected] = useState<BookItem | null>(null);
  const [convertForm, setConvertForm] = useState<ConvertPayload>({ goalId: '', sprintId: null, targetDate: '', rating: 3 });
  const [savingConversion, setSavingConversion] = useState(false);
  const [addedSince, setAddedSince] = useState<string>('');
  const [msg, setMsg] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importSlug, setImportSlug] = useState('');
  const [importGoalId, setImportGoalId] = useState('');
  const [importPriority, setImportPriority] = useState(1);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) { setBooks([]); setLoading(false); return; }
    const qRef = query(collection(db, 'hardcover'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(qRef, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as BookItem[];
      rows.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
      setBooks(rows);
      setLoading(false);
    });
    return unsub;
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const goalsQuery = query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid), where('persona', '==', currentPersona));
    const unsub = onSnapshot(goalsQuery, snap => setGoals(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Goal[]));
    return unsub;
  }, [currentUser, currentPersona]);

  const filteredBooks = useMemo(() => {
    return books.filter(b => {
      const matchesSearch = !search || (b.title || '').toLowerCase().includes(search.toLowerCase());
      const converted = !!b.lastConvertedStoryId;
      const statusMatches = (() => {
        if (statusFilter === 'all') return true;
        if (statusFilter === 'converted') return converted;
        if (statusFilter === 'unconverted') return !converted;
        return String(b.status || '').toLowerCase() === statusFilter;
      })();
      const addedFilterOk = (() => {
        if (!addedSince) return true;
        if (!b.addedAt) return false;
        const min = new Date(addedSince).getTime();
        if (Number.isNaN(min)) return true;
        return b.addedAt >= min;
      })();
      return matchesSearch && statusMatches && addedFilterOk;
    });
  }, [books, search, statusFilter, addedSince]);

  const totalPages = Math.max(1, Math.ceil(filteredBooks.length / pageSize));
  useEffect(() => { setPage(1); }, [search, statusFilter, addedSince, filteredBooks.length]);
  const pagedBooks = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredBooks.slice(start, start + pageSize);
  }, [filteredBooks, page]);

  const handleRatingChange = async (book: BookItem, rating: number) => {
    if (!currentUser) return;
    try {
      await updateDoc(doc(db, 'hardcover', book.id), { rating, updatedAt: serverTimestamp() });
    } catch (e) {
      console.error('Failed to update rating', e);
      window.alert('Could not save rating.');
    }
  };

  const openConvert = (book: BookItem) => {
    setSelected(book);
    setConvertForm({ goalId: goals[0]?.id || '', sprintId: null, targetDate: '', rating: book.rating ?? 3 });
  };

  const markRead = async (book: BookItem) => {
    if (!currentUser) return;
    try {
      const defaultDate = new Date().toISOString().slice(0,10);
      const inputDate = window.prompt('Completed date (yyyy-mm-dd, leave blank for today)', defaultDate) || defaultDate;
      const completedAt = inputDate ? new Date(inputDate).getTime() : Date.now();
      const rating = book.rating ?? null;
      const fn = httpsCallable(functions, 'hardcoverUpdateStatus');
      await fn({ bookId: book.hardcoverId, status: 'read', completedAt, rating });
      setMsg(`Marked "${book.title}" as read.`);
      setTimeout(() => setMsg(null), 2500);
    } catch (e: any) {
      console.error('hardcoverUpdateStatus failed', e);
      window.alert(e?.message || 'Failed to update Hardcover status');
    }
  };

  const handleConvert = async () => {
    if (!currentUser || !selected) return;
    if (!convertForm.goalId) { window.alert('Choose a goal.'); return; }
    setSavingConversion(true);
    try {
      const dueDateMs = convertForm.targetDate ? new Date(convertForm.targetDate).getTime() : null;
      const sprintId = convertForm.sprintId || (dueDateMs ? findSprintForDate(sprints, dueDateMs)?.id || null : null);
      const storyRef = generateRef('story', []);
      const storyPayload: any = {
        ref: storyRef,
        title: selected.title,
        description: `Read ${selected.title}${selected.subtitle ? ': ' + selected.subtitle : ''}.` + (selected.authors?.length ? `\nBy: ${selected.authors.join(', ')}` : ''),
        goalId: convertForm.goalId,
        sprintId: sprintId || null,
        dueDate: dueDateMs || null,
        status: 0,
        priority: 2,
        points: 3,
        wipLimit: 3,
        tags: ['books', 'reading'],
        persona: currentPersona,
        personaKey: currentPersona,
        ownerPersona: currentPersona,
        ownerUid: currentUser.uid,
        orderIndex: Date.now(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        metadata: {
          hardcoverBookId: selected.hardcoverId,
          hardcoverCover: selected.coverImage || null,
          rating: convertForm.rating
        }
      };

      const storyDoc = await addDoc(collection(db, 'stories'), storyPayload);
      await updateDoc(doc(db, 'hardcover', selected.id), {
        lastConvertedStoryId: storyDoc.id,
        lastConvertedAt: serverTimestamp(),
        completedAt: convertForm.targetDate ? new Date(convertForm.targetDate).getTime() : null,
        rating: convertForm.rating,
        persona: currentPersona,
      });
      setSelected(null);
    } catch (e) {
      console.error('Failed to convert book', e);
      window.alert('Could not convert this book to a story.');
    } finally {
      setSavingConversion(false);
    }
  };

  const renderRatingStars = (item: BookItem) => {
    const rating = item.rating ?? 0;
    return (
      <ButtonGroup size="sm">
        {[1,2,3,4,5].map((value) => (
          <Button key={value} variant={value <= rating ? 'warning' : 'outline-secondary'} onClick={() => handleRatingChange(item, value)}>★</Button>
        ))}
      </ButtonGroup>
    );
  };

  const renderListView = () => (
    <Table striped hover responsive size="sm" className="mb-0">
      <thead>
        <tr>
          <th>Book</th>
          <th>Status</th>
          <th>Added</th>
          <th>Rating</th>
          <th style={{ width: 250 }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {pagedBooks.map((b) => {
          const converted = !!b.lastConvertedStoryId;
          return (
            <tr key={b.id}>
              <td>
                <div className="d-flex align-items-center gap-2">
                  {b.coverImage ? (
                    <img src={b.coverImage} alt={b.title} style={{ width: 34, height: 50, objectFit: 'cover', borderRadius: 4 }} />
                  ) : <div style={{ width: 34, height: 50, background: '#ddd', borderRadius: 4 }} />}
                  <div>
                    <div className="fw-semibold">{b.title}</div>
                    {b.authors?.length ? <div className="text-muted small">{b.authors.join(', ')}</div> : null}
                  </div>
                </div>
              </td>
              <td>{b.status ? <Badge bg={String(b.status).toLowerCase()==='read' ? 'success' : 'secondary'}>{String(b.status)}</Badge> : '—'}</td>
              <td>{b.addedAt ? new Date(b.addedAt).toLocaleDateString() : '—'}</td>
              <td>{renderRatingStars(b)}</td>
              <td>
                <div className="d-flex gap-2">
                  <Button size="sm" variant="outline-primary" onClick={() => openConvert(b)}>Convert to Story</Button>
                  {converted && <Button size="sm" variant="outline-secondary" href={`/stories?storyId=${b.lastConvertedStoryId}`}>View story</Button>}
                  {String(b.status || '').toLowerCase() !== 'read' && (
                    <Button size="sm" variant="outline-success" onClick={() => markRead(b)}>Mark Read</Button>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
        {filteredBooks.length === 0 && (
          <tr><td colSpan={5} className="text-center text-muted py-4">No books match the current filters.</td></tr>
        )}
      </tbody>
    </Table>
  );

  const renderCardView = () => (
    <Row xs={1} md={2} lg={3} className="g-3">
      {pagedBooks.map((b) => {
        const converted = !!b.lastConvertedStoryId;
        return (
          <Col key={b.id}>
            <Card className="h-100 shadow-sm">
              <div className="d-flex" style={{ gap: 12, padding: 12 }}>
                {b.coverImage ? (
                  <img src={b.coverImage} alt={b.title} style={{ width: 64, height: 96, objectFit: 'cover', borderRadius: 4 }} />
                ) : <div style={{ width: 64, height: 96, background: '#ddd', borderRadius: 4 }} />}
                <div className="flex-grow-1">
                  <Card.Title className="mb-1" style={{ fontSize: '1rem' }}>{b.title}</Card.Title>
                  {b.authors?.length ? <div className="text-muted small mb-2">{b.authors.join(', ')}</div> : null}
                  <div className="mb-2">{renderRatingStars(b)}</div>
                  <div className="d-flex justify-content-between align-items-center">
                    <Badge bg={String(b.status || '').toLowerCase()==='read' ? 'success' : 'secondary'}>{b.status || '—'}</Badge>
                    <div className="d-flex gap-2">
                      <Button size="sm" variant="outline-primary" onClick={() => openConvert(b)}>Convert</Button>
                      {String(b.status || '').toLowerCase() !== 'read' && (
                        <Button size="sm" variant="outline-success" onClick={() => markRead(b)}>Read</Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </Col>
        );
      })}
      {filteredBooks.length === 0 && (
        <Col><div className="text-center text-muted py-4">No books match the current filters.</div></Col>
      )}
    </Row>
  );

  return (
    <Card className="border-0 shadow-sm">
      <Card.Header className="bg-white d-flex flex-wrap gap-3 align-items-center justify-content-between">
        <div>
          <h5 className="mb-1">Books Backlog</h5>
          <div className="text-muted small">Imported from Hardcover — convert into stories.</div>
        </div>
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <Form.Control size="sm" placeholder="Search books" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 200 }} />
          <Form.Select size="sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={{ width: 180 }}>
            <option value="all">All</option>
            <option value="to-read">To Read</option>
            <option value="reading">Reading</option>
            <option value="read">Read</option>
            <option value="unconverted">Backlog only</option>
            <option value="converted">Story linked</option>
          </Form.Select>
          <Form.Control size="sm" type="date" value={addedSince} onChange={(e) => setAddedSince(e.target.value)} style={{ width: 160 }} title="Added since" />
          <ButtonGroup size="sm">
            <Button variant={viewMode === 'list' ? 'primary' : 'outline-secondary'} onClick={() => setViewMode('list')}>List</Button>
            <Button variant={viewMode === 'card' ? 'primary' : 'outline-secondary'} onClick={() => setViewMode('card')}>Cards</Button>
          </ButtonGroup>
          <Button size="sm" variant="outline-primary" onClick={() => { setShowImportModal(true); setImportMsg(null); }}>Import list</Button>
        </div>
      </Card.Header>
      <Card.Body>
        {msg && <Alert variant="success">{msg}</Alert>}
        {importMsg && <Alert variant="info">{importMsg}</Alert>}
        {loading ? (
          <div className="d-flex justify-content-center py-4">
            <Spinner animation="border" role="status" size="sm" />
          </div>
        ) : (viewMode === 'list' ? renderListView() : renderCardView())}
        {filteredBooks.length > pageSize && (
          <div className="d-flex justify-content-center mt-3">
            <Pagination>
              <Pagination.Prev disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))} />
              <Pagination.Item active>{page}</Pagination.Item>
              <Pagination.Next disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} />
            </Pagination>
          </div>
        )}
      </Card.Body>

      <Modal show={!!selected} onHide={() => setSelected(null)} centered>
        <Modal.Header closeButton><Modal.Title>Convert to Story</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Goal</Form.Label>
              <Form.Select value={convertForm.goalId} onChange={(e) => setConvertForm(prev => ({ ...prev, goalId: e.target.value }))}>
                <option value="">Select goal…</option>
                {goals.map(g => (<option key={g.id} value={g.id}>{g.title}</option>))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Sprint (optional)</Form.Label>
              <Form.Select value={convertForm.sprintId || ''} onChange={(e) => setConvertForm(prev => ({ ...prev, sprintId: e.target.value || null }))}>
                <option value="">No sprint</option>
                {sprints.map((s: Sprint) => (<option key={s.id} value={s.id}>{s.name}</option>))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Target / Completed date</Form.Label>
              <Form.Control type="date" value={convertForm.targetDate} onChange={(e) => setConvertForm(prev => ({ ...prev, targetDate: e.target.value }))} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Personal rating</Form.Label>
              <Form.Select value={convertForm.rating} onChange={(e) => setConvertForm(prev => ({ ...prev, rating: Number(e.target.value) }))}>
                {[1,2,3,4,5].map(star => (<option key={star} value={star}>{`${'★'.repeat(star)}${'☆'.repeat(5-star)}`}</option>))}
              </Form.Select>
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setSelected(null)}>Cancel</Button>
          <Button variant="primary" onClick={handleConvert} disabled={savingConversion}>{savingConversion ? 'Converting…' : 'Convert'}</Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showImportModal} onHide={() => setShowImportModal(false)} centered>
        <Modal.Header closeButton><Modal.Title>Import Hardcover List</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>List URL or slug</Form.Label>
              <Form.Control value={importSlug} onChange={(e) => setImportSlug(e.target.value)} placeholder="e.g. https://hardcover.app/@user/lists/2026" />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Goal to link</Form.Label>
              <Form.Select value={importGoalId} onChange={(e) => setImportGoalId(e.target.value)}>
                <option value="">Select goal…</option>
                {goals.map(g => (<option key={g.id} value={g.id}>{g.title}</option>))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Priority</Form.Label>
              <Form.Select value={importPriority} onChange={(e) => setImportPriority(Number(e.target.value))}>
                {[1,2,3,4,5].map((p) => (<option key={p} value={p}>{`P${p}`}</option>))}
              </Form.Select>
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowImportModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={async () => {
            if (!currentUser) return;
            if (!importGoalId) { window.alert('Select a goal'); return; }
            const slug = (() => {
              const raw = importSlug.trim();
              const m = raw.match(/lists\/([^/?]+)/i);
              if (m && m[1]) return m[1];
              return raw.replace(/^\//, '');
            })();
            if (!slug) { window.alert('Enter a list slug or URL'); return; }
            setImporting(true);
            setImportMsg(null);
            try {
              const fn = httpsCallable(functions, 'importHardcoverListToStories');
              const res:any = await fn({ listSlug: slug, goalId: importGoalId, priority: importPriority, persona: currentPersona });
              const data = res?.data || res;
              setImportMsg(`Imported ${data?.created || 0} stories (skipped ${data?.skipped || 0}) from list ${data?.listSlug || slug}.`);
              setShowImportModal(false);
            } catch (e:any) {
              console.error('importHardcoverListToStories failed', e);
              window.alert(e?.message || 'Import failed');
            } finally {
              setImporting(false);
            }
          }} disabled={importing}>{importing ? 'Importing…' : 'Import'}</Button>
        </Modal.Footer>
      </Modal>
    </Card>
  );
};

export default BooksBacklog;
