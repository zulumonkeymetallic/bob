import React, { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { Pie, Bar } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement } from 'chart.js';
import UpcomingEvents from './UpcomingEvents';
import { User } from 'firebase/auth';
import { Task } from '../types';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

const Dashboard = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => {
      if (user) {
        setUser(user);
        const q = query(collection(db, 'tasks'), where('ownerUid', '==', user.uid));
        const unsubscribeSnapshot = onSnapshot(q, snapshot => {
          const tasksData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
          setTasks(tasksData);
        });
        return () => unsubscribeSnapshot();
      } else {
        setUser(null);
        setTasks([]);
      }
    });
    return () => unsubscribe();
  }, []);

  const getTasksByStatusData = () => {
    const statusCounts = tasks.reduce((acc: { [key: string]: number }, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {});

    return {
      labels: Object.keys(statusCounts),
      datasets: [
        {
          label: 'Tasks by Status',
          data: Object.values(statusCounts),
          backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56'],
        },
      ],
    };
  };

  const getTasksByGoalAreaData = () => {
    const goalAreaCounts = tasks.reduce((acc: { [key: string]: number }, task) => {
      if (task.goalArea) {
        acc[task.goalArea] = (acc[task.goalArea] || 0) + 1;
      }
      return acc;
    }, {});

    return {
      labels: Object.keys(goalAreaCounts),
      datasets: [
        {
          label: 'Tasks by Goal Area',
          data: Object.values(goalAreaCounts),
          backgroundColor: ['#4A86E8', '#674EA7', '#93C47D', '#E06666', '#F6B26B'],
        },
      ],
    };
  };

  return (
    <div>
      <h2>Dashboard</h2>
      <div className="row">
        <div className="col-md-6">
          <div className="card">
            <div className="card-body">
              <h5 className="card-title">Tasks by Status</h5>
              <Pie data={getTasksByStatusData()} />
            </div>
          </div>
        </div>
        <div className="col-md-6">
          <div className="card">
            <div className="card-body">
              <h5 className="card-title">Tasks by Goal Area</h5>
              <Bar data={getTasksByGoalAreaData()} />
            </div>
          </div>
        </div>
      </div>
      <div className="row mt-3">
        <div className="col-md-12">
          <UpcomingEvents />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
