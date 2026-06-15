import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { Goal, Story } from '../../../types';
import { TravelEntry } from '../TravelMapTypes';

export interface TravelFirestoreData {
  entries: TravelEntry[];
  goals: Goal[];
  stories: Story[];
  loading: boolean;
}

export function useTravelFirestore(uid: string | undefined): TravelFirestoreData {
  const [entries, setEntries] = useState<TravelEntry[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, 'travel'), where('ownerUid', '==', uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() } as TravelEntry)));
        setLoading(false);
      },
      (err) => {
        console.error('[travel] entries snapshot error', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, 'goals'), where('ownerUid', '==', uid));
    const unsub = onSnapshot(q, (snap) => {
      setGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as Goal)));
    });
    return () => unsub();
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, 'stories'), where('ownerUid', '==', uid));
    const unsub = onSnapshot(q, (snap) => {
      setStories(snap.docs.map(d => ({ id: d.id, ...d.data() } as Story)));
    });
    return () => unsub();
  }, [uid]);

  return { entries, goals, stories, loading };
}
