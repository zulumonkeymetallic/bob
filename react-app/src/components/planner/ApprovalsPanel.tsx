import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Spinner } from 'react-bootstrap';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

interface PlanningJob {
  id: string;
  userId: string;
  status: 'proposed' | 'approved' | 'completed' | 'error' | string;
  startedAt?: any;
  completedAt?: any;
  appliedBlocks?: number;
  proposedBlocks?: any[];
  approvalToken?: string;
  validator?: { score?: number; errors?: any[] };
  source?: string;
  error?: string;
}

const PROJECT_ID = 'bob20250810';
const REGION = 'europe-west2';

function toDateSafe(ts: any): Date | null {
  try {
    if (!ts) return null;
    if (typeof ts.toDate === 'function') return ts.toDate();
    if (typeof ts === 'number') return new Date(ts);
    return null;
  } catch { return null; }
}

const ApprovalsPanel: React.FC = () => {
  const { currentUser } = useAuth();
  const [jobs, setJobs] = useState<PlanningJob[]>([]);
  const [applying, setApplying] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(
      collection(db, 'planning_jobs'),
      where('userId', '==', currentUser.uid),
      orderBy('startedAt', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      setJobs(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as PlanningJob[]);
    });
    return () => unsub();
  }, [currentUser?.uid]);

  const proposed = useMemo(() => jobs.filter(j => j.status === 'proposed'), [jobs]);
  const recent = useMemo(() => jobs.slice(0, 5), [jobs]);

  const applyJob = async (job: PlanningJob) => {
    if (!currentUser?.uid) return;
    if (!job.approvalToken) {
      setErr('Missing approval token on job.');
      return;
    }
    setApplying(job.id);
    setErr(null);
    try {
      const params = new URLSearchParams({
        jobId: job.id,
        uid: currentUser.uid,
        token: job.approvalToken,
      });
      const url = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/approvePlanningJob?${params.toString()}`;
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e: any) {
      setErr(e?.message || 'Failed to apply plan');
    } finally {
      setApplying(null);
    }
  };

  return (
    <Card className="mt-3">
      <Card.Body>
        <div className="d-flex align-items-center justify-content-between mb-2">
          <div className="fw-semibold">Approvals</div>
          <Badge bg={proposed.length > 0 ? 'warning' : 'secondary'}>{proposed.length} proposed</Badge>
        </div>
        {err && <Alert variant="danger" className="mb-2">{err}</Alert>}
        {proposed.length === 0 && (
          <div className="text-muted" style={{ fontSize: 13 }}>No pending proposals. Generate a plan from the Matrix or Planner.</div>
        )}
        {proposed.map((job) => {
          const started = toDateSafe(job.startedAt);
          const blocks = Array.isArray(job.proposedBlocks) ? job.proposedBlocks.length : 0;
          const score = typeof job.validator?.score === 'number' ? job.validator?.score.toFixed(2) : 'n/a';
          return (
            <div key={job.id} className="d-flex align-items-center justify-content-between border rounded p-2 mb-2">
              <div>
                <div className="fw-semibold">Proposal: {job.source || 'planner'} · {blocks} blocks</div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  Score: {score} · {started ? started.toLocaleString() : ''}
                </div>
              </div>
              <div className="d-flex align-items-center gap-2">
                <Button size="sm" variant="primary" onClick={() => applyJob(job)} disabled={applying === job.id}>
                  {applying === job.id ? <Spinner size="sm" animation="border" /> : 'Apply'}
                </Button>
              </div>
            </div>
          );
        })}
        {recent.length > 0 && (
          <div className="mt-3">
            <div className="fw-semibold mb-2">Recent jobs</div>
            {recent.map((job) => {
              const completed = toDateSafe(job.completedAt);
              return (
                <div key={job.id} className="d-flex align-items-center justify-content-between border rounded p-2 mb-1">
                  <div>
                    <div className="fw-semibold">{job.status}</div>
                    <div className="text-muted" style={{ fontSize: 12 }}>
                      Applied: {job.appliedBlocks || 0} · {completed ? completed.toLocaleString() : ''}
                    </div>
                  </div>
                  <Badge bg={job.status === 'error' ? 'danger' : job.status === 'approved' ? 'success' : 'secondary'}>
                    {job.status}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </Card.Body>
    </Card>
  );
};

export default ApprovalsPanel;

