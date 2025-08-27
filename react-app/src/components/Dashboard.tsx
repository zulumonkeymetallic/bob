import React, { useState, useEffect } from 'react';
import { db, auth, functions } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import '../styles/Dashboard.css';
import { Pie, Bar } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement } from 'chart.js';
import Calendar from './Calendar';
import UpcomingEvents from './UpcomingEvents';
import { User } from 'firebase/auth';
import { Task } from '../types';
import AddGoalModal from './AddGoalModal';
import AddStoryModal from './AddStoryModal';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

const Dashboard = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [showAddGoalModal, setShowAddGoalModal] = useState(false);
  const [showAddStoryModal, setShowAddStoryModal] = useState(false);

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
      // NOTE: task.goalArea is no longer directly used after story implementation
      // This chart might need to be updated to reflect stories/goals
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
    <div className="dashboard">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>Dashboard</h2>
        <div>
          <button className="btn btn-success me-2" onClick={() => setShowAddGoalModal(true)}>
            <i className="bi bi-plus-lg"></i> Add Goal
          </button>
          <button className="btn btn-info" onClick={() => setShowAddStoryModal(true)}>
            <i className="bi bi-plus-lg"></i> Add Story
          </button>
        </div>
      </div>
      <div className="row">
        <div className="col-md-8">
          <div className="card mb-4">
            <div className="card-body">
              <h5 className="card-title">Calendar</h5>
              <Calendar />
            </div>
          </div>
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
        </div>
        <div className="col-md-4">
          <div className="card">
            <div className="card-body">
              <h5 className="card-title">Upcoming Events</h5>
              <UpcomingEvents />
            </div>
          </div>
          <div className="card mt-4">
            <div className="card-body">
              <h5 className="card-title">Task Statistics</h5>
              <div className="task-stats">
                <div className="stat-item">
                  <span className="stat-label">Total Tasks</span>
                  <span className="stat-value">{tasks.length}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">In Progress</span>
                  <span className="stat-value">
                    {tasks.filter(t => t.status === 'In Progress').length}
                  </span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Completed</span>
                  <span className="stat-value">
                    {tasks.filter(t => t.status === 'Done').length}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {showAddGoalModal && <AddGoalModal onClose={() => setShowAddGoalModal(false)} />}
      {showAddStoryModal && <AddStoryModal onClose={() => setShowAddStoryModal(false)} />}
    </div>
  );
};

export default Dashboard;