import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { Badge, Card, Table } from 'react-bootstrap';

type Job = {
  id: string;
  userId: string;
  status: string;
  startedAt?: any;
  completedAt?: any;
  validator?: { score?: number } | null;
  appliedBlocks?: number;
  proposedBlocks?: any[];
  approvalToken?: string | null;
};

const ApprovalsCenter: React.FC = () => {
  const { currentUser } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    if (!currentUser?.uid) { setJobs([]); return; }
    const q = query(
      collection(db, 'planning_jobs'),
      where('userId', '==', currentUser.uid),
      orderBy('completedAt', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Job[];
      setJobs(rows);
    }, () => setJobs([]));
    return () => unsub();
  }, [currentUser?.uid]);

  const proposed = useMemo(() => jobs.filter(j => j.status === 'proposed'), [jobs]);
  const recent = useMemo(() => jobs.filter(j => j.status !== 'proposed').slice(0, 20), [jobs]);

  const statusBadge = (status: string) => {
    const s = String(status || '').toLowerCase();
    const variant = s === 'proposed' ? 'warning' : s === 'approved' || s === 'completed' ? 'success' : s === 'error' ? 'danger' : 'secondary';
    return <Badge bg={variant}>{status}</Badge>;
  };

  const previewUrl = (job: Job) => {
    const base = '/planning/approval';
    const uid = currentUser?.uid;
    const params = new URLSearchParams({ jobId: job.id, uid: uid || '' });
    if (job.status === 'proposed' && job.approvalToken) params.set('token', job.approvalToken);
    return `${base}?${params.toString()}`;
  };

  return (
    <div className="container py-3">
      <h1 className="h4 mb-3">Approvals Center</h1>

      <Card className="mb-3">
        <Card.Body>
          <div className="d-flex align-items-center justify-content-between mb-2">
            <h5 className="mb-0">Pending Approvals</h5>
            <Badge bg="warning" text="dark">{proposed.length}</Badge>
          </div>
          {proposed.length === 0 ? (
            <div className="text-muted">No pending approvals.</div>
          ) : (
            <Table hover responsive size="sm" className="align-middle mb-0">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Score</th>
                  <th>Blocks</th>
                  <th>Status</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {proposed.map((job) => (
                  <tr key={job.id}>
                    <td style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{job.id}</td>
                    <td>{typeof job.validator?.score === 'number' ? job.validator!.score.toFixed(2) : '—'}</td>
                    <td>{Array.isArray(job.proposedBlocks) ? job.proposedBlocks.length : '—'}</td>
                    <td>{statusBadge(job.status)}</td>
                    <td><a href={previewUrl(job)}>Review</a></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <h5 className="mb-2">Recent Runs</h5>
          {recent.length === 0 ? (
            <div className="text-muted">No history yet.</div>
          ) : (
            <Table hover responsive size="sm" className="align-middle mb-0">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Score</th>
                  <th>Applied</th>
                  <th>Status</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((job) => (
                  <tr key={job.id}>
                    <td style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{job.id}</td>
                    <td>{typeof job.validator?.score === 'number' ? job.validator!.score.toFixed(2) : '—'}</td>
                    <td>{typeof job.appliedBlocks === 'number' ? job.appliedBlocks : '—'}</td>
                    <td>{statusBadge(job.status)}</td>
                    <td><a href={previewUrl(job)}>Open</a></td>
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

export default ApprovalsCenter;

