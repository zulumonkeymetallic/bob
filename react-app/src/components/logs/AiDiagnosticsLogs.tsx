import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Card, Form, Table } from 'react-bootstrap';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';

interface AiLogEntry {
  id: string;
  event?: string;
  status?: string;
  level?: string;
  message?: string;
  metadata?: Record<string, unknown>;
  createdAt?: any;
  ts?: any;
  expiresAt?: any;
}

const AiDiagnosticsLogs: React.FC = () => {
  const { currentUser } = useAuth();
  const [logs, setLogs] = useState<AiLogEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState<string>('all');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const logsQuery = query(
        collection(db, 'ai_logs'),
        where('ownerUid', '==', currentUser.uid),
        limit(300)
      );
      const unsub = onSnapshot(logsQuery, (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as AiLogEntry[];
        rows.sort((a, b) => {
          const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.ts?.toMillis ? a.ts.toMillis() : (a.ts || 0));
          const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.ts?.toMillis ? b.ts.toMillis() : (b.ts || 0));
          return bt - at;
        });
        setLogs(rows);
        setLoading(false);
      });
      return () => unsub();
    } catch (e: any) {
      console.error('[ai-logs] subscription failed', e);
      setError(e?.message || 'Failed to load AI diagnostics');
      setLoading(false);
    }
  }, [currentUser]);

  const events = useMemo(() => {
    const names = new Set<string>();
    logs.forEach((entry) => {
      if (entry.event) names.add(String(entry.event));
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [logs]);

  const visibleLogs = useMemo(() => {
    return logs
      .filter((entry) => {
        if (eventFilter === 'all') return true;
        return String(entry.event || '').toLowerCase() === eventFilter;
      })
      .filter((entry) => {
        if (levelFilter === 'all') return true;
        return String(entry.level || '').toLowerCase() === levelFilter;
      })
      .filter((entry) => {
        if (statusFilter === 'all') return true;
        return String(entry.status || '').toLowerCase() === statusFilter;
      });
  }, [logs, eventFilter, levelFilter, statusFilter]);

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-0">AI Diagnostics Logs</h2>
          <small className="text-muted">Manual runs and planner activity for the AI assistant.</small>
        </div>
        <Badge bg="secondary">Retention: 30 days</Badge>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {loading && <Alert variant="light">Loading…</Alert>}

      <Card>
        <Card.Body>
          <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
            <Form.Select
              size="sm"
              style={{ maxWidth: 200 }}
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
            >
              <option value="all">All Events</option>
              {events.map((name) => (
                <option key={name} value={name.toLowerCase()}>{name}</option>
              ))}
            </Form.Select>
            <Form.Select
              size="sm"
              style={{ maxWidth: 160 }}
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
            >
              <option value="all">All Levels</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
            </Form.Select>
            <Form.Select
              size="sm"
              style={{ maxWidth: 160 }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Statuses</option>
              <option value="success">Success</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
            </Form.Select>
          </div>

          {visibleLogs.length === 0 ? (
            <Alert variant="light" className="mb-0">No logs captured yet.</Alert>
          ) : (
            <Table size="sm" responsive>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Status</th>
                  <th>Level</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {visibleLogs.map((entry) => {
                  const timestamp = entry.createdAt?.toDate
                    ? entry.createdAt.toDate()
                    : entry.ts?.toDate
                    ? entry.ts.toDate()
                    : entry.ts
                    ? new Date(entry.ts)
                    : null;
                  const meta = entry.metadata;
                  return (
                    <tr key={entry.id}>
                      <td>{timestamp ? timestamp.toLocaleString() : '—'}</td>
                      <td><Badge bg="light" text="dark">{entry.event || '—'}</Badge></td>
                      <td>{entry.status || '—'}</td>
                      <td>{entry.level || 'info'}</td>
                      <td>
                        <div>{entry.message || '—'}</div>
                        {meta ? (
                          <pre className="mt-1 mb-0 bg-light p-2" style={{ whiteSpace: 'pre-wrap' }}>
                            {JSON.stringify(meta, null, 2)}
                          </pre>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
    </div>
  );
};

export default AiDiagnosticsLogs;
