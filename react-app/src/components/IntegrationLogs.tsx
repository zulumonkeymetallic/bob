import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Card, Form, Table } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, onSnapshot, query, where, limit } from 'firebase/firestore';

const IntegrationLogs: React.FC = () => {
  const { currentUser } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [logSourceFilter, setLogSourceFilter] = useState<string>('all');
  const [logLevelFilter, setLogLevelFilter] = useState<string>('all');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const logsQuery = query(
        collection(db, 'integration_logs'),
        where('ownerUid', '==', currentUser.uid),
        limit(200)
      );
      const unsub = onSnapshot(logsQuery, (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a: any, b: any) => {
          const at = a.ts?.toMillis ? a.ts.toMillis() : (a.ts || 0);
          const bt = b.ts?.toMillis ? b.ts.toMillis() : (b.ts || 0);
          return bt - at;
        });
        setLogs(rows);
        setLoading(false);
      });
      return () => unsub();
    } catch (e: any) {
      setError(e?.message || 'Failed to load logs');
      setLoading(false);
    }
  }, [currentUser]);

  const visibleLogs = useMemo(() => {
    return logs
      .filter((l: any) => logSourceFilter === 'all' || String(l.source).toLowerCase() === logSourceFilter)
      .filter((l: any) => logLevelFilter === 'all' || String(l.level).toLowerCase() === logLevelFilter);
  }, [logs, logSourceFilter, logLevelFilter]);

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h2 className="mb-0">Integration Logs</h2>
          <small className="text-muted">Authentication, sync, and error events from Google, Monzo, Strava, Parkrun, etc.</small>
        </div>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {loading && <Alert variant="light">Loading…</Alert>}

      <Card>
        <Card.Body>
          <div className="d-flex gap-2 align-items-center mb-2">
            <Form.Select size="sm" style={{ maxWidth: 200 }} value={logSourceFilter} onChange={(e)=>setLogSourceFilter(e.target.value)}>
              <option value="all">All Sources</option>
              <option value="google">Google</option>
              <option value="monzo">Monzo</option>
              <option value="strava">Strava</option>
              <option value="parkrun">Parkrun</option>
              <option value="finance">Finance</option>
            </Form.Select>
            <Form.Select size="sm" style={{ maxWidth: 160 }} value={logLevelFilter} onChange={(e)=>setLogLevelFilter(e.target.value)}>
              <option value="all">All Levels</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
            </Form.Select>
          </div>
          {visibleLogs.length === 0 ? (
            <Alert variant="light" className="mb-0">No logs yet.</Alert>
          ) : (
            <Table size="sm" responsive>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Source</th>
                  <th>Level</th>
                  <th>Step</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {visibleLogs.map((l: any) => (
                  <tr key={l.id}>
                    <td>{l.ts?.toDate ? l.ts.toDate().toLocaleString() : (l.ts ? new Date(l.ts).toLocaleString() : '—')}</td>
                    <td><Badge bg="light" text="dark">{l.source}</Badge></td>
                    <td>{l.level}</td>
                    <td>{l.step || '—'}</td>
                    <td>
                      <div>{l.message || '—'}</div>
                      {l.meta ? (
                        <pre className="mt-1 mb-0 bg-light p-2" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(l.meta, null, 2)}</pre>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
    </div>
  );
};

export default IntegrationLogs;

