import React, { useEffect, useState } from 'react';
import { Modal, Spinner } from 'react-bootstrap';
import { useParams } from 'react-router-dom';
import GoalsManagement from '../GoalsManagement';
import EntityDetailModal from '../EntityDetailModal';
import { useNavigate } from 'react-router-dom';
import { resolveEntityByRef } from '../../utils/entityLookup';

const DeepLinkGoal: React.FC = () => {
  const { id: refOrId } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<any | null>(null);
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);

  // no-op: modal handles updates internally

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
      <EntityDetailModal
        show={open && !!item}
        onHide={handleClose}
        type="goal"
        item={item}
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
