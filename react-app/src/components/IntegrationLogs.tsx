import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Form, Table } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, onSnapshot, query, where, limit } from 'firebase/firestore';

const readLogTimestampMs = (row: any): number => {
  const createdAtMs = row?.createdAt?.toMillis ? row.createdAt.toMillis() : Number(row?.createdAt || 0);
  if (Number.isFinite(createdAtMs) && createdAtMs > 0) return createdAtMs;
  const tsMs = row?.ts?.toMillis ? row.ts.toMillis() : Number(row?.ts || 0);
  if (Number.isFinite(tsMs) && tsMs > 0) return tsMs;
  const timestampMs = row?.timestamp?.toMillis ? row.timestamp.toMillis() : Number(row?.timestamp || 0);
  return Number.isFinite(timestampMs) && timestampMs > 0 ? timestampMs : 0;
};

const readLogTimeLabel = (row: any): string => {
  const ms = readLogTimestampMs(row);
  return ms > 0 ? new Date(ms).toLocaleString() : '—';
};

const readTraceId = (row: any): string => String(
  row?.traceId
  || row?.metadata?.traceId
  || row?.meta?.traceId
  || row?.context?.traceId
  || ''
).trim();

const readPromptTemplateId = (row: any): string => String(
  row?.promptTemplateId
  || row?.templateId
  || row?.metadata?.promptTemplateId
  || row?.metadata?.templateId
  || row?.meta?.promptTemplateId
  || row?.meta?.templateId
  || ''
).trim();

const readParseStatus = (row: any): string => String(
  row?.parseStatus
  || row?.metadata?.parseStatus
  || row?.meta?.parseStatus
  || ''
).trim().toLowerCase();

const readLatencyMs = (row: any): number | null => {
  const raw = row?.latencyMs ?? row?.metadata?.latencyMs ?? row?.meta?.latencyMs;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
};

const isTraceEvent = (row: any): boolean => {
  const type = String(row?.type || '').toLowerCase();
  if (type.endsWith('_trace')) return true;
  if (readTraceId(row)) return true;
  if (readPromptTemplateId(row)) return true;
  return false;
};

const readDateStartMs = (value: string): number | null => {
  if (!value) return null;
  const ms = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const readDateEndMs = (value: string): number | null => {
  if (!value) return null;
  const ms = new Date(`${value}T23:59:59`).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const IntegrationLogs: React.FC = () => {
  const { currentUser } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [integrationFilter, setIntegrationFilter] = useState<string>('all');
  const [logLevelFilter, setLogLevelFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [parseStatusFilter, setParseStatusFilter] = useState<string>('all');
  const [templateFilter, setTemplateFilter] = useState<string>('all');
  const [dateRangeFilter, setDateRangeFilter] = useState<'24h' | '7d' | '30d' | 'all' | 'custom'>('7d');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [traceOnly, setTraceOnly] = useState<boolean>(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    let ownerRows: any[] = [];
    let userRows: any[] = [];
    let aiRows: any[] = [];

    const publishRows = () => {
      const deduped = new Map<string, any>();
      [...ownerRows, ...userRows, ...aiRows].forEach((row: any) => {
        if (!row?.id) return;
        const rowKey = `${String(row._stream || 'integration_logs')}:${String(row.id)}`;
        deduped.set(rowKey, { ...row, _rowKey: rowKey });
      });
      const merged = Array.from(deduped.values());
      merged.sort((a: any, b: any) => readLogTimestampMs(b) - readLogTimestampMs(a));
      setLogs(merged);
      setLoading(false);
    };

    try {
      const logsByOwnerQuery = query(
        collection(db, 'integration_logs'),
        where('ownerUid', '==', currentUser.uid),
        limit(300)
      );
      const logsByUserQuery = query(
        collection(db, 'integration_logs'),
        where('userId', '==', currentUser.uid),
        limit(300)
      );

      const unsubOwner = onSnapshot(logsByOwnerQuery, (snap) => {
        ownerRows = snap.docs.map((d) => ({ id: d.id, ...d.data(), _stream: 'integration_logs' }));
        publishRows();
      });

      const unsubUser = onSnapshot(logsByUserQuery, (snap) => {
        userRows = snap.docs.map((d) => ({ id: d.id, ...d.data(), _stream: 'integration_logs' }));
        publishRows();
      });

      const aiLogsQuery = query(
        collection(db, 'ai_logs'),
        where('ownerUid', '==', currentUser.uid),
        limit(300)
      );

      const unsubAi = onSnapshot(aiLogsQuery, (snap) => {
        aiRows = snap.docs.map((d) => ({ id: d.id, ...d.data(), _stream: 'ai_logs' }));
        publishRows();
      });

      return () => {
        unsubOwner();
        unsubUser();
        unsubAi();
      };
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
      } else if (log.event) {
        names.add(String(log.event));
      }
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [logs]);

  const visibleLogs = useMemo(() => {
    const nowMs = Date.now();
    const rangeStartMs = (() => {
      if (dateRangeFilter === 'all') return null;
      if (dateRangeFilter === '24h') return nowMs - (24 * 60 * 60 * 1000);
      if (dateRangeFilter === '7d') return nowMs - (7 * 24 * 60 * 60 * 1000);
      if (dateRangeFilter === '30d') return nowMs - (30 * 24 * 60 * 60 * 1000);
      return readDateStartMs(dateFrom);
    })();
    const rangeEndMs = dateRangeFilter === 'custom' ? readDateEndMs(dateTo) : null;

    return logs
      .filter((l: any) => {
        const ts = readLogTimestampMs(l);
        if (!ts) return dateRangeFilter === 'all';
        if (rangeStartMs != null && ts < rangeStartMs) return false;
        if (rangeEndMs != null && ts > rangeEndMs) return false;
        return true;
      })
      .filter((l: any) => {
        if (!traceOnly) return true;
        return isTraceEvent(l);
      })
      .filter((l: any) => {
        if (integrationFilter === 'all') return true;
        const integration = String(l.integration || l.source || l.event || l._stream || '').toLowerCase();
        return integration === integrationFilter;
      })
      .filter((l: any) => {
        if (logLevelFilter === 'all') return true;
        return String(l.level || '').toLowerCase() === logLevelFilter;
      })
      .filter((l: any) => {
        if (statusFilter === 'all') return true;
        return String(l.status || '').toLowerCase() === statusFilter;
      })
      .filter((l: any) => {
        if (parseStatusFilter === 'all') return true;
        return readParseStatus(l) === parseStatusFilter;
      })
      .filter((l: any) => {
        if (templateFilter === 'all') return true;
        return readPromptTemplateId(l) === templateFilter;
      });
  }, [logs, integrationFilter, logLevelFilter, statusFilter, parseStatusFilter, templateFilter, traceOnly, dateRangeFilter, dateFrom, dateTo]);

  const parseStatuses = useMemo(() => {
    const options = new Set<string>();
    logs.forEach((log: any) => {
      const parseStatus = readParseStatus(log);
      if (parseStatus) options.add(parseStatus);
    });
    return Array.from(options).sort((a, b) => a.localeCompare(b));
  }, [logs]);

  const templateIds = useMemo(() => {
    const options = new Set<string>();
    logs.forEach((log: any) => {
      const templateId = readPromptTemplateId(log);
      if (templateId) options.add(templateId);
    });
    return Array.from(options).sort((a, b) => a.localeCompare(b));
  }, [logs]);

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h2 className="mb-0">Integration & AI Logs</h2>
          <small className="text-muted">Authentication/sync events plus AI trace telemetry (template, parse status, latency, prompt payload details).</small>
        </div>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {loading && <Alert variant="light">Loading…</Alert>}

      <Card>
        <Card.Body>
          <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
            <Form.Check
              type="switch"
              id="trace-only-toggle"
              label="Trace events only"
              checked={traceOnly}
              onChange={(e) => setTraceOnly(e.target.checked)}
              className="me-2"
            />
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
            <Form.Select size="sm" style={{ maxWidth: 180 }} value={parseStatusFilter} onChange={(e)=>setParseStatusFilter(e.target.value)}>
              <option value="all">All Parse Status</option>
              {parseStatuses.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </Form.Select>
            <Form.Select size="sm" style={{ maxWidth: 260 }} value={templateFilter} onChange={(e)=>setTemplateFilter(e.target.value)}>
              <option value="all">All Templates</option>
              {templateIds.map((templateId) => (
                <option key={templateId} value={templateId}>{templateId}</option>
              ))}
            </Form.Select>
            <Form.Select size="sm" style={{ maxWidth: 170 }} value={dateRangeFilter} onChange={(e) => setDateRangeFilter(e.target.value as any)}>
              <option value="24h">Last 24h</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="all">All time</option>
              <option value="custom">Custom range</option>
            </Form.Select>
            {dateRangeFilter === 'custom' && (
              <>
                <Form.Control
                  size="sm"
                  type="date"
                  style={{ maxWidth: 150 }}
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  aria-label="From date"
                />
                <Form.Control
                  size="sm"
                  type="date"
                  style={{ maxWidth: 150 }}
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  aria-label="To date"
                />
              </>
            )}
          </div>
          {visibleLogs.length === 0 ? (
            <Alert variant="light" className="mb-0">No logs yet.</Alert>
          ) : (
            <Table size="sm" responsive>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Integration</th>
                  <th>Trace ID</th>
                  <th>Template</th>
                  <th>Parse</th>
                  <th>Latency</th>
                  <th>Status</th>
                  <th>Level</th>
                  <th>Message</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleLogs.map((l: any) => {
                  const traceId = readTraceId(l);
                  const templateId = readPromptTemplateId(l);
                  const parseStatus = readParseStatus(l);
                  const latencyMs = readLatencyMs(l);
                  const details = {
                    prompt: l.prompt || l.metadata?.prompt || l.meta?.prompt || null,
                    input: l.input || l.metadata?.input || l.meta?.input || null,
                    output: l.output || l.metadata?.output || l.meta?.output || null,
                    metadata: l.metadata || l.meta || null,
                  };
                  const hasDetails = !!(details.prompt || details.input || details.output || details.metadata);
                  const rowKey = String(l._rowKey || l.id);
                  const expanded = expandedLogId === rowKey;

                  return (
                    <React.Fragment key={rowKey}>
                      <tr>
                        <td>{readLogTimeLabel(l)}</td>
                        <td><Badge bg="light" text="dark">{l.integration || l.source || l.event || l._stream || '—'}</Badge></td>
                        <td><code>{traceId || '—'}</code></td>
                        <td><code>{templateId || '—'}</code></td>
                        <td>{parseStatus || '—'}</td>
                        <td>{latencyMs != null ? `${latencyMs} ms` : '—'}</td>
                        <td>{l.status || '—'}</td>
                        <td>{l.level || 'info'}</td>
                        <td>{l.message || '—'}</td>
                        <td>
                          {hasDetails ? (
                            <Button
                              size="sm"
                              variant="outline-secondary"
                              onClick={() => setExpandedLogId(expanded ? null : rowKey)}
                            >
                              {expanded ? 'Hide' : 'Details'}
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={10}>
                            {details.prompt && (
                              <div className="mb-2">
                                <div className="fw-semibold small text-muted">Prompt</div>
                                <pre className="mb-0 bg-light p-2" style={{ whiteSpace: 'pre-wrap' }}>
                                  {typeof details.prompt === 'string' ? details.prompt : JSON.stringify(details.prompt, null, 2)}
                                </pre>
                              </div>
                            )}
                            {details.input && (
                              <div className="mb-2">
                                <div className="fw-semibold small text-muted">Input Payload</div>
                                <pre className="mb-0 bg-light p-2" style={{ whiteSpace: 'pre-wrap' }}>
                                  {typeof details.input === 'string' ? details.input : JSON.stringify(details.input, null, 2)}
                                </pre>
                              </div>
                            )}
                            {details.output && (
                              <div className="mb-2">
                                <div className="fw-semibold small text-muted">Raw Output</div>
                                <pre className="mb-0 bg-light p-2" style={{ whiteSpace: 'pre-wrap' }}>
                                  {typeof details.output === 'string' ? details.output : JSON.stringify(details.output, null, 2)}
                                </pre>
                              </div>
                            )}
                            {details.metadata && (
                              <div>
                                <div className="fw-semibold small text-muted">Metadata</div>
                                <pre className="mb-0 bg-light p-2" style={{ whiteSpace: 'pre-wrap' }}>
                                  {JSON.stringify(details.metadata, null, 2)}
                                </pre>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
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

export default IntegrationLogs;
