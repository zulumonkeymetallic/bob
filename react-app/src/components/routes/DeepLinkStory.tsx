import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc, serverTimestamp, collection, query, where, limit, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import StoriesManagement from '../StoriesManagement';
import EntityDetailModal from '../EntityDetailModal';
import { useNavigate } from 'react-router-dom';

const DeepLinkStory: React.FC = () => {
  const { id: refOrId } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = React.useState<any | null>(null);
  const [open, setOpen] = React.useState(true);

  // updates handled inside modal

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!refOrId) return;
      let opened = false;
      const q = query(collection(db, 'stories'), where('ref', '==', refOrId), limit(1));
      const qs = await getDocs(q);
      if (!qs.empty) {
        const d = qs.docs[0];
        const it = { id: d.id, ...(d.data() || {}) } as any;
        setItem(it);
        opened = true;
      }
      if (!opened) {
        const snap = await getDoc(doc(db, 'stories', refOrId));
        if (cancelled) return;
        if (snap.exists()) {
          const it = { id: snap.id, ...(snap.data() || {}) } as any;
          setItem(it);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [refOrId]);

  return (
    <>
      <StoriesManagement />
      <EntityDetailModal
        show={open}
        onHide={() => { setOpen(false); navigate('/stories', { replace: true }); }}
        type="story"
        item={item}
      />
    </>
  );
};

export default DeepLinkStory;
