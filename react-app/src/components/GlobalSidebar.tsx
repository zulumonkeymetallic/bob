import React, { useState, useEffect } from 'react';
import { Card, Button, Badge, Form, Row, Col, Modal, ListGroup } from 'react-bootstrap';
import { X, Edit3, Save, Calendar, Target, BookOpen, Clock, Hash, ChevronLeft, ChevronRight, Trash2, Plus, MessageCircle, Link as LinkIcon, Copy, MessageSquare, Wand2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { getThemeById, migrateThemeValue } from '../constants/globalThemes';
import { Story, Goal, Task, Sprint } from '../types';
import { useSidebar } from '../contexts/SidebarContext';
import { useTestMode } from '../contexts/TestModeContext';
import { useAuth } from '../contexts/AuthContext';
import { ActivityStreamService, ActivityEntry } from '../services/ActivityStreamService';
import { validateRef } from '../utils/referenceGenerator';
import GoalChatModal from './GoalChatModal';
import ResearchDocModal from './ResearchDocModal';
import { domainThemePrimaryVar, themeVars, rgbaCard } from '../utils/themeVars';
import { ChoiceHelper } from '../config/choices';
import { EntitySummary, searchEntities, loadEntitySummary, formatEntityLabel } from '../utils/entityLookup';
import { useNavigate } from 'react-router-dom';

interface EntityLookupInputProps {
  type: 'goal' | 'story';
  ownerUid?: string;
  value?: string;
  onSelect: (id: string | null) => void;
  placeholder: string;
  initialOptions: Array<{ id: string; title: string; ref?: string | null }>;
}

const EntityLookupInput: React.FC<EntityLookupInputProps> = ({
  type,
  ownerUid,
  value,
  onSelect,
  placeholder,
  initialOptions,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EntitySummary[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!value) {
      setSelectedLabel('');
      return;
    }
    const local = initialOptions.find((opt) => opt.id === value);
    if (local) {
      setSelectedLabel(formatEntityLabel(local));
      return;
    }
    let active = true;
    loadEntitySummary(type, value).then((summary) => {
      if (!active) return;
      setSelectedLabel(summary ? formatEntityLabel(summary) : '');
    });
    return () => {
      active = false;
    };
  }, [value, initialOptions, type]);

  useEffect(() => {
    if (!ownerUid || query.trim().length < 3) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    searchEntities(type, ownerUid, query)
      .then((items) => {
        if (!active) return;
        setResults(items);
        setOpen(true);
      })
      .catch(() => setResults([]))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query, ownerUid, type]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (summary: EntitySummary | null) => {
    if (!summary) {
      onSelect(null);
      setSelectedLabel('');
    } else {
      onSelect(summary.id);
      setSelectedLabel(formatEntityLabel(summary));
    }
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', minWidth: 200 }}>
      <Form.Control
        size="sm"
        type="text"
        placeholder={placeholder}
        value={query}
        onFocus={() => { if (results.length) setOpen(true); }}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 20,
            backgroundColor: 'var(--bs-body-bg, #fff)',
            border: `1px solid ${rgbaCard(0.12)}`,
            borderRadius: 6,
            maxHeight: 220,
            overflowY: 'auto',
            boxShadow: '0 6px 16px rgba(15,23,42,0.18)',
          }}
        >
          {loading ? (
            <div className="p-2 small text-muted">Searching…</div>
          ) : results.length === 0 ? (
            <div className="p-2 small text-muted">No matches</div>
          ) : (
            <ListGroup variant="flush">
              {results.map((item) => (
                <ListGroup.Item
                  key={item.id}
                  action
                  onClick={() => handleSelect(item)}
                  className="py-1 px-2"
                >
                  <div className="fw-semibold" style={{ fontSize: 12 }}>
                    {item.ref ? `${item.ref} · ${item.title}` : item.title}
                  </div>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
        </div>
      )}
      <div className="small text-muted" style={{ marginTop: 4 }}>
        {selectedLabel ? `Selected: ${selectedLabel}` : 'No selection'}
        {selectedLabel && (
          <Button
            size="sm"
            variant="link"
            className="p-0 ms-2 align-baseline"
            onClick={() => handleSelect(null)}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
};

interface GlobalSidebarProps {
  goals: Goal[];
  stories: Story[];
  sprints: Sprint[];
  onEdit?: (item: Story | Task | Goal, type: 'story' | 'task' | 'goal') => void;
  onDelete?: (item: Story | Task | Goal, type: 'story' | 'task' | 'goal') => void;
}

const GlobalSidebar: React.FC<GlobalSidebarProps> = ({
  goals,
  stories,
  sprints,
  onEdit,
  onDelete
}) => {
  const { selectedItem, selectedType, isVisible, isCollapsed, hideSidebar, toggleCollapse, updateItem } = useSidebar();
  const { isTestMode, testModeLabel } = useTestMode();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [showAddNote, setShowAddNote] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [showResearch, setShowResearch] = useState(false);
  const [orchestrating, setOrchestrating] = useState(false);
  // Quick edit state for inline updates
  const [quickEdit, setQuickEdit] = useState<any>({});
  const linkedGoalId = (selectedType === 'task' || selectedType === 'story')
    ? (quickEdit.goalId || (selectedItem as any)?.goalId || '')
    : '';
  const linkedGoal = linkedGoalId ? goals.find((g) => g.id === linkedGoalId) : null;

  // Ensure status labels/variants match each entity’s board semantics
  const getStatusDisplay = (
    type: 'goal' | 'story' | 'task',
    status: any
  ): { label: string; variant: string } => {
    // Helper to normalize string casing
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

    // Story status mapping (numeric and string)
    if (type === 'story') {
      // Numeric mapping used in Kanban: 0=backlog,1=planned,2=active/in-progress,3=testing,4=done
      if (typeof status === 'number') {
        switch (status) {
          case 4: return { label: 'Done', variant: 'success' };
          case 3: return { label: 'Testing', variant: 'warning' };
          case 2: return { label: 'Active', variant: 'primary' };
          case 1: return { label: 'Planned', variant: 'secondary' };
          case 0: return { label: 'Backlog', variant: 'secondary' };
          default: return { label: 'Unknown', variant: 'light' };
        }
      }
      // String mapping fallback
      const map: Record<string, { label: string; variant: string }> = {
        backlog: { label: 'Backlog', variant: 'secondary' },
        planned: { label: 'Planned', variant: 'secondary' },
        active: { label: 'Active', variant: 'primary' },
        'in-progress': { label: 'Active', variant: 'primary' },
        testing: { label: 'Testing', variant: 'warning' },
        done: { label: 'Done', variant: 'success' },
        defect: { label: 'Defect', variant: 'danger' },
      };
      return map[String(status) as keyof typeof map] || { label: cap(String(status || 'Unknown')), variant: 'light' };
    }

    // Task status mapping (primarily string-based today)
    if (type === 'task') {
      if (typeof status === 'number') {
        // Conservative mapping: 0=todo/planned,1=in-progress,3=blocked,2=done (if ever used)
        switch (status) {
          case 2: return { label: 'Done', variant: 'success' };
          case 3: return { label: 'Blocked', variant: 'danger' };
          case 1: return { label: 'In Progress', variant: 'primary' };
          case 0: return { label: 'Todo', variant: 'secondary' };
          default: return { label: 'Unknown', variant: 'light' };
        }
      }
      const map: Record<string, { label: string; variant: string }> = {
        todo: { label: 'Todo', variant: 'secondary' },
        planned: { label: 'Planned', variant: 'secondary' },
        'in-progress': { label: 'In Progress', variant: 'primary' },
        blocked: { label: 'Blocked', variant: 'danger' },
        done: { label: 'Done', variant: 'success' },
      };
      return map[String(status) as keyof typeof map] || { label: cap(String(status || 'Unknown')), variant: 'light' };
    }

    // Goal status mapping
    if (typeof status === 'number') {
      // Generic goal mapping used elsewhere: 0=New,1=Work in Progress,2=Complete,3=Blocked,4=Deferred
      switch (status) {
        case 2: return { label: 'Complete', variant: 'success' };
        case 1: return { label: 'Active', variant: 'primary' };
        case 3: return { label: 'Blocked', variant: 'danger' };
        case 4: return { label: 'Deferred', variant: 'warning' };
        case 0: return { label: 'New', variant: 'secondary' };
        default: return { label: 'Unknown', variant: 'light' };
      }
    }
    const map: Record<string, { label: string; variant: string }> = {
      new: { label: 'New', variant: 'secondary' },
      active: { label: 'Active', variant: 'primary' },
      paused: { label: 'Paused', variant: 'warning' },
      done: { label: 'Done', variant: 'success' },
      dropped: { label: 'Dropped', variant: 'secondary' },
    };
    return map[String(status) as keyof typeof map] || { label: cap(String(status || 'Unknown')), variant: 'light' };
  };

  // Theme colors mapping via CSS variables (no hardcoded hex)
  const hexToRgba = (hex: string, a: number) => {
    const v = hex.replace('#', '');
    const b = parseInt(v.length === 3 ? v.split('').map(c => c + c).join('') : v, 16);
    const r = (b >> 16) & 255, g = (b >> 8) & 255, bl = b & 255;
    return `rgba(${r}, ${g}, ${bl}, ${a})`;
  };

  React.useEffect(() => {
    if (!selectedItem) {
      setActivities([]);
      return;
    }

    setEditForm({ ...selectedItem });
    setIsEditing(false);

    if (!currentUser?.uid) return;

    // Subscribe to activity stream for this item
    const entityType = (selectedType === 'task' || selectedType === 'story' || selectedType === 'goal')
      ? selectedType
      : 'task';
    const unsubscribe = ActivityStreamService.subscribeToActivityStreamAny(
      selectedItem.id,
      entityType,
      setActivities,
      currentUser.uid
    );

    return unsubscribe;
  }, [selectedItem, selectedType, currentUser?.uid]);

  // Determine responsive sidebar width
  const getSidebarWidth = React.useCallback(() => {
    const mobile = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 576px)').matches;
    if (mobile) return '100vw';
    return isCollapsed ? '60px' : '400px';
  }, [isCollapsed]);



  // Status options aligned with board lanes (built unconditionally to satisfy hooks rules)
  const statusOptions = React.useMemo(() => {
    if (selectedType === 'goal') return ChoiceHelper.getOptions('goal', 'status');
    if (selectedType === 'story') return ChoiceHelper.getOptions('story', 'status');
    return ChoiceHelper.getOptions('task', 'status');
  }, [selectedType]);

  // Seed quick edit when selection changes
  React.useEffect(() => {
    if (!selectedItem || !selectedType) return;
    const base: any = { status: (selectedItem as any).status };
    if (selectedType === 'task') {
      base.dueDate = toDateInput((selectedItem as any).dueDate || (selectedItem as any).dueDateMs || (selectedItem as any).targetDate || null);
      base.sprintId = (selectedItem as any).sprintId || '';
      base.storyId = (selectedItem as any).storyId || (selectedItem as any).parentId || '';
      base.goalId = (selectedItem as any).goalId || '';
      base.description = (selectedItem as any).description || '';
      base.points = (selectedItem as any).points ?? 1;
    } else if (selectedType === 'story') {
      base.sprintId = (selectedItem as any).sprintId || '';
      base.goalId = (selectedItem as any).goalId || '';
      base.description = (selectedItem as any).description || '';
    } else if (selectedType === 'goal') {
      base.description = (selectedItem as any).description || '';
      base.parentGoalId = (selectedItem as any).parentGoalId || '';
    }
    setQuickEdit(base);
  }, [selectedItem, selectedType]);

  if (!isVisible || !selectedItem || !selectedType) {
    return null;
  }


  const applyQuickEdit = async () => {
    if (!selectedItem || !selectedType) return;
    try {
      const updates: any = {};
      const before: any = {};
      if (quickEdit.status !== undefined && quickEdit.status !== (selectedItem as any).status) { updates.status = Number(quickEdit.status); before.status = (selectedItem as any).status; }
      if (quickEdit.description !== undefined && quickEdit.description !== (selectedItem as any).description) { updates.description = String(quickEdit.description || ''); before.description = (selectedItem as any).description || ''; }
      if (selectedType === 'task') {
        const newDueMs = fromDateInput(quickEdit.dueDate);
        const prevDue = (selectedItem as any).dueDate || (selectedItem as any).dueDateMs || (selectedItem as any).targetDate || null;
        if ((newDueMs || null) !== (prevDue || null)) { updates.dueDate = newDueMs; before.dueDate = prevDue; }
        if (quickEdit.sprintId !== (selectedItem as any).sprintId) { updates.sprintId = quickEdit.sprintId || null; before.sprintId = (selectedItem as any).sprintId || null; }
        const newStoryId = typeof quickEdit.storyId === 'string' ? quickEdit.storyId : quickEdit.storyId?.toString() || '';
        const prevStory = (selectedItem as any).storyId || (selectedItem as any).parentId || '';
        if ((newStoryId || '') !== (prevStory || '')) { updates.storyId = newStoryId || null; before.storyId = prevStory || null; }
        const newGoalId = typeof quickEdit.goalId === 'string' ? quickEdit.goalId : quickEdit.goalId?.toString() || '';
        const prevGoal = (selectedItem as any).goalId || '';
        if ((newGoalId || '') !== (prevGoal || '')) { updates.goalId = newGoalId || null; before.goalId = prevGoal || null; }
        if (quickEdit.points !== undefined) {
          const rawPoints = Number(quickEdit.points);
          const normalized = Math.max(1, Math.min(8, Number.isNaN(rawPoints) ? 1 : Math.round(rawPoints)));
          const prevPoints = Number((selectedItem as any).points);
          if (!Number.isFinite(prevPoints) || prevPoints !== normalized) {
            updates.points = normalized;
            before.points = Number.isFinite(prevPoints) ? prevPoints : null;
          }
        }
      } else if (selectedType === 'story') {
        if (quickEdit.sprintId !== (selectedItem as any).sprintId) { updates.sprintId = quickEdit.sprintId || null; before.sprintId = (selectedItem as any).sprintId || null; }
        const newGoalId = typeof quickEdit.goalId === 'string' ? quickEdit.goalId : quickEdit.goalId?.toString() || '';
        const prevGoal = (selectedItem as any).goalId || '';
        if ((newGoalId || '') !== (prevGoal || '')) { updates.goalId = newGoalId || null; before.goalId = prevGoal || null; }
      } else if (selectedType === 'goal') {
        const newParentGoalId = typeof quickEdit.parentGoalId === 'string' ? quickEdit.parentGoalId : quickEdit.parentGoalId?.toString() || '';
        const prevParent = (selectedItem as any).parentGoalId || '';
        if ((newParentGoalId || '') !== (prevParent || '')) { updates.parentGoalId = newParentGoalId || null; before.parentGoalId = prevParent || null; }
      }
      if (Object.keys(updates).length === 0) return;
      await updateItem({ ...selectedItem, ...updates });
      if (currentUser) {
        const refNum = generateReferenceNumber();
        for (const field of Object.keys(updates)) {
          const oldValue = (before as any)[field];
          const newValue = (updates as any)[field];
          if (field === 'status') {
            await ActivityStreamService.logStatusChange(selectedItem.id, selectedType, currentUser.uid, currentUser.email || undefined, oldValue, newValue, undefined, refNum);
          } else if (field === 'sprintId') {
            await ActivityStreamService.logSprintChange(selectedItem.id, (selectedType === 'task' || selectedType === 'story') ? selectedType : 'story', String(oldValue || ''), String(newValue || ''), currentUser.uid, currentUser.email || undefined, undefined, refNum);
          } else {
            await ActivityStreamService.logFieldChange(selectedItem.id, selectedType, currentUser.uid, currentUser.email || undefined, field, oldValue, newValue, undefined, refNum);
          }
        }
      }
    } catch (e) { console.error('[quick-edit] failed', e); }
  };

  const handleSave = async () => {
    try {
      // Track field changes for activity stream
      const changes: Array<{ field: string, oldValue: any, newValue: any }> = [];

      Object.keys(editForm).forEach(key => {
        if (selectedItem && editForm[key] !== selectedItem[key]) {
          changes.push({
            field: key,
            oldValue: selectedItem[key],
            newValue: editForm[key]
          });
        }
      });

      await updateItem(editForm);

      // Log activity for each change
      if (currentUser && selectedItem && selectedType) {
        const referenceNumber = generateReferenceNumber();

        for (const change of changes) {
          if (change.field === 'status') {
            await ActivityStreamService.logStatusChange(
              selectedItem.id,
              selectedType,
              currentUser.uid,
              currentUser.email || undefined,
              change.oldValue,
              change.newValue,
              undefined, // persona can be added if needed
              referenceNumber
            );
          } else if (change.field === 'sprintId') {
            await ActivityStreamService.logSprintChange(
              selectedItem.id,
              selectedType === 'task' || selectedType === 'story' ? selectedType : 'story',
              String(change.oldValue || ''),
              String(change.newValue || ''),
              currentUser.uid,
              currentUser.email || undefined,
              undefined,
              referenceNumber
            );
          } else {
            await ActivityStreamService.logFieldChange(
              selectedItem.id,
              selectedType,
              currentUser.uid,
              currentUser.email || undefined,
              change.field,
              change.oldValue,
              change.newValue,
              undefined,
              referenceNumber
            );
          }
        }
      }

      setIsEditing(false);
    } catch (error) {
      console.error('Error updating item:', error);
    }
  };

  const handleEdit = () => {
    if (onEdit) {
      onEdit(selectedItem, selectedType);
    } else {
      setIsEditing(true);
    }
  };

  const handleDelete = () => {
    setShowDeleteModal(true);
  };

  const confirmDelete = () => {
    if (onDelete) {
      onDelete(selectedItem, selectedType);
    }
    setShowDeleteModal(false);
    hideSidebar();
  };

  const handleAddNote = async () => {
    console.log('Adding note...', {
      hasNote: !!newNote.trim(),
      hasItem: !!selectedItem,
      hasType: !!selectedType,
      hasUser: !!currentUser
    });

    if (!newNote.trim()) {
      alert('Please enter a note');
      return;
    }

    if (!selectedItem || !selectedType) {
      alert('No item selected');
      return;
    }

    if (!currentUser) {
      alert('You must be logged in to add notes');
      return;
    }

    try {
      const referenceNumber = generateReferenceNumber();
      console.log('Calling ActivityStreamService.addNote...', {
        itemId: selectedItem.id,
        itemType: selectedType,
        note: newNote,
        userId: currentUser.uid,
        userEmail: currentUser.email,
        referenceNumber
      });

      await ActivityStreamService.addNote(
        selectedItem.id,
        selectedType,
        newNote,
        currentUser.uid,
        currentUser.email || undefined,
        'personal', // Set default persona to 'personal'
        referenceNumber
      );

      console.log('Note added successfully');
      setNewNote('');
      setShowAddNote(false);
    } catch (error) {
      console.error('Error adding note:', error);
      alert('Failed to add note: ' + (error as Error).message);
    }
  };

  const getGoalForItem = () => {
    if (selectedType === 'goal') {
      return selectedItem as Goal;
    } else if (selectedType === 'story') {
      const story = selectedItem as Story;
      return goals.find(g => g.id === story.goalId);
    } else if (selectedType === 'task') {
      const task = selectedItem as Task;
      const story = stories.find(s => s.id === task.parentId && task.parentType === 'story');
      return story ? goals.find(g => g.id === story.goalId) : null;
    }
    return null;
  };

  const getStoryForTask = () => {
    if (selectedType === 'task') {
      const task = selectedItem as Task;
      return stories.find(s => s.id === task.parentId && task.parentType === 'story');
    }
    return null;
  };

  const goal = getGoalForItem();
  const story = selectedType === 'task' ? getStoryForTask() : (selectedType === 'story' ? selectedItem as Story : null);
  const themeId = goal?.theme != null ? migrateThemeValue(goal.theme as any) : null;
  const themeHex = themeId != null ? getThemeById(themeId).color : '#6b7280';
  const themeColor = themeHex; // use hex for colors/gradients

  const formatDate = (timestamp: any) => {
    if (!timestamp) return 'Not set';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };
  const toDateInput = (value: any): string => {
    if (!value) return '';
    const date = (value && typeof value.toDate === 'function') ? value.toDate() : new Date(value);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  const fromDateInput = (s: string): number | null => {
    if (!s) return null;
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? null : ms;
  };

  const getThemeName = (themeValue: number): string => {
    const themeNames: { [key: number]: string } = {
      1: 'Health',
      2: 'Growth',
      3: 'Wealth',
      4: 'Tribe',
      5: 'Home'
    };
    return themeNames[themeValue] || 'Home';
  };

  const generateReferenceNumber = () => {
    // Prefer canonical ref if present
    if ((selectedItem as any)?.ref) return String((selectedItem as any).ref);
    if (selectedType === 'goal') {
      const g = selectedItem as Goal;
      return `GOAL-${g.id.substring(0, 6).toUpperCase()}`;
    } else if (selectedType === 'story') {
      const s = selectedItem as Story;
      return `STRY-${s.id.substring(0, 6).toUpperCase()}`;
    } else if (selectedType === 'task') {
      const t = selectedItem as Task;
      return `TASK-${t.id.substring(0, 6).toUpperCase()}`;
    }
    return 'N/A';
  };

  const sidebarWidth = getSidebarWidth();

  const deepLink = (() => {
    const base = window.location.origin || '';
    if (selectedType === 'task') {
      const ref = (selectedItem as any).ref || null;
      const id = (selectedItem as any).id;
      return `${base}/tasks/${ref && validateRef(ref, 'task') ? ref : id}`;
    }
    if (selectedType === 'story') {
      const ref = (selectedItem as any).ref || null;
      const id = (selectedItem as any).id;
      return `${base}/stories/${ref && validateRef(ref, 'story') ? ref : id}`;
    }
    if (selectedType === 'goal') {
      const ref = (selectedItem as any).ref || null;
      const id = (selectedItem as any).id;
      return `${base}/goals/${ref && validateRef(ref, 'goal') ? ref : id}`;
    }
    return base;
  })();

  return (
    <>
      <div role="dialog" aria-modal="true"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: sidebarWidth,
          height: '100vh',
          backgroundColor: themeVars.panel,
          boxShadow: '-4px 0 8px rgba(0,0,0,0.1)',
          zIndex: 1000,
          transition: 'width 0.3s ease',
          overflow: 'hidden',
          borderLeft: `3px solid ${themeColor}`
        }}
      >
        {/* Collapse Toggle */}
        <div
          style={{
            position: 'absolute',
            left: '-15px',
            top: '50%',
            transform: 'translateY(-50%)',
            backgroundColor: themeColor,
            color: themeVars.onAccent as string,
            borderRadius: '50%',
            width: '30px',
            height: '30px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
            zIndex: 1001
          }}
          onClick={toggleCollapse}
        >
          {isCollapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </div>

        {/* Collapsed View */}
        {isCollapsed && (
          <div style={{ padding: '20px 10px', textAlign: 'center' }}>
            <div
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '50%',
                backgroundColor: themeColor,
                color: themeVars.onAccent as string,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 10px auto',
                fontSize: '12px',
                fontWeight: '600'
              }}
            >
              {selectedType === 'goal' ? 'G' : selectedType === 'story' ? 'S' : 'T'}
            </div>
            <div style={{ fontSize: '10px', color: themeVars.muted, transform: 'rotate(-90deg)', whiteSpace: 'nowrap' }}>
              {selectedItem.title.substring(0, 15)}
            </div>
          </div>
        )}

        {/* Expanded View */}
        {!isCollapsed && (
          <>
            {/* Header */}
            <div
              style={{
                background: `linear-gradient(180deg, ${hexToRgba(themeHex, 0.18)}, ${hexToRgba(themeHex, 0.10)})`,
                color: themeVars.text as string,
                padding: '20px',
                borderBottom: `1px solid ${themeVars.border}`
              }}
            >
              {/* Close (X) */}
              <button
                onClick={hideSidebar}
                title="Close"
                style={{ position: 'absolute', right: 8, top: 8, border: 'none', background: 'transparent', color: themeVars.muted as string, cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
              {/* Test Mode Indicator */}
              {isTestMode && (
                <div style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  backgroundColor: domainThemePrimaryVar('Health'),
                  color: themeVars.onAccent,
                  padding: '4px 8px',
                  borderRadius: '12px',
                  fontSize: '10px',
                  fontWeight: '700',
                  letterSpacing: '0.5px',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                  zIndex: 1002
                }}>
                  {testModeLabel}
                </div>
              )}

              {/* Large Reference Number */}
              <div style={{
                marginBottom: '16px',
                textAlign: 'center',
                padding: '12px',
                backgroundColor: rgbaCard(0.15),
                borderRadius: '8px',
                border: `2px solid ${themeColor}`
              }}>
                <div style={{ fontSize: '11px', opacity: 0.9, marginBottom: '4px', letterSpacing: '0.5px', color: themeHex }}>
                  REFERENCE
                </div>
                <div style={{
                  fontSize: '24px',
                  fontWeight: '900',
                  fontFamily: 'monospace',
                  letterSpacing: '2px',
                  textShadow: '0 1px 2px rgba(0,0,0,0.15)',
                  color: themeHex
                }}>
                  {generateReferenceNumber()}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h5 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
                  {selectedType === 'goal' ? 'Goal Details' : selectedType === 'story' ? 'Story Details' : 'Task Details'}
                </h5>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button
                    variant="link"
                    size="sm"
                    style={{ color: themeVars.onAccent as string, padding: '4px' }}
                    onClick={() => setShowAddNote(true)}
                    title="Add Note"
                  >
                    <MessageCircle size={16} />
                  </Button>
                  {(selectedType === 'goal' || selectedType === 'story') && (
                    <Button
                      variant="link"
                      size="sm"
                      style={{ color: themeVars.onAccent as string, padding: '4px' }}
                      onClick={() => setShowResearch(true)}
                      title="Open Research"
                    >
                      <BookOpen size={16} />
                    </Button>
                  )}
                  {selectedType === 'story' && (
                    <Button
                      variant="link"
                      size="sm"
                      style={{ color: themeVars.onAccent as string, padding: '4px' }}
                      onClick={async () => {
                        if (!selectedItem?.id) return;
                        setOrchestrating(true);
                        try {
                          const callable = httpsCallable(functions, 'orchestrateStoryPlanning');
                          await callable({ storyId: (selectedItem as any).id });
                          alert('AI story planning complete: tasks created and time scheduled.');
                        } catch (e: any) {
                          alert(e?.message || 'Failed to orchestrate story');
                        } finally {
                          setOrchestrating(false);
                        }
                      }}
                      title="AI Orchestrate Story"
                    >
                      <Wand2 size={16} />
                    </Button>
                  )}
                  {selectedType === 'goal' && (
                    <Button
                      variant="link"
                      size="sm"
                      style={{ color: themeVars.onAccent as string, padding: '4px' }}
                      onClick={() => setShowChat(true)}
                      title="AI Goal Chat"
                    >
                      <MessageSquare size={16} />
                    </Button>
                  )}
                  <Button
                    variant="link"
                    size="sm"
                    style={{ color: themeVars.onAccent as string, padding: '4px' }}
                    onClick={handleEdit}
                  >
                    <Edit3 size={16} />
                  </Button>
                  <Button
                    variant="link"
                    size="sm"
                    style={{ color: themeVars.onAccent as string, padding: '4px' }}
                    onClick={handleDelete}
                  >
                    <Trash2 size={16} />
                  </Button>
                  <Button
                    variant="link"
                    size="sm"
                    style={{ color: themeVars.onAccent as string, padding: '4px' }}
                    onClick={hideSidebar}
                  >
                    <X size={16} />
                  </Button>
                </div>
              </div>

              {/* Theme Inheritance Chain */}
              {goal && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                  <Target size={12} />
                  <span>{goal.title}</span>
                  {story && selectedType === 'task' && (
                    <>
                      <span>→</span>
                      <BookOpen size={12} />
                      <span>{story.title}</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Content */}
            <div style={{ padding: '20px', maxHeight: 'calc(100vh - 160px)', overflow: 'auto' }}>
              {/* Title */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ fontSize: '14px', fontWeight: '500', color: themeVars.text, marginBottom: '6px', display: 'block' }}>
                  Title
                </label>
                {isEditing ? (
                  <Form.Control
                    type="text"
                    value={editForm.title || ''}
                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    style={{ fontSize: '16px', fontWeight: '600' }}
                  />
                ) : (
                  <h4 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: themeVars.text }}>
                    {selectedItem.title}
                  </h4>
                )}
              </div>

              {/* Description */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ fontSize: '14px', fontWeight: '500', color: themeVars.text, marginBottom: '6px', display: 'block' }}>
                  Description
                </label>
                {isEditing ? (
                  <Form.Control
                    as="textarea"
                    rows={4}
                    value={editForm.description || ''}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  />
                ) : (
                  <p style={{ margin: 0, color: themeVars.muted, lineHeight: '1.5' }}>
                    {selectedItem.description || 'No description provided'}
                  </p>
                )}
              </div>

              {/* Status and Priority */}
              <Row style={{ marginBottom: '20px' }}>
                <Col xs={6}>
                  <label style={{ fontSize: '14px', fontWeight: '500', color: themeVars.text, marginBottom: '6px', display: 'block' }}>
                    Status
                  </label>
                  {isEditing ? (
                    <Form.Select
                      value={typeof editForm.status === 'number' ? editForm.status : Number(editForm.status) || 0}
                      onChange={(e) => setEditForm({ ...editForm, status: Number(e.target.value) })}
                    >
                      {selectedType === 'goal' && (
                        <>
                          <option value={0}>New</option>
                          <option value={1}>Work in Progress</option>
                          <option value={3}>Blocked</option>
                          <option value={2}>Complete</option>
                          <option value={4}>Deferred</option>
                        </>
                      )}
                      {selectedType === 'story' && (
                        <>
                          <option value={0}>Backlog</option>
                          <option value={2}>In Progress</option>
                          <option value={4}>Done</option>
                        </>
                      )}
                      {selectedType === 'task' && (
                        <>
                          <option value={0}>To Do</option>
                          <option value={1}>In Progress</option>
                          <option value={2}>Done</option>
                        </>
                      )}
                    </Form.Select>
                  ) : (
                    (() => {
                      const d = getStatusDisplay(selectedType, selectedItem.status);
                      return (
                        <Badge bg={d.variant} style={{ fontSize: '12px', padding: '6px 12px' }}>
                          {d.label}
                        </Badge>
                      );
                    })()
                  )}
                </Col>
                <Col xs={6}>
                  <label style={{ fontSize: '14px', fontWeight: '500', color: themeVars.text, marginBottom: '6px', display: 'block' }}>
                    Priority
                  </label>
                  {isEditing ? (
                    <Form.Select
                      value={editForm.priority || ''}
                      onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}
                    >
                      {selectedType === 'story' ? (
                        <>
                          <option value="P1">P1 - High</option>
                          <option value="P2">P2 - Medium</option>
                          <option value="P3">P3 - Low</option>
                        </>
                      ) : selectedType === 'task' ? (
                        <>
                          <option value="high">High</option>
                          <option value="med">Medium</option>
                          <option value="low">Low</option>
                        </>
                      ) : (
                        <>
                          <option value="high">High</option>
                          <option value="medium">Medium</option>
                          <option value="low">Low</option>
                        </>
                      )}
                    </Form.Select>
                  ) : selectedItem.priority ? (
                    <Badge
                      bg={
                        selectedItem.priority === 1 ? 'danger' :
                          selectedItem.priority === 2 ? 'warning' :
                            'secondary'
                      }
                      style={{ fontSize: '12px', padding: '6px 12px' }}
                    >
                      {selectedItem.priority === 1 ? 'P1 - High' :
                        selectedItem.priority === 2 ? 'P2 - Medium' :
                          selectedItem.priority === 3 ? 'P3 - Low' :
                            'Unknown'}
                    </Badge>
                  ) : (
                    <span style={{ color: '#9ca3af' }}>Not set</span>
                  )}
                </Col>
              </Row>

              {/* Type-specific fields */}
              {selectedType === 'goal' && (
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px', display: 'block' }}>
                    Theme
                  </label>
                  <Badge
                    style={{
                      backgroundColor: themeColor,
                      color: themeVars.onAccent as string,
                      fontSize: '12px',
                      padding: '6px 12px'
                    }}
                  >
                    {(selectedItem as Goal).theme}
                  </Badge>
                </div>
              )}

              {/* Metadata */}
              <div style={{ borderTop: `1px solid ${themeVars.border}`, paddingTop: '20px', marginTop: '20px' }}>
                <h6 style={{ fontSize: '14px', fontWeight: '600', color: themeVars.text, marginBottom: '12px' }}>
                  Metadata
                </h6>

                <div style={{ fontSize: '13px', color: themeVars.muted, lineHeight: '1.6' }}>
                  <div style={{ marginBottom: '8px' }}>
                    <strong>ID:</strong> <code style={{ fontSize: '11px' }}>{selectedItem.id}</code>
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <strong>Created:</strong> {formatDate(selectedItem.createdAt)}
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <strong>Updated:</strong> {formatDate(selectedItem.updatedAt)}
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <strong>Owner:</strong> {selectedItem.ownerUid}
                  </div>
                  <div style={{ marginTop: '12px' }}>
                    <Button size="sm" variant="outline-secondary" onClick={() => { navigator.clipboard?.writeText(deepLink); }}>
                      <LinkIcon size={12} className="me-1" /> Copy Deep Link
                    </Button>
                    <div className="small text-muted" style={{ marginTop: 4, wordBreak: 'break-all' }}>{deepLink}</div>
                  </div>
                </div>
              </div>

              {/* Activity Stream */}
              <div style={{ borderTop: `1px solid ${themeVars.border}`, paddingTop: '20px', marginTop: '20px' }}>
                {/* Quick Edit */}
                <div style={{ marginBottom: '12px', padding: '8px', backgroundColor: rgbaCard(0.06), borderRadius: 6, border: `1px solid ${rgbaCard(0.08)}` }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div>
                      <label className="small" style={{ display: 'block', marginBottom: 4 }}>Status</label>
                      <Form.Select size="sm" value={Number(quickEdit.status ?? (selectedItem as any).status) || 0} onChange={(e) => setQuickEdit((q: any) => ({ ...q, status: Number(e.target.value) }))}>
                        {statusOptions.map(opt => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                      </Form.Select>
                    </div>
                    <div>
                      <label className="small" style={{ display: 'block', marginBottom: 4 }}>Due</label>
                      <Form.Control size="sm" type="date" value={quickEdit.dueDate || ''} onChange={(e) => setQuickEdit((q: any) => ({ ...q, dueDate: e.target.value }))} />
                    </div>
                    {(selectedType === 'task' || selectedType === 'story') && (
                      <div>
                        <label className="small" style={{ display: 'block', marginBottom: 4 }}>Sprint</label>
                        <Form.Select
                          size="sm"
                          value={quickEdit.sprintId || ''}
                          onChange={(e) => setQuickEdit((q: any) => ({ ...q, sprintId: e.target.value || null }))}
                          style={{ minHeight: '31px' }}
                        >
                          <option value="">None</option>
                          {sprints.map(s => (
                            <option key={s.id} value={s.id}>
                              {s.name || s.ref || `Sprint ${s.id.slice(-4)}`}
                            </option>
                          ))}
                        </Form.Select>
                      </div>
                    )}
                    {selectedType === 'task' && (
                      <div>
                        <label className="small" style={{ display: 'block', marginBottom: 4 }}>Story</label>
                        <EntityLookupInput
                          type="story"
                          ownerUid={(selectedItem as any).ownerUid}
                          value={quickEdit.storyId || ''}
                          onSelect={(id) => setQuickEdit((q: any) => ({ ...q, storyId: id || '' }))}
                          placeholder="Search stories…"
                          initialOptions={stories.map((st) => ({ id: st.id, title: st.title, ref: st.ref }))}
                        />
                      </div>
                    )}
                    {(selectedType === 'task' || selectedType === 'story') && (
                      <div>
                        <label className="small" style={{ display: 'block', marginBottom: 4 }}>Goal</label>
                        <EntityLookupInput
                          type="goal"
                          ownerUid={(selectedItem as any).ownerUid}
                          value={quickEdit.goalId || ''}
                          onSelect={(id) => setQuickEdit((q: any) => ({ ...q, goalId: id || '' }))}
                          placeholder="Search goals…"
                          initialOptions={goals.map((g) => ({ id: g.id, title: g.title, ref: (g as any).ref }))}
                        />
                        {linkedGoalId && (
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0 mt-1"
                            onClick={() => navigate(`/goals/${linkedGoalId}`)}
                          >
                            Open goal{linkedGoal ? `: ${linkedGoal.title}` : ''}
                          </Button>
                        )}
                      </div>
                    )}
                    {selectedType === 'task' && (
                      <div>
                        <label className="small" style={{ display: 'block', marginBottom: 4 }}>Points</label>
                        <Form.Control
                          size="sm"
                          type="number"
                          min={1}
                          max={8}
                          value={quickEdit.points ?? ''}
                          onChange={(e) => {
                            const value = Number(e.target.value);
                            const normalized = Math.max(1, Math.min(8, Number.isNaN(value) ? 1 : Math.round(value)));
                            setQuickEdit((q: any) => ({ ...q, points: normalized }));
                          }}
                        />
                      </div>
                    )}
                    {selectedType === 'goal' && (
                      <div>
                        <label className="small" style={{ display: 'block', marginBottom: 4 }}>Parent Goal</label>
                        <EntityLookupInput
                          type="goal"
                          ownerUid={(selectedItem as any).ownerUid}
                          value={quickEdit.parentGoalId || ''}
                          onSelect={(id) => setQuickEdit((q: any) => ({ ...q, parentGoalId: id || '' }))}
                          placeholder="Search goals…"
                          initialOptions={goals
                            .filter((g) => g.id !== (selectedItem as any).id)
                            .map((g) => ({ id: g.id, title: g.title, ref: (g as any).ref }))}
                        />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <label className="small" style={{ display: 'block', marginBottom: 4 }}>Description</label>
                      <Form.Control size="sm" type="text" value={quickEdit.description || ''} onChange={(e) => setQuickEdit((q: any) => ({ ...q, description: e.target.value }))} placeholder="Short description" />
                    </div>
                    <div style={{ alignSelf: 'end' }}>
                      <Button size="sm" variant="primary" onClick={applyQuickEdit}>Apply</Button>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h6 style={{ fontSize: '14px', fontWeight: '600', color: themeHex, margin: 0 }}>
                    Activity Stream
                  </h6>
                  <Button
                    variant="outline-primary"
                    size="sm"
                    onClick={() => setShowAddNote(true)}
                    style={{ padding: '4px 8px', fontSize: '12px' }}
                  >
                    <Plus size={12} style={{ marginRight: '4px' }} />
                    Note
                  </Button>
                </div>

                <div style={{
                  maxHeight: '300px',
                  overflow: 'auto',
                  backgroundColor: themeVars.card,
                  borderRadius: '6px',
                  padding: '8px'
                }}>
                  {activities.length === 0 ? (
                    <div style={{
                      textAlign: 'center',
                      color: themeVars.muted,
                      fontSize: '13px',
                      padding: '20px'
                    }}>
                      No activity yet
                    </div>
                  ) : (
                    <ListGroup variant="flush">
                      {activities.map((activity, index) => (
                        <ListGroup.Item
                          key={activity.id || index}
                          style={{
                            border: 'none',
                            backgroundColor: 'transparent',
                            padding: '8px 0',
                            borderBottom: index < activities.length - 1 ? `1px solid ${themeVars.border}` : 'none',
                            borderLeft: `3px solid ${themeColor}`
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                            <span style={{ fontSize: '16px', marginTop: '2px' }}>
                              {ActivityStreamService.formatActivityIcon(activity.activityType)}
                            </span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '13px', color: themeVars.text, lineHeight: '1.4' }}>
                                {activity.description}
                              </div>
                              {activity.noteContent && (
                                <div style={{
                                  fontSize: '12px',
                                  color: themeVars.muted,
                                  fontStyle: 'italic',
                                  marginTop: '4px',
                                  padding: '6px',
                                  backgroundColor: themeVars.card,
                                  borderRadius: '4px',
                                  border: `1px solid ${themeVars.border}`
                                }}>
                                  "{activity.noteContent}"
                                </div>
                              )}
                              <div style={{ fontSize: '11px', color: themeVars.muted, marginTop: '4px' }}>
                                {ActivityStreamService.formatTimestamp(activity.timestamp)}
                                {activity.userEmail && ` • ${activity.userEmail.split('@')[0]}`}
                              </div>
                            </div>
                          </div>
                        </ListGroup.Item>
                      ))}
                    </ListGroup>
                  )}
                </div>
              </div>

              {/* Save Button */}
              {isEditing && (
                <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: `1px solid ${themeVars.border}` }}>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <Button variant="primary" onClick={handleSave} style={{ flex: 1 }}>
                      <Save size={16} style={{ marginRight: '6px' }} />
                      Save Changes
                    </Button>
                    <Button variant="outline-secondary" onClick={() => setIsEditing(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal show={showDeleteModal} onHide={() => setShowDeleteModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Confirm Delete</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Are you sure you want to delete this {selectedType}? This action cannot be undone.
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDeleteModal(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDelete}>
            Delete
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Add Note Modal */}
      <Modal show={showAddNote} onHide={() => setShowAddNote(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Add Note</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group>
            <Form.Label>Note</Form.Label>
            <Form.Control
              as="textarea"
              rows={4}
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Enter your note here..."
              style={{ resize: 'vertical' }}
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowAddNote(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleAddNote}
            disabled={!newNote.trim()}
          >
            Add Note
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Goal Chat Modal */}
      {selectedType === 'goal' && (
        <GoalChatModal goalId={(selectedItem as any).id} show={showChat} onHide={() => setShowChat(false)} />
      )}

      {/* Research Modal (goal or story) */}
      {showResearch && (
        <ResearchDocModal
          show={showResearch}
          onHide={() => setShowResearch(false)}
          goalId={selectedType === 'goal' ? (selectedItem as any)?.id : undefined}
          storyId={selectedType === 'story' ? (selectedItem as any)?.id : undefined}
        />
      )}
    </>
  );
};

export default GlobalSidebar;
