import React, { useEffect, useState } from 'react';
import { Modal, Spinner } from 'react-bootstrap';
import { useParams } from 'react-router-dom';
import TaskListView from '../TaskListView';
import EditTaskModal from '../EditTaskModal';
import { useNavigate } from 'react-router-dom';
import { resolveEntityByRef } from '../../utils/entityLookup';

const DeepLinkTask: React.FC = () => {
  const { id: refOrId } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<any | null>(null);
  const [open, setOpen] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(false);

  // updates handled inside modal

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!refOrId) return;
      setLoading(true);
      setNotFound(false);
      setItem(null);
      // Try by human-readable ref first; fall back to common alt field names
      const entity = await resolveEntityByRef<any>('tasks', refOrId);
      if (cancelled) return;
      if (entity) {
        setItem(entity);
      } else {
        setNotFound(true);
      }
      setLoaded(true);
      setLoading(false);
    };
    run();
    return () => { cancelled = true; };
  }, [refOrId]);

  const handleClose = () => {
    setOpen(false);
    navigate('/tasks', { replace: true });
  };

  // Render the main list view beneath the sidebar for full context
  return (
    <>
      <TaskListView />
      <EditTaskModal
        show={open && !!item}
        task={item}
        onHide={handleClose}
      />
      <Modal show={open && loading} backdrop="static" keyboard={false} centered>
        <Modal.Body className="text-center">
          <Spinner animation="border" role="status" className="mb-2" />
          <div>Loading task…</div>
        </Modal.Body>
      </Modal>
      <Modal show={open && !loading && loaded && notFound} onHide={handleClose} centered>
        <Modal.Header closeButton>
          <Modal.Title>Task Not Found</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          We couldn&apos;t find a task matching reference <code>{refOrId}</code>. It may have been deleted or the
          reference has changed. Return to the task list to continue.
        </Modal.Body>
      </Modal>
    </>
  );
};

export default DeepLinkTask;
