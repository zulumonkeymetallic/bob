import React, { useEffect, useState } from 'react';
import { Modal, Spinner } from 'react-bootstrap';
import { useParams } from 'react-router-dom';
import GoalsManagement from '../GoalsManagement';
import EditGoalModal from '../EditGoalModal';
import { useNavigate } from 'react-router-dom';
import { resolveEntityByRef } from '../../utils/entityLookup';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Goal } from '../../types';

const DeepLinkGoal: React.FC = () => {
  const { id: refOrId } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [item, setItem] = useState<any | null>(null);
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [goals, setGoals] = useState<Goal[]>([]);

  // no-op: modal handles updates internally

  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) {
      setGoals([]);
      return;
    }
    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('createdAt', 'desc'),
      limit(1000)
    );
    const unsub = onSnapshot(
      goalsQuery,
      (snap) => setGoals(snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) }) as Goal)),
      (err) => console.warn('[deep-link] goals snapshot error', err?.message || err)
    );
    return () => unsub();
  }, [currentUser?.uid, currentPersona]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!refOrId) return;
      setLoading(true);
      setLoaded(false);
      setNotFound(false);
      setItem(null);
      const entity = await resolveEntityByRef<any>('goals', refOrId);
      if (cancelled) return;
      if (entity) {
        setItem(entity);
      } else {
        setNotFound(true);
      }
      setLoaded(true);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [refOrId]);

  const handleClose = () => {
    setOpen(false);
    navigate('/goals', { replace: true });
  };

  return (
    <>
      <GoalsManagement />
      <EditGoalModal
        show={open && !!item}
        onClose={handleClose}
        goal={item}
        currentUserId={currentUser?.uid || ''}
        allGoals={goals}
      />
      <Modal show={open && loading} backdrop="static" keyboard={false} centered>
        <Modal.Body className="text-center">
          <Spinner animation="border" role="status" className="mb-2" />
          <div>Loading goal…</div>
        </Modal.Body>
      </Modal>
      <Modal show={open && !loading && loaded && notFound} onHide={handleClose} centered>
        <Modal.Header closeButton>
          <Modal.Title>Goal Not Found</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          We couldn&apos;t find a goal matching reference <code>{refOrId}</code>. It may have been removed or the reference
          changed. Return to Goals to continue.
        </Modal.Body>
      </Modal>
    </>
  );
};

export default DeepLinkGoal;
