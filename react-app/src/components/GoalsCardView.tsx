import React, { useState, useEffect, useMemo } from 'react';
import { Card, Badge, Button, Dropdown, Modal, Alert } from 'react-bootstrap';
import { Edit3, Trash2, ChevronDown, Target, Calendar, User, Hash, MessageCircle, ChevronUp, Plus, Clock, CalendarPlus } from 'lucide-react';
import { Goal, Story } from '../types';
import { useSidebar } from '../contexts/SidebarContext';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, addDoc, updateDoc, deleteDoc, doc, limit, getDocs, serverTimestamp } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import EditGoalModal from './EditGoalModal';
import AddStoryModal from './AddStoryModal';
import { ChoiceMigration } from '../config/migration';
import { ChoiceHelper } from '../config/choices';
import { getStatusName } from '../utils/statusHelpers';
import { themeVars } from '../utils/themeVars';
import { ActivityStreamService } from '../services/ActivityStreamService';
import { toDate, formatDate } from '../utils/firestoreAdapters';
import type { GlobalTheme } from '../constants/globalThemes';
import { GLOBAL_THEMES, migrateThemeValue } from '../constants/globalThemes';
import './GoalsCardView.css';

interface GoalsCardViewProps {
  goals: Goal[];
  onGoalUpdate: (goalId: string, updates: Partial<Goal>) => void;
  onGoalDelete: (goalId: string) => void;
  onGoalPriorityChange: (goalId: string, newPriority: number) => void;
  onGoalSelect?: (goalId: string) => void; // New prop for goal selection
  selectedGoalId?: string | null; // New prop for highlighting selected goal
  themes?: GlobalTheme[];
  cardLayout?: 'grid' | 'comfortable';
}

const GoalsCardView: React.FC<GoalsCardViewProps> = ({
  goals,
  onGoalUpdate,
  onGoalDelete,
  onGoalPriorityChange,
  onGoalSelect,
  selectedGoalId,
  themes,
  cardLayout = 'grid'
}) => {
  const { showSidebar } = useSidebar();
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState<Goal | null>(null);
  const [showAddStoryModal, setShowAddStoryModal] = useState<string | null>(null); // Store goalId
  const [latestActivities, setLatestActivities] = useState<{ [goalId: string]: any }>({});
  const [calendarSyncStatus, setCalendarSyncStatus] = useState<{ [goalId: string]: string }>({});
  const [isSchedulingGoal, setIsSchedulingGoal] = useState<string | null>(null);
  const [goalTimeAllocations, setGoalTimeAllocations] = useState<{ [goalId: string]: number }>({});
  const [generatingForGoal, setGeneratingForGoal] = useState<string | null>(null);

  const themePalette = useMemo(() => (themes && themes.length ? themes : GLOBAL_THEMES), [themes]);
  const themeMap = useMemo(() => {
    const map = new Map<number, GlobalTheme>();
    themePalette.forEach(theme => map.set(theme.id, theme));
    return map;
  }, [themePalette]);
  const defaultTheme = themePalette[0] || GLOBAL_THEMES[0];
  const resolveTheme = (value: any): GlobalTheme => {
    const themeId = migrateThemeValue(value);
    return themeMap.get(themeId) || defaultTheme;
  };

  const hexToRgb = (hex: string) => {
    const value = hex.replace('#', '');
    const full = value.length === 3 ? value.split('').map(c => c + c).join('') : value;
    const bigint = parseInt(full, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return { r, g, b };
  };

  const rgbToHex = (r: number, g: number, b: number) => `#${[r, g, b]
    .map(v => {
      const clamped = Math.max(0, Math.min(255, Math.round(v)));
      return clamped.toString(16).padStart(2, '0');
    })
    .join('')}`;

  const hexToRgba = (hex: string, alpha: number) => {
    const value = hex.replace('#', '');
    const full = value.length === 3 ? value.split('').map(c => c + c).join('') : value;
    const bigint = parseInt(full, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const lightenColor = (hex: string, amount: number) => {
    const { r, g, b } = hexToRgb(hex);
    const factor = Math.max(0, Math.min(1, amount));
    const nr = r + (255 - r) * factor;
    const ng = g + (255 - g) * factor;
    const nb = b + (255 - b) * factor;
    return rgbToHex(nr, ng, nb);
  };

  const showDetailed = cardLayout === 'comfortable';
  const gridClassName = showDetailed
    ? 'goals-card-grid goals-card-grid--comfortable'
    : 'goals-card-grid goals-card-grid--grid';

  const compactBodyPadding = showDetailed ? '24px' : '14px 12px';
  const compactBodyGap = showDetailed ? '16px' : '10px';
  const headerMargin = showDetailed ? '12px' : '8px';
  const titleFontSize = showDetailed ? '18px' : '16px';
  const badgeFontSize = showDetailed ? '12px' : '11px';

  const sortedGoals = useMemo(() => {
    const getTargetMillis = (goal: Goal) => {
      const raw = (goal as any).targetDate;
      if (!raw) return Number.POSITIVE_INFINITY;
      if (typeof raw === 'number') return raw;
      if (typeof raw === 'string') {
        const parsed = Date.parse(raw);
        return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
      }
      if (raw?.toDate) {
        try {
          return raw.toDate().getTime();
        } catch {
          return Number.POSITIVE_INFINITY;
        }
      }
      return Number.POSITIVE_INFINITY;
    };

    return [...goals].sort((a, b) => getTargetMillis(a) - getTargetMillis(b));
  }, [goals]);

  // Theme colors mapping via CSS variables (no hardcoded hex)
  // Status colors via tokens
  const statusColors = {
    New: 'var(--muted)',
    'Work in Progress': 'var(--green)',
    Complete: 'var(--brand)',
    Blocked: 'var(--red)',
    Deferred: 'var(--orange)'
  } as const;

  
  // Load latest activities once and reuse similar logic to Gantt/Roadmap
  useEffect(() => {
    if (!currentUser?.uid) {
      setLatestActivities({});
      return;
    }

    const q = query(
      collection(db, 'activity_stream'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('timestamp', 'desc'),
      limit(300)
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const map: Record<string, any> = {};
        for (const docSnap of snap.docs) {
          const data = docSnap.data() as any;
          if (data.entityType !== 'goal') continue;
          if (!data.activityType) continue;

          // Respect only meaningful activity entries
          const type = String(data.activityType).toLowerCase();
          if (['clicked', 'viewed', 'exported', 'imported'].includes(type)) continue;

          const goalId = data.entityId as string;
          if (!goalId || map[goalId]) continue;

          const isMeaningfulUpdate =
            (type === 'note_added' && data.noteContent) ||
            type === 'status_changed' ||
            (type === 'updated' && data.fieldName) ||
            type === 'created';

          if (isMeaningfulUpdate) {
            map[goalId] = { id: docSnap.id, ...data };
          }
        }
        setLatestActivities(map);
      },
      (error) => {
        console.error('GoalsCardView activity stream error:', error);
        setLatestActivities({});
      }
    );

    return () => unsubscribe();
  }, [currentUser?.uid]);

  // Fetch time allocations for goals from calendar blocks
  useEffect(() => {
    if (!currentUser || !goals.length) return;

    const fetchTimeAllocations = async () => {
      try {
        const now = new Date();
        const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
        const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

        const allocations: { [goalId: string]: number } = {};

        for (const goal of goals) {
          // Query calendar blocks for this goal - simplified to avoid complex index
          const blocksQuery = query(
            collection(db, 'calendar_blocks'),
            where('ownerUid', '==', currentUser.uid),
            where('goalId', '==', goal.id)
          );

          const blocksSnapshot = await getDocs(blocksQuery);
          let totalMinutes = 0;

          // Filter by date range in JavaScript to avoid complex Firestore index
          blocksSnapshot.docs.forEach(doc => {
            const block = doc.data();
            if (block.start && block.end) {
              const blockStart = block.start;
              if (blockStart >= weekStart.getTime() && blockStart <= weekEnd.getTime()) {
                totalMinutes += (block.end - block.start) / (1000 * 60);
              }
            }
          });

          allocations[goal.id] = totalMinutes;
        }

        setGoalTimeAllocations(allocations);
      } catch (error) {
        console.error('Failed to fetch time allocations:', error);
      }
    };

    fetchTimeAllocations();
  }, [currentUser, goals]);

  // Schedule time for a specific goal
  const scheduleGoalTime = async (goal: Goal) => {
    if (!currentUser) return;

    try {
      setIsSchedulingGoal(goal.id);
      setCalendarSyncStatus(prev => ({ 
        ...prev, 
        [goal.id]: '🤖 AI is analyzing and scheduling time for this goal...' 
      }));

      // Call the calendar planning function with goal focus
      const planCalendar = httpsCallable(functions, 'planCalendar');
      const result = await planCalendar({
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        persona: currentPersona || 'personal',
        focusGoalId: goal.id, // Focus planning on this specific goal
        goalTimeRequest: goal.timeToMasterHours ? Math.min(goal.timeToMasterHours * 60, 300) : 120 // Request 2-5 hours per week
      });

      const planResult = result.data as any;
      
      if (planResult.blocksCreated > 0) {
        setCalendarSyncStatus(prev => ({ 
          ...prev, 
          [goal.id]: `✅ Scheduled ${planResult.blocksCreated} time blocks for "${goal.title}"` 
        }));

        // Track activity
        await addDoc(collection(db, 'activity_stream'), {
          entityType: 'goal',
          entityId: goal.id,
          ownerUid: currentUser.uid,
          activityType: 'calendar_scheduled',
          description: `Scheduled ${planResult.blocksCreated} time blocks`,
          metadata: { blocksCreated: planResult.blocksCreated, timeRequested: goal.timeToMasterHours },
          timestamp: serverTimestamp()
        });
      } else {
        setCalendarSyncStatus(prev => ({ 
          ...prev, 
          [goal.id]: '⚠️ No available time slots found for scheduling' 
        }));
      }
    } catch (error) {
      console.error('Failed to schedule goal time:', error);
      setCalendarSyncStatus(prev => ({ 
        ...prev, 
        [goal.id]: '❌ Failed to schedule time: ' + (error as Error).message 
      }));
    } finally {
      setIsSchedulingGoal(null);
      // Clear status after 5 seconds
      setTimeout(() => {
        setCalendarSyncStatus(prev => {
          const newStatus = { ...prev };
          delete newStatus[goal.id];
          return newStatus;
        });
      }, 5000);
    }
  };

  const handleStoryPriorityChange = async (storyId: string, newPriority: number) => {
    try {
      // Convert number back to priority string format
      const priorityMap = { 1: 'P1', 2: 'P2', 3: 'P3' } as const;
      const priorityString = priorityMap[newPriority as keyof typeof priorityMap] || 'P3';
      
      await updateDoc(doc(db, 'stories', storyId), {
        priority: priorityString,
        updatedAt: new Date()
      });
      console.log('✅ Story priority updated successfully');
    } catch (error) {
      console.error('❌ Error updating story priority:', error);
    }
  };

  const handleViewActivityStream = (goal: Goal, event: React.MouseEvent) => {
    event.stopPropagation();
    console.log('🎯 Opening goal activity stream:', goal.id);
    showSidebar(goal, 'goal');
  };

  const handleStatusChange = (goalId: string, newStatus: 'New' | 'Work in Progress' | 'Complete' | 'Blocked' | 'Deferred') => {
    const numericStatus = ChoiceMigration.migrateGoalStatus(newStatus);
    onGoalUpdate(goalId, { status: numericStatus });
  };

  const handlePriorityChange = (goalId: string, newPriority: number) => {
    onGoalPriorityChange(goalId, newPriority);
  };

  const handleDeleteConfirm = (goalId: string) => {
    onGoalDelete(goalId);
    setShowDeleteModal(null);
  };

  const handleAutoGenerateStories = async (goal: Goal) => {
    if (!currentUser) return;
    try {
      setGeneratingForGoal(goal.id);
      const callable = httpsCallable(functions, 'generateStoriesForGoal');
      const resp: any = await callable({ goalId: goal.id });
      const created = resp?.data?.created ?? 0;
      // Lightweight feedback via alert for now
      alert(created > 0 ? `Generated ${created} stories for "${goal.title}"` : 'No stories generated');
    } catch (e: any) {
      console.error('Auto-generate stories failed', e);
      alert('Failed to generate stories: ' + (e?.message || 'Unknown error'));
    } finally {
      setGeneratingForGoal(null);
    }
  };

  if (goals.length === 0) {
    return (
      <div style={{ 
        textAlign: 'center', 
        padding: '60px 20px',
        color: themeVars.muted as string
      }}>
        <Target size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
        <h4>No Goals Found</h4>
        <p>Start by creating your first goal to track your progress.</p>
      </div>
    );
  }

  return (
    <div className="goals-card-view" style={{ padding: '20px' }}>
      <div className={gridClassName}>
        {sortedGoals.map((goal) => {
          const themeDef = resolveTheme(goal.theme);
          const themeColor = themeDef.color || 'var(--brand)';
          const themeTextColor = themeDef.textColor || 'var(--on-accent)';
          const isSelected = selectedGoalId === goal.id;
          const gradientStart = lightenColor(themeColor, showDetailed ? 0.35 : 0.55);
          const gradientEnd = lightenColor(themeColor, showDetailed ? 0.6 : 0.78);
          const cardBackground = `linear-gradient(165deg, ${gradientStart} 0%, ${gradientEnd} 100%)`;
          const defaultText = typeof themeVars.text === 'string' ? themeVars.text : '#1f1f1f';
          const defaultMuted = typeof themeVars.muted === 'string' ? themeVars.muted : 'rgba(0,0,0,0.6)';
          const textColor = showDetailed ? (themeDef.textColor || '#ffffff') : defaultText;
          const mutedTextColor = showDetailed ? hexToRgba(themeColor, 0.75) : defaultMuted;
          const totalStories = (goal as any).storyCount ?? (goal as any).storiesCount ?? (goal as any).story_counts ?? null;
          const doneStories = (goal as any).doneStories ?? (goal as any).completedStories ?? null;
          const allocatedMinutes = goalTimeAllocations[goal.id];
          const latestActivity = latestActivities[goal.id];
          const progressPercent = totalStories && totalStories > 0
            ? Math.max(0, Math.min(100, Math.round(((doneStories ?? 0) / totalStories) * 100)))
            : 0;
          const activityButton = (
            <Button
              variant={showDetailed ? 'outline-light' : 'outline-primary'}
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleViewActivityStream(goal, e);
              }}
              className={showDetailed ? '' : 'goals-card-activity-button--icon'}
              style={{
                fontSize: showDetailed ? '12px' : '0',
                padding: showDetailed ? '4px 8px' : '6px',
                display: 'flex',
                alignItems: 'center',
                gap: showDetailed ? '4px' : '0'
              }}
              aria-label="Open activity stream"
            >
              <MessageCircle size={showDetailed ? 12 : 14} />
              {showDetailed && 'Activity'}
            </Button>
          );

          return (
            <div key={goal.id} className="goals-card-tile">
              <Card
                className={`h-100 goals-card goals-card--${showDetailed ? 'comfortable' : 'grid'}`}
                style={{
                height: '100%',
                border: isSelected ? `3px solid ${themeColor}` : '1px solid rgba(0,0,0,0.06)',
                boxShadow: isSelected ? '0 0 0 0 transparent' : '0 10px 24px rgba(15, 23, 42, 0.12)',
                borderRadius: showDetailed ? '16px' : '14px',
                overflow: 'hidden',
                transition: 'all 0.3s ease',
                cursor: 'pointer',
                background: cardBackground,
                color: textColor,
                flex: '1 1 auto'
                }}
                onClick={() => onGoalSelect?.(goal.id)}
                onMouseEnter={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 12px 18px var(--glass-shadow-color)';
                }
              }}
                onMouseLeave={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 6px 12px var(--glass-shadow-color)';
                }
                }}
              >
              {/* Theme Bar */}
              <div 
                style={{
                  height: '6px',
                  backgroundColor: themeColor
                }}
              />

              <Card.Body
                style={{
                  padding: compactBodyPadding,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: compactBodyGap
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: headerMargin }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h5 style={{ 
                      margin: '0 0 6px 0', 
                      fontSize: titleFontSize, 
                      fontWeight: '600',
                      lineHeight: '1.4',
                      wordBreak: 'break-word'
                    }}>
                      {goal.title}
                    </h5>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <Badge
                          style={{
                            backgroundColor: themeColor,
                            color: themeTextColor,
                            fontSize: badgeFontSize
                          }}
                        >
                          {themeDef.label}
                        </Badge>
                      <Badge 
                        style={{ 
                          backgroundColor: statusColors[getStatusName(goal.status) as keyof typeof statusColors] || 'var(--muted)',
                          color: 'var(--on-accent)',
                          fontSize: badgeFontSize
                        }}
                      >
                        {getStatusName(goal.status)}
                      </Badge>
                    </div>
                  </div>
                  
                  <Dropdown onClick={(e) => e.stopPropagation()}>
                    <Dropdown.Toggle 
                      variant="outline-secondary" 
                      size="sm"
                      style={{ border: 'none', padding: '4px 8px' }}
                    >
                      <ChevronDown size={16} />
                    </Dropdown.Toggle>
                    <Dropdown.Menu>
                      <Dropdown.Item 
                        onClick={() => setShowEditModal(goal)}
                      >
                        <Edit3 size={14} className="me-2" />
                        Edit Goal
                      </Dropdown.Item>
                      <Dropdown.Item 
                        onClick={() => setShowAddStoryModal(goal.id)}
                      >
                        <Plus size={14} className="me-2" />
                        Add Story
                      </Dropdown.Item>
                      <Dropdown.Item 
                        onClick={() => handleAutoGenerateStories(goal)}
                        disabled={generatingForGoal === goal.id}
                      >
                        {generatingForGoal === goal.id ? (
                          <>
                            <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                            Generating Stories...
                          </>
                        ) : (
                          <>Auto-Generate Stories</>
                        )}
                      </Dropdown.Item>
                      <Dropdown.Item 
                        onClick={() => scheduleGoalTime(goal)}
                        disabled={isSchedulingGoal === goal.id}
                      >
                        <CalendarPlus size={14} className="me-2" />
                        {isSchedulingGoal === goal.id ? 'Scheduling...' : 'Schedule Time Blocks'}
                      </Dropdown.Item>
                      <Dropdown.Divider />
                      <Dropdown.Header>Change Status</Dropdown.Header>
                      <Dropdown.Item onClick={() => handleStatusChange(goal.id, 'New')}>
                        New
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => handleStatusChange(goal.id, 'Work in Progress')}>
                        Work in Progress
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => handleStatusChange(goal.id, 'Complete')}>
                        Complete
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => handleStatusChange(goal.id, 'Blocked')}>
                        Blocked (Pending Story)
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => handleStatusChange(goal.id, 'Deferred')}>
                        Deferred
                      </Dropdown.Item>
                      <Dropdown.Divider />
                      <Dropdown.Header>Change Priority</Dropdown.Header>
                      <Dropdown.Item onClick={() => handlePriorityChange(goal.id, 1)}>
                        High Priority (1)
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => handlePriorityChange(goal.id, 2)}>
                        Medium Priority (2)
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => handlePriorityChange(goal.id, 3)}>
                        Low Priority (3)
                      </Dropdown.Item>
                      <Dropdown.Divider />
                      <Dropdown.Item 
                        className="text-danger"
                        onClick={() => setShowDeleteModal(goal.id)}
                      >
                        <Trash2 size={14} className="me-2" />
                        Delete Goal
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown>
                </div>

                {!showDetailed && (
                  <div className="goals-card-quick-stats">
                    <div className="goals-card-progress">
                      <div className="goals-card-progress__header">
                        <span>Progress</span>
                        <span>{progressPercent}%</span>
                      </div>
                      <div className="goals-card-progress__bar" style={{ background: hexToRgba(themeColor, 0.18) }}>
                        <div
                          className="goals-card-progress__bar-fill"
                          style={{ width: `${progressPercent}%`, background: hexToRgba(themeColor, 0.45) }}
                        />
                      </div>
                      <div className="goals-card-progress__footer">
                        {totalStories && totalStories > 0
                          ? `${doneStories ?? 0} of ${totalStories} stories`
                          : 'No stories yet'}
                      </div>
                    </div>
                    <div
                      className="goals-card-quick-stat"
                      style={{
                        background: hexToRgba(themeColor, 0.12),
                        border: `1px solid ${hexToRgba(themeColor, 0.22)}`,
                        color: textColor
                      }}
                    >
                      <span className="label">Priority</span>
                      <span className="value">{goal.priority ?? '—'}</span>
                    </div>
                    {allocatedMinutes !== undefined && (
                      <div
                        className="goals-card-quick-stat"
                        style={{
                          background: hexToRgba(themeColor, 0.12),
                          border: `1px solid ${hexToRgba(themeColor, 0.22)}`,
                          color: textColor
                        }}
                      >
                        <span className="label">This Week</span>
                        <span className="value">{Math.round(allocatedMinutes)}m</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Description */}
                {showDetailed && goal.description && (
                  <p
                    className="goals-card-description"
                    style={{
                      margin: '0 0 16px 0',
                      color: mutedTextColor,
                      fontSize: '14px',
                      lineHeight: '1.5',
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden'
                    }}
                  >
                    {goal.description}
                  </p>
                )}

                {/* Latest Status/Comment */}
                {showDetailed && latestActivity && (
                  <div style={{ 
                    marginBottom: '16px',
                    padding: '12px',
                    backgroundColor: hexToRgba(themeColor, 0.16),
                    border: `1px solid ${hexToRgba(themeColor, 0.35)}`,
                    borderRadius: '10px'
                  }}>
                    <div style={{ 
                      fontSize: '11px', 
                      fontWeight: '600', 
                      color: textColor, 
                      marginBottom: '6px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      {latestActivity.activityType === 'note_added' 
                        ? 'Latest Comment'
                        : latestActivity.activityType === 'status_changed'
                        ? 'Latest Status'
                        : latestActivity.activityType === 'updated'
                        ? 'Latest Update'
                        : 'Latest Activity'}
                    </div>
                    <div style={{ 
                      fontSize: '12px', 
                      color: textColor, 
                      fontStyle: 'italic',
                      lineHeight: '1.4'
                    }}>
                      {latestActivity.activityType === 'note_added'
                        ? `"${latestActivity.noteContent}"`
                        : latestActivity.activityType === 'status_changed'
                        ? `Status changed to: ${ChoiceHelper.getLabel('goal', 'status', parseInt(latestActivity.newValue) || latestActivity.newValue)}`
                        : latestActivity.activityType === 'updated' && latestActivity.fieldName
                        ? `${latestActivity.fieldName} changed to: ${latestActivity.newValue}`
                        : latestActivity.activityType === 'created'
                        ? 'Goal created'
                        : latestActivity.description || 'Activity logged'}
                    </div>
                    <div style={{ 
                      fontSize: '10px', 
                      color: mutedTextColor, 
                      marginTop: '6px'
                    }}>
                      {latestActivity.timestamp ? ActivityStreamService.formatTimestamp(latestActivity.timestamp) : null}
                      {latestActivity.userEmail && ` • ${latestActivity.userEmail.split('@')[0]}`}
                    </div>
                  </div>
                )}

                {showDetailed && (
                  <>
                    <div className="goals-card-progress goals-card-progress--detailed">
                      <div className="goals-card-progress__header">
                        <span>Progress</span>
                        <span>{progressPercent}%</span>
                      </div>
                      <div className="goals-card-progress__bar" style={{ background: hexToRgba(themeColor, 0.2) }}>
                        <div
                          className="goals-card-progress__bar-fill"
                          style={{ width: `${progressPercent}%`, background: hexToRgba(themeColor, 0.5) }}
                        />
                      </div>
                      <div className="goals-card-progress__footer" style={{ color: textColor }}>
                        {totalStories && totalStories > 0
                          ? `${doneStories ?? 0} of ${totalStories} stories`
                          : 'No stories yet'}
                      </div>
                    </div>
                    <div className="goals-card-stats-detailed">
                      <div className="goals-card-stat-block">
                        <div className="label">Total Stories</div>
                        <div className="value">{totalStories ?? '—'}</div>
                      </div>
                    <div className="goals-card-stat-block">
                      <div className="label">Priority</div>
                      <div className="value">{goal.priority ?? '—'}</div>
                    </div>
                    <div className="goals-card-stat-block">
                      <div className="label">Confidence</div>
                      <div className="value">{goal.confidence ? `${goal.confidence}/10` : '—'}</div>
                    </div>
                    <div className="goals-card-stat-block">
                      <div className="label">This Week</div>
                      <div className="value">{allocatedMinutes !== undefined ? `${Math.round(allocatedMinutes)}m` : '—'}</div>
                    </div>
                    </div>
                  </>
                )}

                {/* Goal Details */}
                {showDetailed && (
                  <div style={{ marginBottom: '16px', color: mutedTextColor, display: 'grid', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                      <Target size={14} />
                      <span style={{ fontWeight: '500' }}>Size:</span>
                      <span>{goal.size}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                      <Hash size={14} />
                      <span style={{ fontWeight: '500' }}>Priority:</span>
                      <span>{goal.priority}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                      <User size={14} />
                      <span style={{ fontWeight: '500' }}>Owner:</span>
                      <span>{goal.ownerUid?.split('@')[0] || '—'}</span>
                    </div>
                    {goal.confidence && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                        <User size={14} />
                        <span style={{ fontWeight: '500' }}>Confidence:</span>
                        <span>{goal.confidence}/10</span>
                      </div>
                    )}
                    {goalTimeAllocations[goal.id] !== undefined && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: textColor }}>
                        <Clock size={14} />
                        <span style={{ fontWeight: '500' }}>This Week:</span>
                        <span>{Math.round(goalTimeAllocations[goal.id])} minutes allocated</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Footer */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingTop: showDetailed ? '16px' : '8px',
                    borderTop: showDetailed ? `1px solid ${hexToRgba(themeColor, 0.25)}` : '1px solid rgba(255,255,255,0.18)',
                    fontSize: '12px',
                    color: mutedTextColor
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <Calendar size={12} style={{ marginRight: '4px' }} />
                      {(() => {
                        const d = toDate(goal.createdAt);
                        return (
                          <span>Created: {d ? formatDate(d) : '—'}</span>
                        );
                      })()}
                    </div>
                    {(() => {
                      const d = toDate(goal.updatedAt);
                      return d ? (
                        <div style={{ display: 'flex', alignItems: 'center', color: textColor, fontWeight: '500' }}>
                          <Calendar size={12} style={{ marginRight: '4px' }} />
                          <span>
                            Updated: {formatDate(d)} at {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      ) : null;
                    })()}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {activityButton}
                  </div>
                </div>
              </Card.Body>
            </Card>

            {/* Calendar Sync Status */}
            {calendarSyncStatus[goal.id] && (
              <Alert 
                variant={calendarSyncStatus[goal.id].startsWith('✅') ? 'success' : 
                        calendarSyncStatus[goal.id].startsWith('❌') ? 'danger' : 
                        calendarSyncStatus[goal.id].startsWith('⚠️') ? 'warning' : 'info'}
                style={{ 
                  marginTop: '8px',
                  fontSize: '12px',
                  padding: '8px 12px',
                  marginBottom: 0
                }}
                dismissible
                onClose={() => setCalendarSyncStatus(prev => {
                  const newStatus = { ...prev };
                  delete newStatus[goal.id];
                  return newStatus;
                })}
              >
                {calendarSyncStatus[goal.id]}
              </Alert>
            )}

          </div>
          );
        })}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal show={!!showDeleteModal} onHide={() => setShowDeleteModal(null)}>
        <Modal.Header closeButton>
          <Modal.Title>Delete Goal</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Are you sure you want to delete this goal? This action cannot be undone.
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDeleteModal(null)}>
            Cancel
          </Button>
          <Button 
            variant="danger" 
            onClick={() => showDeleteModal && handleDeleteConfirm(showDeleteModal)}
          >
            Delete Goal
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Edit Goal Modal */}
      <EditGoalModal
        goal={showEditModal}
        show={!!showEditModal}
        onClose={() => setShowEditModal(null)}
        currentUserId={currentUser?.uid || ''}
      />

      {/* Add Story Modal */}
      <AddStoryModal
        show={!!showAddStoryModal}
        onClose={() => setShowAddStoryModal(null)}
        goalId={showAddStoryModal || undefined}
      />
    </div>
  );
};

export default GoalsCardView;
