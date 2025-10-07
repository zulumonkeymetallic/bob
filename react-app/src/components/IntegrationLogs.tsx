import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Card, Form, Table } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, onSnapshot, query, where, limit } from 'firebase/firestore';

const IntegrationLogs: React.FC = () => {
  const { currentUser } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [integrationFilter, setIntegrationFilter] = useState<string>('all');
  const [logLevelFilter, setLogLevelFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const logsQuery = query(
        collection(db, 'integration_logs'),
        where('ownerUid', '==', currentUser.uid),
        limit(300)
      );
      const unsub = onSnapshot(logsQuery, (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a: any, b: any) => {
          const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.ts?.toMillis ? a.ts.toMillis() : (a.ts || 0));
          const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.ts?.toMillis ? b.ts.toMillis() : (b.ts || 0));
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

  const integrations = useMemo(() => {
    const names = new Set<string>();
    logs.forEach((log: any) => {
      if (log.integration) {
        names.add(String(log.integration));
      } else if (log.source) {
        names.add(String(log.source));
      }
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [logs]);

  const visibleLogs = useMemo(() => {
    return logs
      .filter((l: any) => {
        if (integrationFilter === 'all') return true;
        const integration = String(l.integration || l.source || '').toLowerCase();
        return integration === integrationFilter;
      })
      .filter((l: any) => {
        if (logLevelFilter === 'all') return true;
        return String(l.level || '').toLowerCase() === logLevelFilter;
      })
      .filter((l: any) => {
        if (statusFilter === 'all') return true;
        return String(l.status || '').toLowerCase() === statusFilter;
      });
  }, [logs, integrationFilter, logLevelFilter, statusFilter]);

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
          <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
            <Form.Select
              size="sm"
              style={{ maxWidth: 200 }}
              value={integrationFilter}
              onChange={(e) => setIntegrationFilter(e.target.value)}
            >
              <option value="all">All Integrations</option>
              {integrations.map((name) => (
                <option key={name} value={name.toLowerCase()}>{name}</option>
              ))}
            </Form.Select>
            <Form.Select size="sm" style={{ maxWidth: 160 }} value={logLevelFilter} onChange={(e)=>setLogLevelFilter(e.target.value)}>
              <option value="all">All Levels</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
            </Form.Select>
            <Form.Select size="sm" style={{ maxWidth: 160 }} value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)}>
              <option value="all">All Statuses</option>
              <option value="success">Success</option>
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
                  <th>Integration</th>
                  <th>Status</th>
                  <th>Level</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {visibleLogs.map((l: any) => (
                  <tr key={l.id}>
                    <td>{l.createdAt?.toDate ? l.createdAt.toDate().toLocaleString() : (l.ts?.toDate ? l.ts.toDate().toLocaleString() : (l.ts ? new Date(l.ts).toLocaleString() : '—'))}</td>
                    <td><Badge bg="light" text="dark">{l.integration || l.source || '—'}</Badge></td>
                    <td>{l.status || '—'}</td>
                    <td>{l.level || 'info'}</td>
                    <td>
                      <div>{l.message || '—'}</div>
                      {(() => {
                        const meta = l.metadata || l.meta;
                        if (!meta) return null;
                        return (
                          <pre className="mt-1 mb-0 bg-light p-2" style={{ whiteSpace: 'pre-wrap' }}>
                            {JSON.stringify(meta, null, 2)}
                          </pre>
                        );
                      })()}
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
