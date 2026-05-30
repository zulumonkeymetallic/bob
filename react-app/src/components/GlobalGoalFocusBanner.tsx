/**
 * Self-contained wrapper around RotatingGoalFocusBanner for use in SidebarLayout.
 * Fetches banner-eligible goals from Firestore so the layout component stays prop-free.
 * Includes persona filter to satisfy Firestore security rules.
 */
import React, { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Goal } from '../types';
import RotatingGoalFocusBanner from './RotatingGoalFocusBanner';

const GlobalGoalFocusBanner: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const navigate = useNavigate();
  const [goals, setGoals] = useState<Goal[]>([]);

  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) {
      setGoals([]);
      return;
    }

    const q = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setGoals(snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Goal)));
      },
      (error) => {
        if (String(error?.code || '').includes('permission-denied')) {
          console.warn('GlobalGoalFocusBanner: goals not accessible', error.code);
        } else {
          console.error('GlobalGoalFocusBanner: snapshot error', error);
        }
      }
    );

    return () => unsubscribe();
  }, [currentUser?.uid, currentPersona]);

  if (goals.length === 0) return null;

  return (
    <RotatingGoalFocusBanner
      goals={goals}
      onOpenGoal={() => navigate('/goals')}
    />
  );
};

export default GlobalGoalFocusBanner;
