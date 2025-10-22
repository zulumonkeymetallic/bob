import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc, serverTimestamp, collection, query, where, limit, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import TaskListView from '../TaskListView';
import EntityDetailModal from '../EntityDetailModal';
import { useNavigate } from 'react-router-dom';

const DeepLinkTask: React.FC = () => {
  const { id: refOrId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const initialTab = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const tab = (params.get('tab') || '').toLowerCase();
    return tab === 'activity' ? 'activity' : 'details';
  }, [location.search]);
  const [item, setItem] = useState<any | null>(null);
  const [open, setOpen] = useState(true);
  const [loaded, setLoaded] = useState(false);

  // updates handled inside modal

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!refOrId) return;
      // Try by human-readable ref first; fall back to common alt field names
      const q = query(collection(db, 'tasks'), where('ref', '==', refOrId), limit(1));
      let qs = await getDocs(q);
      let opened = false;
      if (!qs.empty) {
        const d = qs.docs[0];
        const it = { id: d.id, ...(d.data() || {}) } as any;
        setItem(it);
        opened = true;
      }
      if (!opened) {
        const q2 = query(collection(db, 'tasks'), where('referenceNumber', '==', refOrId), limit(1));
        qs = await getDocs(q2);
        if (!qs.empty) {
          const d = qs.docs[0];
          const it = { id: d.id, ...(d.data() || {}) } as any;
          setItem(it);
          opened = true;
        }
      }
      if (!opened) {
        const snap = await getDoc(doc(db, 'tasks', refOrId));
        if (cancelled) return;
        if (snap.exists()) {
          const it = { id: snap.id, ...(snap.data() || {}) } as any;
          setItem(it);
        }
      }
      setLoaded(true);
    };
    run();
    return () => { cancelled = true; };
  }, [refOrId]);

  // Render the main list view beneath the sidebar for full context
  return (
    <>
      <TaskListView />
      <EntityDetailModal
        show={open}
        onHide={() => { setOpen(false); navigate('/tasks', { replace: true }); }}
        type="task"
        item={item}
        initialTab={initialTab as any}
      />
    </>
  );
};

export default DeepLinkTask;
