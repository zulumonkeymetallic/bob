import React, { useEffect, useState } from 'react';
import { Card } from 'react-bootstrap';
import { collection, onSnapshot, query, updateDoc, deleteDoc, doc, where, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Task, Story, Goal, Sprint } from '../types';
import ModernTaskTable from './ModernTaskTable';

interface DashboardTasksModernWrapperProps {
  title?: string;
  maxTasks?: number;
}

const DashboardTasksModernWrapper: React.FC<DashboardTasksModernWrapperProps> = ({ title = 'Tasks', maxTasks }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);

  useEffect(() => {
    if (!currentUser) return;

    const tq = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );
    const sq = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );
    const gq = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );
    const spq = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid)
    );

    const u1 = onSnapshot(tq, (snap) => {
      let data = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Task[];
      if (maxTasks) data = data.slice(0, maxTasks);
      setTasks(data);
    });
    const u2 = onSnapshot(sq, (snap) => setStories(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Story[]));
    const u3 = onSnapshot(gq, (snap) => setGoals(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Goal[]));
    const u4 = onSnapshot(spq, (snap) => setSprints(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Sprint[]));

    return () => { u1(); u2(); u3(); u4(); };
  }, [currentUser, currentPersona, maxTasks]);

  const handleTaskUpdate = async (taskId: string, updates: Partial<Task>) => {
    await updateDoc(doc(db, 'tasks', taskId), { ...updates, updatedAt: serverTimestamp() });
  };
  const handleTaskDelete = async (taskId: string) => {
    await deleteDoc(doc(db, 'tasks', taskId));
  };
  const handleTaskPriorityChange = async (taskId: string, newPriority: number) => {
    await updateDoc(doc(db, 'tasks', taskId), { priority: newPriority, updatedAt: serverTimestamp() });
  };

  return (
    <Card style={{ border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
      <Card.Header style={{ backgroundColor: 'var(--card)', borderBottom: '1px solid var(--line)' }}>
        <h5 className="mb-0">{title}</h5>
      </Card.Header>
      <Card.Body style={{ padding: 0 }}>
        <ModernTaskTable
          tasks={tasks}
          stories={stories}
          goals={goals}
          sprints={sprints}
          onTaskUpdate={handleTaskUpdate}
          onTaskDelete={handleTaskDelete}
          onTaskPriorityChange={handleTaskPriorityChange}
        />
      </Card.Body>
    </Card>
  );
};

export default DashboardTasksModernWrapper;
