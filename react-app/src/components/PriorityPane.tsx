import React, { useState, useEffect } from 'react';
import { Button, Badge, Spinner, Alert } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Task } from '../types';
import { isStatus, isTheme, isPriority, getStatusName, getThemeName, getPriorityName } from '../utils/statusHelpers';
import { useTheme } from '../contexts/ModernThemeContext';

interface PriorityPaneProps {
  tasks: Task[];
}

interface PrioritizedTask extends Task {
  priorityScore: number;
  reasonCodes: string[];
  rationale: string;
}

const PriorityPane: React.FC<PriorityPaneProps> = ({ tasks }) => {
  const { theme } = useTheme();
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [prioritizedTasks, setPrioritizedTasks] = useState<PrioritizedTask[]>([]);
  const [schedulingTask, setSchedulingTask] = useState<string | null>(null);
  const [scheduleResult, setScheduleResult] = useState<string | null>(null);

  useEffect(() => {
    // Calculate priority scores for tasks
    const calculatePriority = () => {
      const now = new Date();
      const today = new Date(now.toDateString());
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
      
      const scoredTasks = tasks
        .filter(task => !isStatus(task.status, 'done'))
        .map(task => {
          let score = 0;
          const reasonCodes: string[] = [];
          let rationale = '';

          // Due date scoring (40% weight)
          if (task.dueDate) {
            const dueDate = new Date(task.dueDate);
            const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
            
            if (daysUntilDue <= 0) {
              score += 40;
              reasonCodes.push('overdue');
              rationale = 'Overdue task';
            } else if (daysUntilDue === 1) {
              score += 35;
              reasonCodes.push('due_today');
              rationale = 'Due today';
            } else if (daysUntilDue === 2) {
              score += 25;
              reasonCodes.push('due_tomorrow');
              rationale = 'Due tomorrow';
            } else if (daysUntilDue <= 7) {
              score += 15;
              reasonCodes.push('due_soon');
              rationale = `Due in ${daysUntilDue} days`;
            }
          }

          // Priority scoring (30% weight)
          const priorityScores = { high: 30, med: 20, low: 10 };
          const priorityScore = priorityScores[getPriorityName(task.priority) as keyof typeof priorityScores] || 10;
          score += priorityScore;
          if (isPriority(task.priority, 'high')) {
            reasonCodes.push('high_priority');
            rationale = rationale ? `${rationale}, high priority` : 'High priority task';
          }

          // Effort/slot fit scoring (20% weight) - smaller tasks get higher scores for quick wins
          const effortScores = { S: 20, M: 15, L: 10 };
          const effortScore = effortScores[task.effort as keyof typeof effortScores] || 15;
          score += effortScore;
          if (task.effort === 'S') {
            reasonCodes.push('quick_win');
            rationale = rationale ? `${rationale}, quick win` : 'Quick 15-30 min task';
          }

          // Impact scoring (10% weight) - tasks linked to goals get higher scores
          if (task.hasGoal) {
            score += 10;
            reasonCodes.push('goal_linked');
            rationale = rationale ? `${rationale}, goal-linked` : 'Contributes to goal progress';
          }

          // In progress bonus
          if (isStatus(task.status, 'in_progress')) {
            score += 5;
            reasonCodes.push('in_progress');
            rationale = rationale ? `${rationale}, already started` : 'Task in progress';
          }

          return {
            ...task,
            priorityScore: score,
            reasonCodes,
            rationale: rationale || 'Routine task'
          };
        })
        .sort((a, b) => b.priorityScore - a.priorityScore)
        .slice(0, 5);

      setPrioritizedTasks(scoredTasks);
    };

    calculatePriority();
  }, [tasks]);

  const handleScheduleTask = async (task: PrioritizedTask) => {
    if (!currentUser) return;

    setSchedulingTask(task.id);
    setScheduleResult(null);

    try {
      // Create a calendar block for this task
      const startTime = new Date();
      startTime.setHours(startTime.getHours() + 1); // Schedule 1 hour from now
      
      const effortMinutes = { S: 20, M: 45, L: 90 };
      const duration = effortMinutes[task.effort as keyof typeof effortMinutes] || 45;
      
      const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

      await addDoc(collection(db, 'calendar_blocks'), {
        taskId: task.id,
        persona: currentPersona,
        title: task.title,
        startTime: startTime,
        endTime: endTime,
        duration: duration,
        status: 'scheduled',
        source: 'priority_pane',
        rationale: `Priority task: ${task.rationale}`,
        ownerUid: currentUser.uid,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      setScheduleResult(`✅ ${task.title} scheduled for ${startTime.toLocaleTimeString()}`);
      
      // Clear success message after 3 seconds
      setTimeout(() => setScheduleResult(null), 3000);

    } catch (error) {
      console.error('Scheduling error:', error);
      setScheduleResult(`❌ Failed to schedule: ${error.message}`);
    }
    setSchedulingTask(null);
  };

  const getPriorityColor = (score: number) => {
    if (score >= 60) return 'danger';
    if (score >= 40) return 'warning';
    if (score >= 25) return 'info';
    return 'secondary';
  };

  const getReasonBadges = (reasonCodes: string[]) => {
    const badgeMap = {
      overdue: { text: 'Overdue', variant: 'danger' },
      due_today: { text: 'Due Today', variant: 'warning' },
      due_tomorrow: { text: 'Tomorrow', variant: 'info' },
      due_soon: { text: 'Due Soon', variant: 'secondary' },
      high_priority: { text: 'High Priority', variant: 'danger' },
      quick_win: { text: 'Quick Win', variant: 'success' },
      goal_linked: { text: 'Goal-Linked', variant: 'primary' },
      in_progress: { text: 'In Progress', variant: 'warning' }
    };

    return reasonCodes.map(code => {
      const badge = badgeMap[code as keyof typeof badgeMap];
      return badge ? (
        <Badge key={code} bg={badge.variant} className="me-1 mb-1">
          {badge.text}
        </Badge>
      ) : null;
    });
  };

  return (
    <div className="md-card">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h5 className="md-headline-6 mb-0">Today's Top 5 Priority Tasks</h5>
        <Badge bg="primary">{currentPersona}</Badge>
      </div>

      {prioritizedTasks.length === 0 ? (
        <div className="text-center py-4 text-muted">
          <p>No active tasks to prioritize.</p>
          <p className="small">Create some tasks to see your priority list!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {prioritizedTasks.map((task, index) => (
            <div key={task.id} className="border rounded p-3 mb-3">
              <div className="d-flex justify-content-between align-items-start mb-2">
                <div className="flex-grow-1">
                  <div className="d-flex align-items-center gap-2 mb-1">
                    <Badge bg="light" text="dark">#{index + 1}</Badge>
                    <Badge bg={getPriorityColor(task.priorityScore)}>
                      Score: {Math.round(task.priorityScore)}
                    </Badge>
                  </div>
                  <h6 className="mb-1">{task.title}</h6>
                  <p className="text-muted small mb-2">{task.rationale}</p>
                  <div className="mb-2">
                    {getReasonBadges(task.reasonCodes)}
                  </div>
                  <div className="d-flex gap-2 small text-muted">
                    <span>Effort: {task.effort}</span>
                    <span>•</span>
                    <span>Priority: {task.priority}</span>
                    {task.dueDate && (
                      <>
                        <span>•</span>
                        <span>Due: {new Date(task.dueDate).toLocaleDateString()}</span>
                      </>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline-primary"
                  onClick={() => handleScheduleTask(task)}
                  disabled={schedulingTask === task.id}
                  className="ms-3"
                >
                  {schedulingTask === task.id ? (
                    <>
                      <Spinner as="span" animation="border" size="sm" className="me-1" />
                      Scheduling...
                    </>
                  ) : (
                    'Schedule'
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {scheduleResult && (
        <Alert variant={scheduleResult.includes('✅') ? 'success' : 'danger'} className="mt-3">
          {scheduleResult}
        </Alert>
      )}
    </div>
  );
};

export default PriorityPane;

export {};
