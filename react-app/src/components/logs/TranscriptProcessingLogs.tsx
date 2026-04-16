import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Card, Form, Table } from 'react-bootstrap';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';

interface IngestionEntry {
  id: string;
  status?: string;
  entryType?: string;
  hasJournal?: boolean;
  journalId?: string;
  fingerprint?: string;
  resultType?: string;
  warnings?: { message: string }[];
  createdTasks?: any[];
  createdStories?: any[];
  processedAt?: any;
  updatedAt?: any;
  errorMessage?: string;
}

const STATUS_COLOUR: Record<string, string> = {
  processed: 'success',
  failed: 'danger',
  pending: 'warning',
  processing: 'info',
};

const TranscriptProcessingLogs: React.FC = () => {
  const { currentUser } = useAuth();
  const [logs, setLogs] = useState<IngestionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, 'transcript_ingestions'),
        where('ownerUid', '==', currentUser.uid),
        orderBy('updatedAt', 'desc'),
        limit(200)
      );
      const unsub = onSnapshot(q, (snap) => {
        setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as IngestionEntry[]);
        setLoading(false);
      }, (e) => {
        console.error('[transcript-logs]', e);
        setError(e?.message || 'Failed to load transcript logs');
        setLoading(false);
      });
      return () => unsub();
    } catch (e: any) {
      setError(e?.message || 'Failed to load transcript logs');
      setLoading(false);
    }
  }, [currentUser]);

  const visible = useMemo(() => logs.filter((e) => {
    if (statusFilter !== 'all' && e.status !== statusFilter) return false;
    if (typeFilter !== 'all' && e.entryType !== typeFilter) return false;
    return true;
  }), [logs, statusFilter, typeFilter]);

  const formatTs = (ts: any) => {
    if (!ts) return '—';
    const ms = ts?.toMillis ? ts.toMillis() : (typeof ts === 'number' ? ts : null);
    if (!ms) return '—';
    return new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-0">Transcript Processing Logs</h2>
          <small className="text-muted">Ingestion history for voice and text transcripts.</small>
        </div>
        <Badge bg="secondary">Last 200 entries</Badge>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {loading && <Alert variant="light">Loading…</Alert>}

      <Card className="mb-3">
        <Card.Body className="py-2 d-flex gap-3 flex-wrap">
          <Form.Select size="sm" style={{ width: 'auto' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="processed">Processed</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
          </Form.Select>
          <Form.Select size="sm" style={{ width: 'auto' }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            <option value="journal">Journal</option>
            <option value="task_list">Task list</option>
            <option value="mixed">Mixed</option>
            <option value="url_only">URL only</option>
          </Form.Select>
          <span className="text-muted small align-self-center">{visible.length} entries</span>
        </Card.Body>
      </Card>

      {!loading && visible.length === 0 && (
        <Alert variant="light">No transcript ingestion records found.</Alert>
      )}

      {visible.length > 0 && (
        <Card>
          <Table hover responsive size="sm" className="mb-0">
            <thead>
              <tr>
                <th>Time</th>
                <th>Status</th>
                <th>Type</th>
                <th>Result</th>
                <th>Tasks</th>
                <th>Stories</th>
                <th>Warnings</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <tr key={entry.id}>
                  <td className="text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                    {formatTs(entry.processedAt || entry.updatedAt)}
                  </td>
                  <td>
                    <Badge bg={STATUS_COLOUR[entry.status || ''] || 'secondary'} style={{ fontSize: 10 }}>
                      {entry.status || '—'}
                    </Badge>
                  </td>
                  <td style={{ fontSize: 11 }}>{entry.entryType || '—'}</td>
                  <td style={{ fontSize: 11 }}>
                    {entry.status === 'failed'
                      ? <span className="text-danger">{entry.errorMessage || 'Error'}</span>
                      : (entry.resultType || (entry.hasJournal ? 'journal' : '—'))}
                  </td>
                  <td style={{ fontSize: 11 }}>{entry.createdTasks?.length ?? '—'}</td>
                  <td style={{ fontSize: 11 }}>{entry.createdStories?.length ?? '—'}</td>
                  <td style={{ fontSize: 11 }}>
                    {entry.warnings && entry.warnings.length > 0
                      ? <span className="text-warning">{entry.warnings.length}</span>
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
};

export default TranscriptProcessingLogs;
