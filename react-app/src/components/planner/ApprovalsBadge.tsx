import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Button } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

const ApprovalsBadge: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    if (!currentUser?.uid) { setCount(0); return; }
    const q = query(
      collection(db, 'planning_jobs'),
      where('ownerUid', '==', currentUser.uid),
      where('status', '==', 'proposed'),
    );
    const unsub = onSnapshot(q, (snap) => setCount(snap.size), () => setCount(0));
    return () => unsub();
  }, [currentUser?.uid]);

  if (!currentUser?.uid || count <= 0) return null;

  return (
    <Button
      size="sm"
      variant="outline-primary"
      onClick={() => navigate('/planning/approvals')}
      title="Pending plan approvals"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
    >
      Approvals <Badge bg="primary">{count}</Badge>
    </Button>
  );
};

export default ApprovalsBadge;
