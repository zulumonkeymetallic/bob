import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, Spinner, Table } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';

interface BlockPreview {
  title: string;
  theme?: string;
  displayStart?: string | null;
  displayEnd?: string | null;
  durationMinutes?: number | null;
  deepLink?: string | null;
  task?: { id: string; title: string; ref?: string | null } | null;
  story?: { id: string; title: string; ref?: string | null } | null;
  goal?: { id: string; title: string; ref?: string | null } | null;
}

interface PlanningPreviewResponse {
  status: string;
  jobId: string;
  timezone: string;
  proposedCount: number;
  validator?: { score?: number; errors?: string[]; warnings?: string[]; blockAnnotations?: Array<{ errors?: string[]; warnings?: string[] }> } | null;
  preview?: {
    timezone?: string;
    blocks?: BlockPreview[];
  } | null;
  appliedBlocks?: number;
  approvedAt?: { seconds?: number } | null;
}

const PlanningApprovalPage: React.FC = () => {
  const [params] = useSearchParams();
  const jobId = params.get('jobId') || '';
  const token = params.get('token') || '';
  const uidParam = params.get('uid') || '';
  const navigate = useNavigate();
  const { currentUser } = useAuth();

  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<PlanningPreviewResponse | null>(null);

  const fetchPreview = useCallback(async () => {
    if (!jobId || !token || !uidParam) {
      setError('Missing approval parameters in the link.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/approve-planning?jobId=${encodeURIComponent(jobId)}&uid=${encodeURIComponent(uidParam)}&token=${encodeURIComponent(token)}`,
      );
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok) {
        const message = response.status === 403 ? 'This approval link is no longer valid.' : `Failed to load proposal (HTTP ${response.status}).`;
        throw new Error(message);
      }
      if (!contentType.includes('application/json')) {
        throw new Error('Unexpected response while loading proposal.');
      }
      const data = (await response.json()) as PlanningPreviewResponse;
      setJob(data);
    } catch (err: any) {
      setError(err?.message || 'Unable to load planning proposal.');
    } finally {
      setLoading(false);
    }
  }, [jobId, token, uidParam]);

  const approvePlan = useCallback(async () => {
    if (!jobId || !token || !uidParam) return;
    setApproving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/approve-planning?jobId=${encodeURIComponent(jobId)}&uid=${encodeURIComponent(uidParam)}&token=${encodeURIComponent(token)}`,
        { method: 'POST' },
      );
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok) {
        if (contentType.includes('application/json')) {
          const payload = await response.json();
          throw new Error(payload?.error || 'Failed to approve plan.');
        }
        throw new Error(`Failed to approve plan (HTTP ${response.status}).`);
      }
      let payload: any = null;
      if (contentType.includes('application/json')) {
        payload = await response.json();
      }
      await fetchPreview();
      if (payload?.ok) {
        // No-op; UI already refreshed by fetchPreview
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to approve plan.');
    } finally {
      setApproving(false);
    }
  }, [fetchPreview, jobId, token, uidParam]);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  const blocks = useMemo(() => job?.preview?.blocks || [], [job]);
  const blockAnn = useMemo(() => job?.validator?.blockAnnotations || [], [job]);
  const uniqueGoals = useMemo(() => {
    const map = new Map<string, { title: string; deepLink?: string | null }>();
    for (const block of blocks) {
      if (block.goal?.id) {
        const refOrId = block.goal?.ref || block.goal.id;
        map.set(block.goal.id, {
          title: block.goal.title,
          deepLink: block.deepLink || `/goals/${refOrId}`,
        });
      }
    }
    return Array.from(map.entries());
  }, [blocks]);

  const uniqueTasks = useMemo(() => {
    const map = new Map<string, { title: string; deepLink?: string | null }>();
    for (const block of blocks) {
      if (block.task?.id) {
        const refOrId = block.task?.ref || block.task.id;
        map.set(block.task.id, {
          title: block.task.title,
          deepLink: block.deepLink || `/tasks/${refOrId}`,
        });
      }
    }
    return Array.from(map.entries());
  }, [blocks]);

  const approvalDisabled = loading || approving || (job?.status && job.status !== 'proposed');

  return (
    <div className="container py-4">
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <h1 className="mb-3">Daily Plan Proposal</h1>
        <p className="text-muted">
          Review the AI-generated blocks below. Approving will sync them into your calendar immediately.
        </p>

        {currentUser && currentUser.uid !== uidParam && (
          <Alert variant="warning">
            You are signed in as <strong>{currentUser.email}</strong>, but this approval link is for a different account.
            Please sign out or open with the correct account if needed.
          </Alert>
        )}

        {error && (
          <Alert variant="danger" className="mb-3">
            {error}
          </Alert>
        )}

        {loading && (
          <div className="d-flex align-items-center gap-2">
            <Spinner animation="border" size="sm" />
            <span>Loading proposal…</span>
          </div>
        )}

        {!loading && job && (
          <>
            <Card className="mb-3">
              <Card.Body>
                <div className="d-flex flex-wrap align-items-center justify-content-between gap-3">
                  <div>
                    <h5 className="mb-1">Proposal Status</h5>
                    <Badge bg={job.status === 'proposed' ? 'warning' : job.status === 'approved' ? 'success' : 'secondary'}>
                      {job.status}
                    </Badge>
                    <div className="mt-2 text-muted" style={{ fontSize: 14 }}>
                      Timezone: {job.preview?.timezone || job.timezone} · Blocks proposed: {job.proposedCount}
                      {typeof job.validator?.score === 'number' && (
                        <> · Validation score: {job.validator.score.toFixed(2)}</>
                      )}
                      {(Array.isArray(job.validator?.errors) && job.validator!.errors!.length > 0) && (
                        <> · Errors: {job.validator!.errors!.length}</>
                      )}
                      {(Array.isArray(job.validator?.warnings) && job.validator!.warnings!.length > 0) && (
                        <> · Warnings: {job.validator!.warnings!.length}</>
                      )}
                    </div>
                  </div>
                  <div className="d-flex gap-2">
                    <Button
                      variant="primary"
                      disabled={approvalDisabled}
                      onClick={approvePlan}
                    >
                      {approving ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-2" />
                          Applying…
                        </>
                      ) : job.status === 'approved' ? 'Already Applied' : 'Approve & Apply'}
                    </Button>
                    <Button variant="outline-secondary" onClick={() => navigate('/calendar/integration')}>
                      Open Calendar View
                    </Button>
                  </div>
                </div>
              </Card.Body>
            </Card>

            {(job.validator?.errors?.length || job.validator?.warnings?.length) ? (
              <Card className="mb-3">
                <Card.Body>
                  <h6 className="mb-2">Validation Notes</h6>
                  {job.validator?.errors?.length ? (
                    <div className="mb-1" style={{ color: '#b91c1c' }}>Errors: {job.validator.errors.length}</div>
                  ) : null}
                  {job.validator?.warnings?.length ? (
                    <div className="mb-2" style={{ color: '#92400e' }}>Warnings: {job.validator.warnings.length}</div>
                  ) : null}
                  <div className="text-muted" style={{ fontSize: 12 }}>Issues are also indicated per block below.</div>
                </Card.Body>
              </Card>
            ) : null}

            {uniqueGoals.length > 0 && (
              <Card className="mb-3">
                <Card.Body>
                  <h5>Goals Covered</h5>
                  <ul className="mb-0">
                    {uniqueGoals.map(([goalId, goal]) => (
                      <li key={goalId}>
                        {goal.title}{' '}
                        {goal.deepLink && (
                          <a href={goal.deepLink} className="ms-1" target="_blank" rel="noreferrer">
                            View goal
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </Card.Body>
              </Card>
            )}

            {uniqueTasks.length > 0 && (
              <Card className="mb-3">
                <Card.Body>
                  <h5>Tasks Included</h5>
                  <ul className="mb-0">
                    {uniqueTasks.map(([taskId, task]) => (
                      <li key={taskId}>
                        {task.title}{' '}
                        {task.deepLink && (
                          <a href={task.deepLink} className="ms-1" target="_blank" rel="noreferrer">
                            View task
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </Card.Body>
              </Card>
            )}

            <Card>
              <Card.Body>
                <h5 className="mb-3">Block Breakdown</h5>
                {blocks.length === 0 ? (
                  <div className="text-muted">No blocks were generated for this run.</div>
                ) : (
                  <Table responsive hover size="sm" className="align-middle">
                    <thead>
                      <tr>
                        <th style={{ minWidth: 220 }}>When</th>
                        <th>Title</th>
                        <th>Theme</th>
                        <th>Issues</th>
                        <th>Links</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blocks.map((block, idx) => {
                        const ann = blockAnn?.[idx] || {};
                        const eCount = Array.isArray(ann.errors) ? ann.errors.length : 0;
                        const wCount = Array.isArray(ann.warnings) ? ann.warnings.length : 0;
                        return (
                        <tr key={idx}>
                          <td>
                            <div>{block.displayStart || '—'}</div>
                            {block.displayEnd && <div className="text-muted" style={{ fontSize: 12 }}>→ {block.displayEnd}</div>}
                            {block.durationMinutes && (
                              <div className="text-muted" style={{ fontSize: 12 }}>
                                {block.durationMinutes} min session
                              </div>
                            )}
                          </td>
                          <td>
                            <div>{block.title}</div>
                            {block.task?.title && (
                              <div className="text-muted" style={{ fontSize: 12 }}>
                                Task · {block.task.title}
                              </div>
                            )}
                            {block.story?.title && (
                              <div className="text-muted" style={{ fontSize: 12 }}>
                                Story · {block.story.title}
                              </div>
                            )}
                            {block.goal?.title && (
                              <div className="text-muted" style={{ fontSize: 12 }}>
                                Goal · {block.goal.title}
                              </div>
                            )}
                          </td>
                          <td>
                            {block.theme ? <Badge bg="info">{block.theme}</Badge> : <span className="text-muted">—</span>}
                          </td>
                          <td>
                            {eCount === 0 && wCount === 0 && <span className="text-muted">—</span>}
                            {eCount > 0 && <Badge bg="danger" className="me-1">{eCount} error{eCount>1?'s':''}</Badge>}
                            {wCount > 0 && <Badge bg="warning" text="dark">{wCount} warn</Badge>}
                          </td>
                          <td>
                            {block.deepLink ? (
                              <a href={block.deepLink} target="_blank" rel="noreferrer">
                                Open
                              </a>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                )}
              </Card.Body>
            </Card>
          </>
        )}
      </div>
    </div>
  );
};

export default PlanningApprovalPage;
