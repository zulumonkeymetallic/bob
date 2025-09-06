import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTestMode } from '../contexts/TestModeContext';
import { collection, addDoc, onSnapshot, query, where, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Goal, Story, Task, Sprint } from '../types';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useTheme } from '../contexts/ModernThemeContext';

interface TestData {
  goals: Goal[];
  stories: Story[];
  tasks: Task[];
  sprints: Sprint[];
}

interface TestResults {
  auth: boolean;
  dataLoad: boolean;
  goalCreate: boolean;
  storyCreate: boolean;
  taskCreate: boolean;
  sprintCreate: boolean;
  dragDrop: boolean;
  sidebar: boolean;
  activityStream: boolean;
}

const ComprehensiveTest: React.FC = () => {
  const { theme } = useTheme();
  const { currentUser } = useAuth();
  const { isTestMode, toggleTestMode } = useTestMode();
  const [testData, setTestData] = useState<TestData>({
    goals: [],
    stories: [],
    tasks: [],
    sprints: []
  });
  const [testResults, setTestResults] = useState<TestResults>({
    auth: false,
    dataLoad: false,
    goalCreate: false,
    storyCreate: false,
    taskCreate: false,
    sprintCreate: false,
    dragDrop: false,
    sidebar: false,
    activityStream: false
  });
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `${timestamp}: ${message}`]);
    console.log(`TEST: ${message}`);
  };

  // Test authentication
  useEffect(() => {
    if (currentUser) {
      setTestResults(prev => ({ ...prev, auth: true }));
      addLog(`✅ Authentication: Logged in as ${currentUser.email}`);
    } else {
      addLog(`❌ Authentication: Not logged in`);
    }
  }, [currentUser]);

  // Test data loading
  useEffect(() => {
    if (!currentUser) return;

    addLog('🔄 Testing data loading...');

    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid)
    );

    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid)
    );

    const tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid)
    );

    const sprintsQuery = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid)
    );

    const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
      const goalsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Goal[];
      setTestData(prev => ({ ...prev, goals: goalsData }));
      addLog(`📊 Goals loaded: ${goalsData.length} items`);
    });

    const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
      const storiesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Story[];
      setTestData(prev => ({ ...prev, stories: storiesData }));
      addLog(`📊 Stories loaded: ${storiesData.length} items`);
    });

    const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
      const tasksData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Task[];
      setTestData(prev => ({ ...prev, tasks: tasksData }));
      addLog(`📊 Tasks loaded: ${tasksData.length} items`);
      setTestResults(prev => ({ ...prev, dataLoad: true }));
    });

    const unsubscribeSprints = onSnapshot(sprintsQuery, (snapshot) => {
      const sprintsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Sprint[];
      setTestData(prev => ({ ...prev, sprints: sprintsData }));
      addLog(`📊 Sprints loaded: ${sprintsData.length} items`);
    });

    return () => {
      unsubscribeGoals();
      unsubscribeStories();
      unsubscribeTasks();
      unsubscribeSprints();
    };
  }, [currentUser]);

  const runFullTest = async () => {
    if (!currentUser) {
      addLog('❌ Cannot run test - not authenticated');
      return;
    }

    setLoading(true);
    addLog('🚀 Starting comprehensive test suite...');

    try {
      // Test goal creation
      addLog('🔄 Testing goal creation...');
      const goalData = {
        title: `Test Goal ${Date.now()}`,
        description: 'Test goal created by comprehensive test',
        targetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'active' as const,
        category: 'Health' as const,
        ownerUid: currentUser.uid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const goalDoc = await addDoc(collection(db, 'goals'), goalData);
      addLog(`✅ Goal created: ${goalDoc.id}`);
      setTestResults(prev => ({ ...prev, goalCreate: true }));

      // Test story creation
      addLog('🔄 Testing story creation...');
      const storyData = {
        title: `Test Story ${Date.now()}`,
        description: 'Test story created by comprehensive test',
        status: 'backlog' as const,
        priority: 'medium' as const,
        goalId: goalDoc.id,
        ownerUid: currentUser.uid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const storyDoc = await addDoc(collection(db, 'stories'), storyData);
      addLog(`✅ Story created: ${storyDoc.id}`);
      setTestResults(prev => ({ ...prev, storyCreate: true }));

      // Test sprint creation
      addLog('🔄 Testing sprint creation...');
      const sprintData = {
        name: `Test Sprint ${Date.now()}`,
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'active' as const,
        ownerUid: currentUser.uid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const sprintDoc = await addDoc(collection(db, 'sprints'), sprintData);
      addLog(`✅ Sprint created: ${sprintDoc.id}`);
      setTestResults(prev => ({ ...prev, sprintCreate: true }));

      // Test task creation
      addLog('🔄 Testing task creation...');
      const taskData = {
        title: `Test Task ${Date.now()}`,
        description: 'Test task created by comprehensive test',
        status: 'todo' as const,
        priority: 'medium' as const,
        parentId: storyDoc.id,
        parentType: 'story' as const,
        sprintId: sprintDoc.id,
        ownerUid: currentUser.uid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const taskDoc = await addDoc(collection(db, 'tasks'), taskData);
      addLog(`✅ Task created: ${taskDoc.id}`);
      setTestResults(prev => ({ ...prev, taskCreate: true }));

      // Test drag and drop (status update)
      addLog('🔄 Testing drag and drop (status update)...');
      await updateDoc(doc(db, 'tasks', taskDoc.id), {
        status: 'in-progress',
        updatedAt: new Date().toISOString()
      });
      addLog(`✅ Task status updated via drag-drop simulation`);
      setTestResults(prev => ({ ...prev, dragDrop: true }));

      addLog('🎉 All tests completed successfully!');

    } catch (error) {
      addLog(`❌ Test failed: ${(error as Error).message}`);
      console.error('Test error:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearTestData = async () => {
    if (!currentUser) return;

    addLog('🧹 Cleaning up test data...');
    
    try {
      // Delete test items (identified by "Test" in title/name)
      for (const goal of testData.goals) {
        if (goal.title.includes('Test Goal')) {
          await deleteDoc(doc(db, 'goals', goal.id));
          addLog(`🗑️ Deleted test goal: ${goal.id}`);
        }
      }

      for (const story of testData.stories) {
        if (story.title.includes('Test Story')) {
          await deleteDoc(doc(db, 'stories', story.id));
          addLog(`🗑️ Deleted test story: ${story.id}`);
        }
      }

      for (const task of testData.tasks) {
        if (task.title.includes('Test Task')) {
          await deleteDoc(doc(db, 'tasks', task.id));
          addLog(`🗑️ Deleted test task: ${task.id}`);
        }
      }

      for (const sprint of testData.sprints) {
        if (sprint.name.includes('Test Sprint')) {
          await deleteDoc(doc(db, 'sprints', sprint.id));
          addLog(`🗑️ Deleted test sprint: ${sprint.id}`);
        }
      }

      addLog('✅ Test data cleanup completed');
    } catch (error) {
      addLog(`❌ Cleanup failed: ${(error as Error).message}`);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;

    if (over && active.id !== over.id) {
      addLog(`🔄 Drag and drop: ${active.id} -> ${over.id}`);
      setTestResults(prev => ({ ...prev, dragDrop: true }));
    }
  };

  return (
    <div className="container mt-4">
      <div className="row">
        <div className="col-12">
          <div className="card">
            <div className="card-header d-flex justify-content-between align-items-center">
              <h3 className="mb-0">
                🧪 Comprehensive Test Suite
                {isTestMode && <span className="badge bg-warning text-dark ms-2">TEST MODE</span>}
              </h3>
              <div>
                <button 
                  className="btn btn-secondary me-2" 
                  onClick={toggleTestMode}
                >
                  {isTestMode ? 'Disable' : 'Enable'} Test Mode
                </button>
                <button 
                  className="btn btn-primary me-2" 
                  onClick={runFullTest}
                  disabled={loading || !currentUser}
                >
                  {loading ? '🔄 Running...' : '🚀 Run Full Test'}
                </button>
                <button 
                  className="btn btn-danger" 
                  onClick={clearTestData}
                  disabled={!currentUser}
                >
                  🧹 Clear Test Data
                </button>
              </div>
            </div>
            <div className="card-body">
              {/* Test Results */}
              <div className="row mb-4">
                <div className="col-md-6">
                  <h5>Test Results</h5>
                  <div className="list-group">
                    <div className={`list-group-item d-flex justify-content-between align-items-center ${testResults.auth ? 'list-group-item-success' : 'list-group-item-danger'}`}>
                      Authentication
                      <span className="badge bg-primary rounded-pill">{testResults.auth ? '✅' : '❌'}</span>
                    </div>
                    <div className={`list-group-item d-flex justify-content-between align-items-center ${testResults.dataLoad ? 'list-group-item-success' : 'list-group-item-light'}`}>
                      Data Loading
                      <span className="badge bg-primary rounded-pill">{testResults.dataLoad ? '✅' : '⏳'}</span>
                    </div>
                    <div className={`list-group-item d-flex justify-content-between align-items-center ${testResults.goalCreate ? 'list-group-item-success' : 'list-group-item-light'}`}>
                      Goal Creation
                      <span className="badge bg-primary rounded-pill">{testResults.goalCreate ? '✅' : '⏳'}</span>
                    </div>
                    <div className={`list-group-item d-flex justify-content-between align-items-center ${testResults.storyCreate ? 'list-group-item-success' : 'list-group-item-light'}`}>
                      Story Creation
                      <span className="badge bg-primary rounded-pill">{testResults.storyCreate ? '✅' : '⏳'}</span>
                    </div>
                    <div className={`list-group-item d-flex justify-content-between align-items-center ${testResults.taskCreate ? 'list-group-item-success' : 'list-group-item-light'}`}>
                      Task Creation
                      <span className="badge bg-primary rounded-pill">{testResults.taskCreate ? '✅' : '⏳'}</span>
                    </div>
                    <div className={`list-group-item d-flex justify-content-between align-items-center ${testResults.sprintCreate ? 'list-group-item-success' : 'list-group-item-light'}`}>
                      Sprint Creation
                      <span className="badge bg-primary rounded-pill">{testResults.sprintCreate ? '✅' : '⏳'}</span>
                    </div>
                    <div className={`list-group-item d-flex justify-content-between align-items-center ${testResults.dragDrop ? 'list-group-item-success' : 'list-group-item-light'}`}>
                      Drag & Drop
                      <span className="badge bg-primary rounded-pill">{testResults.dragDrop ? '✅' : '⏳'}</span>
                    </div>
                  </div>
                </div>
                
                {/* Data Summary */}
                <div className="col-md-6">
                  <h5>Current Data</h5>
                  <div className="list-group">
                    <div className="list-group-item d-flex justify-content-between align-items-center">
                      Goals
                      <span className="badge bg-success rounded-pill">{testData.goals.length}</span>
                    </div>
                    <div className="list-group-item d-flex justify-content-between align-items-center">
                      Stories
                      <span className="badge bg-info rounded-pill">{testData.stories.length}</span>
                    </div>
                    <div className="list-group-item d-flex justify-content-between align-items-center">
                      Tasks
                      <span className="badge bg-warning rounded-pill">{testData.tasks.length}</span>
                    </div>
                    <div className="list-group-item d-flex justify-content-between align-items-center">
                      Sprints
                      <span className="badge bg-danger rounded-pill">{testData.sprints.length}</span>
                    </div>
                  </div>
                  
                  {currentUser && (
                    <div className="mt-3">
                      <small className="text-muted">
                        Logged in as: {currentUser.email}
                      </small>
                    </div>
                  )}
                </div>
              </div>

              {/* Drag and Drop Test Area */}
              <div className="row mb-4">
                <div className="col-12">
                  <h5>Drag & Drop Test Area</h5>
                  <DndContext
                    sensors={sensors}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                  >
                    <div className="row">
                      <div className="col-md-4">
                        <div className="card">
                          <div className="card-header">
                            <h6 className="mb-0">To Do</h6>
                          </div>
                          <div className="card-body">
                            <SortableContext items={testData.tasks.filter(t => t.status === 0).map(t => t.id)} strategy={verticalListSortingStrategy}>
                              {testData.tasks.filter(t => t.status === 0).map(task => (
                                <div key={task.id} className="card mb-2">
                                  <div className="card-body p-2">
                                    <small>{task.title}</small>
                                  </div>
                                </div>
                              ))}
                            </SortableContext>
                          </div>
                        </div>
                      </div>
                      <div className="col-md-4">
                        <div className="card">
                          <div className="card-header">
                            <h6 className="mb-0">In Progress</h6>
                          </div>
                          <div className="card-body">
                            <SortableContext items={testData.tasks.filter(t => t.status === 1).map(t => t.id)} strategy={verticalListSortingStrategy}>
                              {testData.tasks.filter(t => t.status === 1).map(task => (
                                <div key={task.id} className="card mb-2">
                                  <div className="card-body p-2">
                                    <small>{task.title}</small>
                                  </div>
                                </div>
                              ))}
                            </SortableContext>
                          </div>
                        </div>
                      </div>
                      <div className="col-md-4">
                        <div className="card">
                          <div className="card-header">
                            <h6 className="mb-0">Done</h6>
                          </div>
                          <div className="card-body">
                            <SortableContext items={testData.tasks.filter(t => t.status === 2).map(t => t.id)} strategy={verticalListSortingStrategy}>
                              {testData.tasks.filter(t => t.status === 2).map(task => (
                                <div key={task.id} className="card mb-2">
                                  <div className="card-body p-2">
                                    <small>{task.title}</small>
                                  </div>
                                </div>
                              ))}
                            </SortableContext>
                          </div>
                        </div>
                      </div>
                    </div>
                  </DndContext>
                </div>
              </div>

              {/* Logs */}
              <div className="row">
                <div className="col-12">
                  <h5>Test Logs</h5>
                  <div className="card">
                    <div className="card-body" style={{ height: '300px', overflowY: 'auto' }}>
                      {logs.length === 0 ? (
                        <p className="text-muted">No logs yet. Run a test to see activity.</p>
                      ) : (
                        logs.map((log, index) => (
                          <div key={index} className="mb-1">
                            <small className="font-monospace">{log}</small>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ComprehensiveTest;
