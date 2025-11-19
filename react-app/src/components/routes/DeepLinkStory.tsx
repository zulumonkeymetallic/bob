import React, { useEffect, useState } from 'react';
import { Modal, Spinner } from 'react-bootstrap';
import { useParams } from 'react-router-dom';
import StoriesManagement from '../StoriesManagement';
import EntityDetailModal from '../EntityDetailModal';
import { useNavigate } from 'react-router-dom';
import { resolveEntityByRef } from '../../utils/entityLookup';

const DeepLinkStory: React.FC = () => {
  const { id: refOrId } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<any | null>(null);
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);

  // updates handled inside modal

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
      <EntityDetailModal
        show={open && !!item}
        onHide={handleClose}
        type="story"
        item={item}
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
