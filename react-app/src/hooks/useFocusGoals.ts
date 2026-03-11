import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { FocusGoal } from '../types';

export const useFocusGoals = (userId: string | undefined) => {
  const [focusGoals, setFocusGoals] = useState<FocusGoal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setFocusGoals([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'focusGoals'),
      where('ownerUid', '==', userId)
    );

    const unsubscribe = onSnapshot(q, snapshot => {
      const focusGoalsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as FocusGoal[];

      // Calculate daysRemaining for each
      const withDaysRemaining = focusGoalsData.map(fg => {
        const endDate = new Date(fg.endDate);
        const daysRemaining = Math.ceil(
          (endDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
        );
        return { ...fg, daysRemaining };
      });

      setFocusGoals(withDaysRemaining);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [userId]);

  const deactivateFocusGoal = async (focusGoalId: string) => {
    try {
      const docRef = doc(db, 'focusGoals', focusGoalId);
      await updateDoc(docRef, {
        isActive: false,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Failed to deactivate focus goal:', error);
      throw error;
    }
  };

  const activeFocusGoals = focusGoals.filter(fg => fg.isActive);

  return {
    focusGoals,
    activeFocusGoals,
    loading,
    deactivateFocusGoal
  };
};
