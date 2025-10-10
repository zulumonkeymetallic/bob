import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc, serverTimestamp, collection, query, where, limit, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { useSidebar } from '../../contexts/SidebarContext';
import GoalsManagement from '../GoalsManagement';

const DeepLinkGoal: React.FC = () => {
  const { id: refOrId } = useParams();
  const { showSidebar, setUpdateHandler } = useSidebar();

  useEffect(() => {
    setUpdateHandler(async (item, type, updates) => {
      const col = type === 'story' ? 'stories' : type === 'goal' ? 'goals' : 'tasks';
      await updateDoc(doc(db, col, (item as any).id), { ...updates, updatedAt: serverTimestamp() });
    });
  }, [setUpdateHandler]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!refOrId) return;
      let opened = false;
      const q = query(collection(db, 'goals'), where('ref', '==', refOrId), limit(1));
      const qs = await getDocs(q);
      if (!qs.empty) {
        const d = qs.docs[0];
        const item = { id: d.id, ...(d.data() || {}) } as any;
        showSidebar(item, 'goal');
        opened = true;
      }
      if (!opened) {
        const snap = await getDoc(doc(db, 'goals', refOrId));
        if (cancelled) return;
        if (snap.exists()) {
          const item = { id: snap.id, ...(snap.data() || {}) } as any;
          showSidebar(item, 'goal');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [refOrId, showSidebar]);

  return <GoalsManagement />;
};

export default DeepLinkGoal;
