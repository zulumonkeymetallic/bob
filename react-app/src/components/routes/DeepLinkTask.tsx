import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc, serverTimestamp, collection, query, where, limit, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { useSidebar } from '../../contexts/SidebarContext';
import TaskListView from '../TaskListView';

const DeepLinkTask: React.FC = () => {
  const { id: refOrId } = useParams();
  const { showSidebar, setUpdateHandler } = useSidebar();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Provide a default update handler for sidebar edits
    setUpdateHandler(async (item, type, updates) => {
      const col = type === 'story' ? 'stories' : type === 'goal' ? 'goals' : 'tasks';
      await updateDoc(doc(db, col, (item as any).id), { ...updates, updatedAt: serverTimestamp() });
    });
  }, [setUpdateHandler]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!refOrId) return;
      // Try by human-readable ref first
      const q = query(collection(db, 'tasks'), where('ref', '==', refOrId), limit(1));
      const qs = await getDocs(q);
      let opened = false;
      if (!qs.empty) {
        const d = qs.docs[0];
        const item = { id: d.id, ...(d.data() || {}) } as any;
        showSidebar(item, 'task');
        opened = true;
      }
      if (!opened) {
        const snap = await getDoc(doc(db, 'tasks', refOrId));
        if (cancelled) return;
        if (snap.exists()) {
          const item = { id: snap.id, ...(snap.data() || {}) } as any;
          showSidebar(item, 'task');
        }
      }
      setLoaded(true);
    };
    run();
    return () => { cancelled = true; };
  }, [refOrId, showSidebar]);

  // Render the main list view beneath the sidebar for full context
  return <TaskListView />;
};

export default DeepLinkTask;
