import React, { useEffect, useState } from 'react';
import { Modal, Spinner } from 'react-bootstrap';
import { useParams } from 'react-router-dom';
import StoriesManagement from '../StoriesManagement';
import EditStoryModal from '../EditStoryModal';
import { useNavigate } from 'react-router-dom';
import { resolveEntityByRef } from '../../utils/entityLookup';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Goal } from '../../types';

const DeepLinkStory: React.FC = () => {
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

  // updates handled inside modal

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
      const entity = await resolveEntityByRef<any>('stories', refOrId);
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
    navigate('/stories', { replace: true });
  };

  return (
    <>
      <StoriesManagement />
      <EditStoryModal
        show={open && !!item}
        onHide={handleClose}
        story={item}
        goals={goals}
      />
      <Modal show={open && loading} backdrop="static" keyboard={false} centered>
        <Modal.Body className="text-center">
          <Spinner animation="border" role="status" className="mb-2" />
          <div>Loading story…</div>
        </Modal.Body>
      </Modal>
      <Modal show={open && !loading && loaded && notFound} onHide={handleClose} centered>
        <Modal.Header closeButton>
          <Modal.Title>Story Not Found</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          We couldn&apos;t find a story matching reference <code>{refOrId}</code>. It may have been removed or the reference
          changed. Return to Stories to continue.
        </Modal.Body>
      </Modal>
    </>
  );
};

export default DeepLinkStory;
