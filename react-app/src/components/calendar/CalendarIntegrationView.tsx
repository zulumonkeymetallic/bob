import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Container, Row, Col, Card, Button, Modal, Form, Alert, Table, Badge } from 'react-bootstrap';
import { 
  Calendar as CalendarIcon, 
  Plus, 
  RefreshCw, 
  Settings, 
  ExternalLink,
  AlertCircle,
  CheckCircle,
  Clock,
  User,
  MapPin
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { httpsCallable } from 'firebase/functions';
import { collection, doc, getDoc, getDocs, limit, onSnapshot, query, where } from 'firebase/firestore';
import { db, functions, firebaseConfig } from '../../firebase';
import { ActivityStreamService, ActivityEntry } from '../../services/ActivityStreamService';

// BOB v3.5.2 - Calendar Integration
// FTR-03 Implementation - Scaffold with Google Calendar integration

interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  location?: string;
  attendees?: string[];
  calendarId: string;
  isGoalRelated: boolean;
  linkedGoalId?: string;
  linkedStoryId?: string;
  linkedTaskId?: string;
  linkedBlockId?: string;
  calendarMatchSource?: string;
  calendarMatchNote?: string;
  calendarMatchScore?: number;
  calendarMatchConfidence?: number;
  calendarMatchConfidenceTier?: 'high' | 'medium' | 'low';
  source: 'google' | 'outlook' | 'manual';
  recurringPattern?: string;
  reminderMinutes?: number;
}

interface EventLinkContext {
  blockId: string;
  storyId?: string;
  taskId?: string;
  goalId?: string;
  calendarMatchSource?: string;
  calendarMatchNote?: string;
  calendarMatchScore?: number;
  calendarMatchConfidence?: number;
  calendarMatchConfidenceTier?: 'high' | 'medium' | 'low';
}

interface RelinkCandidate {
  kind: 'story' | 'task';
  id: string;
  title: string;
  score: number;
  storyId?: string;
}

interface CalendarConfig {
  googleCalendarEnabled: boolean;
  outlookCalendarEnabled: boolean;
  defaultCalendarId: string;
  syncInterval: number; // minutes
  autoCreateTasksFromEvents: boolean;
  reminderSettings: {
    defaultMinutes: number;
    enableEmailReminders: boolean;
    enablePushNotifications: boolean;
  };
}

interface Goal {
  id: string;
  title: string;
  theme: string;
}

interface Story {
  id: string;
  title: string;
  goalId: string;
}

interface Task {
  id: string;
  title: string;
  storyId: string;
  estimatedHours?: number;
}

const CalendarIntegrationView: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  
  // State management
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [config, setConfig] = useState<CalendarConfig>({
    googleCalendarEnabled: false,
    outlookCalendarEnabled: false,
    defaultCalendarId: '',
    syncInterval: 15,
    autoCreateTasksFromEvents: false,
    reminderSettings: {
      defaultMinutes: 15,
      enableEmailReminders: true,
      enablePushNotifications: true
    }
  });
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [gcalConnected, setGcalConnected] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [chainStatus, setChainStatus] = useState<'idle'|'running'|'ok'|'error'>('idle');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewType, setViewType] = useState<'day' | 'week' | 'month'>('week');
  const [auditEntries, setAuditEntries] = useState<ActivityEntry[]>([]);
  const [auditFilter, setAuditFilter] = useState<'all' | 'created' | 'updated' | 'deleted' | 'calendar_sync'>('all');
  const [eventLinkContext, setEventLinkContext] = useState<Record<string, EventLinkContext>>({});
  const [overrideEvent, setOverrideEvent] = useState<CalendarEvent | null>(null);
  const [overrideStoryId, setOverrideStoryId] = useState('');
  const [overrideTaskId, setOverrideTaskId] = useState('');
  const [overrideNote, setOverrideNote] = useState('');
  const [overrideBusy, setOverrideBusy] = useState(false);
  // Event modal refs (simple approach without full controlled form)
  const titleRef = useRef<HTMLInputElement | null>(null);
  const descRef = useRef<HTMLTextAreaElement | null>(null);
  const startRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLInputElement | null>(null);
  const calRef = useRef<HTMLSelectElement | null>(null);
  
  // Load status + dummy data for initial render
  useEffect(() => {
    refreshCalendarStatus();
    loadDummyData();
    // Subscribe to recent user activity for calendar
    if (currentUser) {
      const unsub = ActivityStreamService.subscribeToUserActivityStream(currentUser.uid, (items) => {
        const filtered = items.filter((a) => (a.entityType === 'calendar_block' || String(a.activityType).includes('calendar')));
        setAuditEntries(filtered);
      }, 50);
      return () => { try { unsub(); } catch {} };
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const userRef = doc(db, 'users', currentUser.uid);
    const unsub = onSnapshot(userRef, (snap) => {
      if (!snap.exists()) return;
      const data: any = snap.data();
      setGcalConnected(Boolean(data?.googleCalendarTokens));
    });
    return () => { try { unsub(); } catch {} };
  }, [currentUser]);

  useEffect(() => {
    setConfig((prev) => ({ ...prev, googleCalendarEnabled: gcalConnected }));
  }, [gcalConnected]);

  const refreshCalendarStatus = async () => {
    if (!currentUser) return;
    let connected = gcalConnected;
    try {
      const statusFn = httpsCallable(functions, 'calendarStatus');
      const res: any = await statusFn({});
      connected = !!res?.data?.connected;
    } catch (e) {
      // Non-fatal if status isn't available
      console.warn('calendarStatus failed', e);
    }
    if (!connected) {
      try {
        const snap = await getDoc(doc(db, 'users', currentUser.uid));
        connected = snap.exists() && !!(snap.data() as any)?.googleCalendarTokens;
      } catch { /* ignore */ }
    }
    setGcalConnected(connected);
    setConfig(prev => ({ ...prev, googleCalendarEnabled: connected }));
  };

  const getOauthStartUrl = () => {
    const projectId = firebaseConfig.projectId || 'bob20250810';
    return `https://europe-west2-${projectId}.cloudfunctions.net/oauthStart`;
  };
  
  const loadDummyData = () => {
    // Dummy goals, stories, tasks
    const dummyGoals: Goal[] = [
      { id: 'goal-1', title: 'Complete Marathon Training', theme: 'Health' },
      { id: 'goal-2', title: 'Launch Side Business', theme: 'Wealth' }
    ];
    
    const dummyStories: Story[] = [
      { id: 'story-1', title: 'Build base mileage', goalId: 'goal-1' },
      { id: 'story-2', title: 'Market research', goalId: 'goal-2' }
    ];
    
    const dummyTasks: Task[] = [
      { id: 'task-1', title: 'Run 3x per week', storyId: 'story-1' },
      { id: 'task-2', title: 'Competitor analysis', storyId: 'story-2' }
    ];
    
    // Dummy calendar events
    const dummyEvents: CalendarEvent[] = [
      {
        id: 'event-1',
        title: 'Morning Run - 5 miles',
        description: 'Weekly training run',
        startTime: new Date('2025-09-02T06:00:00'),
        endTime: new Date('2025-09-02T07:00:00'),
        location: 'Central Park',
        calendarId: 'primary',
        isGoalRelated: true,
        linkedGoalId: 'goal-1',
        linkedStoryId: 'story-1',
        linkedTaskId: 'task-1',
        source: 'google',
        recurringPattern: 'Weekly on Monday, Wednesday, Friday',
        reminderMinutes: 30
      },
      {
        id: 'event-2',
        title: 'Customer Interview #3',
        description: 'Interview with potential customers for market research',
        startTime: new Date('2025-09-02T14:00:00'),
        endTime: new Date('2025-09-02T15:00:00'),
        attendees: ['customer@example.com'],
        calendarId: 'primary',
        isGoalRelated: true,
        linkedGoalId: 'goal-2',
        linkedStoryId: 'story-2',
        linkedTaskId: 'task-2',
        source: 'google',
        reminderMinutes: 15
      },
      {
        id: 'event-3',
        title: 'Team Standup',
        startTime: new Date('2025-09-02T09:00:00'),
        endTime: new Date('2025-09-02T09:30:00'),
        calendarId: 'work',
        isGoalRelated: false,
        source: 'outlook',
        reminderMinutes: 5
      }
    ];
    
    setGoals(dummyGoals);
    setStories(dummyStories);
    setTasks(dummyTasks);
    setEvents(dummyEvents);
    
    // Mock last sync
    setLastSyncTime(new Date());
  };
  
  // Calendar sync functions
  const handleGoogleCalendarAuth = async () => {
    if (!currentUser) return;
    const nonce = Math.random().toString(36).slice(2);
    const url = `${getOauthStartUrl()}?uid=${encodeURIComponent(currentUser.uid)}&nonce=${encodeURIComponent(nonce)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    // Refresh status shortly after
    setTimeout(() => { refreshCalendarStatus(); }, 5000);
  };

  const createOrUpdateEvent = async () => {
    if (!currentUser) return;
    const summary = titleRef.current?.value?.trim() || 'New Event';
    const start = startRef.current?.value ? new Date(startRef.current.value).toISOString() : new Date().toISOString();
    const end = endRef.current?.value ? new Date(endRef.current.value).toISOString() : new Date(Date.now() + 60*60*1000).toISOString();
    try {
      if (selectedEvent) {
        const updateFn = httpsCallable(functions, 'updateCalendarEvent');
        await updateFn({ eventId: selectedEvent.id, summary, start, end });
      } else {
        const createFn = httpsCallable(functions, 'createCalendarEvent');
        await createFn({ summary, start, end });
      }
      await loadUpcomingFromGoogle();
      setShowEventModal(false);
    } catch (e) {
      console.error('create/update event failed', e);
      alert('Failed to save event');
    }
  };

  const deleteEvent = async () => {
    if (!currentUser || !selectedEvent) return;
    try {
      const delFn = httpsCallable(functions, 'deleteCalendarEvent');
      await delFn({ eventId: selectedEvent.id });
      await loadUpcomingFromGoogle();
      setShowEventModal(false);
    } catch (e) {
      console.error('delete event failed', e);
      alert('Failed to delete event');
    }
  };
  
  const handleOutlookCalendarAuth = async () => {
    setSyncStatus('syncing');
    
    try {
      // Mock Outlook Calendar OAuth flow
      console.log('🔗 Initiating Outlook Calendar OAuth...');
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setConfig(prev => ({ ...prev, outlookCalendarEnabled: true }));
      setSyncStatus('success');
      
    } catch (error) {
      console.error('❌ Outlook Calendar auth failed:', error);
      setSyncStatus('error');
    }
  };
  
  const syncCalendars = async () => {
    if (!currentUser) return;
    if (!gcalConnected) {
      setSyncStatus('idle');
      alert('Connect Google Calendar before syncing.');
      return;
    }
    setSyncStatus('syncing');
    try {
      const syncFn = httpsCallable(functions, 'syncCalendarNow');
      await syncFn({});
      await loadUpcomingFromGoogle();
      setLastSyncTime(new Date());
      setSyncStatus('success');
    } catch (error) {
      console.error('❌ Calendar sync failed:', error);
      setSyncStatus('error');
    }
  };

  const runNightlyChain = async () => {
    if (!currentUser) return;
    setChainStatus('running');
    try {
      const fn = httpsCallable(functions, 'runNightlyChainNow');
      await fn({});
      setChainStatus('ok');
      setTimeout(() => setChainStatus('idle'), 3000);
    } catch (err) {
      console.error('runNightlyChainNow failed', err);
      setChainStatus('error');
      setTimeout(() => setChainStatus('idle'), 4000);
    }
  };

  const loadUpcomingFromGoogle = async () => {
    try {
      const listFn = httpsCallable(functions, 'listUpcomingEvents');
      // derive range from selectedDate + viewType
      const start = new Date(selectedDate);
      const end = new Date(selectedDate);
      if (viewType === 'day') {
        start.setHours(0,0,0,0); end.setHours(23,59,59,999);
      } else if (viewType === 'week') {
        start.setDate(start.getDate() - start.getDay());
        start.setHours(0,0,0,0);
        end.setDate(start.getDate() + 6);
        end.setHours(23,59,59,999);
      } else {
        start.setDate(1); start.setHours(0,0,0,0);
        end.setMonth(start.getMonth()+1, 0); end.setHours(23,59,59,999);
      }
      const res: any = await listFn({ maxResults: 250, timeMin: start.toISOString(), timeMax: end.toISOString() });
      const items = Array.isArray(res?.data?.items) ? res.data.items : [];
      const mapped: CalendarEvent[] = items.map((ev: any) => ({
        id: ev.id,
        title: ev.summary || 'Event',
        description: ev.description || '',
        startTime: new Date(ev.start?.dateTime || ev.start?.date),
        endTime: new Date(ev.end?.dateTime || ev.end?.date),
        calendarId: 'primary',
        isGoalRelated: !!(ev.extendedProperties?.private?.['bob-block-id'] || ev.extendedProperties?.private?.['bob-goal-id']),
        linkedGoalId: ev.extendedProperties?.private?.['bob-goal-id'] || undefined,
        linkedStoryId: ev.extendedProperties?.private?.['bob-story-id'] || undefined,
        linkedTaskId: ev.extendedProperties?.private?.['bob-task-id'] || undefined,
        linkedBlockId: ev.extendedProperties?.private?.['bob-block-id'] || undefined,
        calendarMatchSource: ev.extendedProperties?.private?.['bob-match-source'] || undefined,
        calendarMatchNote: ev.extendedProperties?.private?.['bob-match-note'] || undefined,
        calendarMatchScore: Number.isFinite(Number(ev.extendedProperties?.private?.['bob-match-score'])) ? Number(ev.extendedProperties?.private?.['bob-match-score']) : undefined,
        calendarMatchConfidence: Number.isFinite(Number(ev.extendedProperties?.private?.['bob-match-confidence'])) ? Number(ev.extendedProperties?.private?.['bob-match-confidence']) : undefined,
        calendarMatchConfidenceTier: ev.extendedProperties?.private?.['bob-match-tier'] || undefined,
        source: 'google',
        reminderMinutes: undefined,
      }));
      setEvents(prev => {
        // Replace events with latest pull to avoid stale dummy data
        return mapped;
      });
    } catch (e) {
      console.warn('listUpcomingEvents failed', e);
    }
  };

  useEffect(() => {
    if (!currentUser || !gcalConnected) return;
    loadUpcomingFromGoogle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, viewType]);

  const loadEventLinkContext = async (eventList: CalendarEvent[]) => {
    if (!currentUser || eventList.length === 0) {
      setEventLinkContext({});
      return;
    }

    const googleEvents = eventList.filter((event) => event.source === 'google' && event.id);
    if (googleEvents.length === 0) {
      setEventLinkContext({});
      return;
    }

    const contextEntries = await Promise.all(
      googleEvents.map(async (event) => {
        try {
          const q = query(
            collection(db, 'calendar_blocks'),
            where('ownerUid', '==', currentUser.uid),
            where('googleEventId', '==', event.id),
            limit(1)
          );
          const snap = await getDocs(q);
          if (snap.empty) return null;
          const docSnap = snap.docs[0];
          const block: any = docSnap.data() || {};
          const ctx: EventLinkContext = {
            blockId: docSnap.id,
            storyId: block.storyId || block.linkedStoryId || undefined,
            taskId: block.taskId || undefined,
            goalId: block.goalId || undefined,
            calendarMatchSource: block.calendarMatchSource || undefined,
            calendarMatchNote: block.calendarMatchNote || undefined,
            calendarMatchScore: Number.isFinite(Number(block.calendarMatchScore)) ? Number(block.calendarMatchScore) : undefined,
            calendarMatchConfidence: Number.isFinite(Number(block.calendarMatchConfidence)) ? Number(block.calendarMatchConfidence) : undefined,
            calendarMatchConfidenceTier: block.calendarMatchConfidenceTier || undefined,
          };
          return [event.id, ctx] as const;
        } catch (error) {
          console.warn('Failed to load event link context', event.id, error);
          return null;
        }
      })
    );

    const mapped = Object.fromEntries(contextEntries.filter((entry): entry is readonly [string, EventLinkContext] => Boolean(entry)));
    setEventLinkContext(mapped);
  };

  const openOverrideModal = (event: CalendarEvent) => {
    const context = eventLinkContext[event.id];
    setOverrideEvent(event);
    setOverrideStoryId(context?.storyId || event.linkedStoryId || '');
    setOverrideTaskId(context?.taskId || event.linkedTaskId || '');
    setOverrideNote(context?.calendarMatchNote || event.calendarMatchNote || '');
    setShowOverrideModal(true);
  };

  const applyManualOverride = async () => {
    if (!overrideEvent) return;
    setOverrideBusy(true);
    try {
      const fn = httpsCallable(functions, 'gcalOverrideEventLink');
      const payload: any = {
        eventId: overrideEvent.id,
        storyId: overrideStoryId || null,
        taskId: overrideTaskId || null,
        note: overrideNote || null,
      };
      const res: any = await fn(payload);
      const data: any = res?.data || {};

      setEvents((prev) => prev.map((event) => {
        if (event.id !== overrideEvent.id) return event;
        return {
          ...event,
          isGoalRelated: Boolean(data.storyId || data.taskId || event.linkedGoalId),
          linkedStoryId: data.storyId || undefined,
          linkedTaskId: data.taskId || undefined,
          linkedGoalId: data.goalId || event.linkedGoalId,
          linkedBlockId: data.blockId || event.linkedBlockId,
          calendarMatchSource: data.calendarMatchSource || 'manual_override',
          calendarMatchNote: data.calendarMatchNote || overrideNote || undefined,
          calendarMatchConfidence: Number.isFinite(Number(data.calendarMatchConfidence)) ? Number(data.calendarMatchConfidence) : undefined,
          calendarMatchConfidenceTier: data.calendarMatchConfidenceTier || undefined,
        };
      }));

      setEventLinkContext((prev) => ({
        ...prev,
        [overrideEvent.id]: {
          blockId: data.blockId || prev[overrideEvent.id]?.blockId || '',
          storyId: data.storyId || undefined,
          taskId: data.taskId || undefined,
          goalId: data.goalId || undefined,
          calendarMatchSource: data.calendarMatchSource || 'manual_override',
          calendarMatchNote: data.calendarMatchNote || overrideNote || undefined,
          calendarMatchConfidence: Number.isFinite(Number(data.calendarMatchConfidence)) ? Number(data.calendarMatchConfidence) : undefined,
          calendarMatchConfidenceTier: data.calendarMatchConfidenceTier || undefined,
        },
      }));

      setShowOverrideModal(false);
      setOverrideEvent(null);
    } catch (error) {
      console.error('Manual override failed', error);
      alert('Unable to update link. Please try again.');
    } finally {
      setOverrideBusy(false);
    }
  };

  const applyRelinkCandidate = async (candidate: RelinkCandidate) => {
    if (!overrideEvent) return;
    setOverrideStoryId(candidate.kind === 'story' ? candidate.id : (candidate.storyId || ''));
    setOverrideTaskId(candidate.kind === 'task' ? candidate.id : '');
    setOverrideNote(`Quick relink from title match (${Math.round(candidate.score * 100)}%)`);
    setOverrideBusy(true);
    try {
      const fn = httpsCallable(functions, 'gcalOverrideEventLink');
      const payload: any = {
        eventId: overrideEvent.id,
        storyId: candidate.kind === 'story' ? candidate.id : (candidate.storyId || null),
        taskId: candidate.kind === 'task' ? candidate.id : null,
        note: `Quick relink from title match (${Math.round(candidate.score * 100)}%)`,
      };
      const res: any = await fn(payload);
      const data: any = res?.data || {};

      setEvents((prev) => prev.map((event) => {
        if (event.id !== overrideEvent.id) return event;
        return {
          ...event,
          isGoalRelated: Boolean(data.storyId || data.taskId || event.linkedGoalId),
          linkedStoryId: data.storyId || undefined,
          linkedTaskId: data.taskId || undefined,
          linkedGoalId: data.goalId || event.linkedGoalId,
          linkedBlockId: data.blockId || event.linkedBlockId,
          calendarMatchSource: data.calendarMatchSource || 'manual_override',
          calendarMatchNote: data.calendarMatchNote || `Quick relink from title match (${Math.round(candidate.score * 100)}%)`,
          calendarMatchConfidence: Number.isFinite(Number(data.calendarMatchConfidence)) ? Number(data.calendarMatchConfidence) : undefined,
          calendarMatchConfidenceTier: data.calendarMatchConfidenceTier || undefined,
        };
      }));

      setEventLinkContext((prev) => ({
        ...prev,
        [overrideEvent.id]: {
          blockId: data.blockId || prev[overrideEvent.id]?.blockId || '',
          storyId: data.storyId || undefined,
          taskId: data.taskId || undefined,
          goalId: data.goalId || undefined,
          calendarMatchSource: data.calendarMatchSource || 'manual_override',
          calendarMatchNote: data.calendarMatchNote || `Quick relink from title match (${Math.round(candidate.score * 100)}%)`,
          calendarMatchConfidence: Number.isFinite(Number(data.calendarMatchConfidence)) ? Number(data.calendarMatchConfidence) : undefined,
          calendarMatchConfidenceTier: data.calendarMatchConfidenceTier || undefined,
        },
      }));

      setShowOverrideModal(false);
      setOverrideEvent(null);
    } catch (error) {
      console.error('Quick relink failed', error);
      alert('Unable to quick relink. Please try again.');
    } finally {
      setOverrideBusy(false);
    }
  };
  
  // Event linking functions
  const linkEventToGoal = (eventId: string, goalId: string, storyId?: string, taskId?: string) => {
    setEvents(prev => prev.map(event => 
      event.id === eventId 
        ? { 
            ...event, 
            isGoalRelated: true, 
            linkedGoalId: goalId,
            linkedStoryId: storyId,
            linkedTaskId: taskId
          }
        : event
    ));
    
    // Log activity
    console.log('🔗 Event linked to goal:', { eventId, goalId, storyId, taskId });
  };
  
  const createTaskFromEvent = (event: CalendarEvent) => {
    const newTask: Task = {
      id: `task-from-event-${event.id}`,
      title: `${event.title} (from calendar)`,
      storyId: event.linkedStoryId || ''
    };
    
    setTasks(prev => [...prev, newTask]);
    
    // Link the event to the new task
    linkEventToGoal(event.id, event.linkedGoalId || '', event.linkedStoryId, newTask.id);
    
    console.log('📝 Task created from event:', newTask);
  };
  
  // Event creation/editing
  const createCalendarEvent = (eventData: Partial<CalendarEvent>) => {
    const newEvent: CalendarEvent = {
      id: `event-${Date.now()}`,
      title: eventData.title || 'New Event',
      startTime: eventData.startTime || new Date(),
      endTime: eventData.endTime || new Date(Date.now() + 60 * 60 * 1000), // 1 hour default
      calendarId: eventData.calendarId || config.defaultCalendarId,
      isGoalRelated: eventData.isGoalRelated || false,
      source: 'manual',
      reminderMinutes: config.reminderSettings.defaultMinutes,
      ...eventData
    };
    
    setEvents(prev => [...prev, newEvent]);
    console.log('✨ Calendar event created:', newEvent);
  };
  
  // Get events for selected date/view
  const getEventsForView = () => {
    const viewStart = new Date(selectedDate);
    const viewEnd = new Date(selectedDate);
    
    switch (viewType) {
      case 'day':
        viewEnd.setDate(viewStart.getDate() + 1);
        break;
      case 'week':
        viewStart.setDate(viewStart.getDate() - viewStart.getDay());
        viewEnd.setDate(viewStart.getDate() + 7);
        break;
      case 'month':
        viewStart.setDate(1);
        viewEnd.setMonth(viewStart.getMonth() + 1);
        viewEnd.setDate(0);
        break;
    }
    
    return events.filter(event => 
      event.startTime >= viewStart && event.startTime <= viewEnd
    ).sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  };
  
  const filteredEvents = getEventsForView();

  useEffect(() => {
    loadEventLinkContext(filteredEvents);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, filteredEvents.map((event) => event.id).join('|')]);

  const confidenceVariant = (tier?: string) => {
    if (tier === 'high') return 'success';
    if (tier === 'medium') return 'warning';
    if (tier === 'low') return 'secondary';
    return 'light';
  };

  const confidenceLabel = (event: CalendarEvent) => {
    const ctx = eventLinkContext[event.id];
    const value = ctx?.calendarMatchConfidence ?? event.calendarMatchConfidence;
    const tier = ctx?.calendarMatchConfidenceTier ?? event.calendarMatchConfidenceTier;
    if (!Number.isFinite(Number(value))) return null;
    return { value: Number(value), tier: tier || 'low' };
  };

  const rationaleLabel = (event: CalendarEvent) => {
    const ctx = eventLinkContext[event.id];
    return ctx?.calendarMatchNote || event.calendarMatchNote || null;
  };

  const overrideCandidates = useMemo<RelinkCandidate[]>(() => {
    if (!overrideEvent) return [];
    const source = String(overrideEvent.title || '').toLowerCase().trim();
    if (!source) return [];

    const words = source.split(/\s+/).filter((w) => w.length > 2);
    const score = (title: string) => {
      const targetWords = String(title || '').toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      if (!targetWords.length || !words.length) return 0;
      const overlap = words.filter((w) => targetWords.includes(w)).length;
      return overlap / Math.max(words.length, targetWords.length);
    };

    const storyCandidates: RelinkCandidate[] = stories
      .map((story) => ({ kind: 'story' as const, id: story.id, title: story.title, score: score(story.title) }))
      .filter((item) => item.score > 0.2);

    const taskCandidates: RelinkCandidate[] = tasks
      .map((task) => ({ kind: 'task' as const, id: task.id, title: task.title, score: score(task.title), storyId: task.storyId || undefined }))
      .filter((item) => item.score > 0.2);

    return [...storyCandidates, ...taskCandidates]
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
  }, [overrideEvent, stories, tasks]);
  
  // Theme colors
  const themeColors = {
    Health: '#ef4444',
    Growth: '#10b981', 
    Wealth: '#f59e0b',
    Tribe: '#8b5cf6',
    Home: '#06b6d4'
  };
  
  return (
    <Container fluid className="calendar-integration">
      <Row className="mb-3">
        <Col>
          <div className="d-flex justify-content-between align-items-center">
            <h2>Calendar Integration</h2>
            <div className="d-flex gap-2">
              <Button 
                variant="outline-secondary" 
                size="sm"
                onClick={syncCalendars}
                disabled={syncStatus === 'syncing' || !gcalConnected}
              >
                <RefreshCw size={16} className={syncStatus === 'syncing' ? 'spinning' : ''} />
                {syncStatus === 'syncing' ? 'Syncing...' : 'Sync now'}
              </Button>
              <Button
                variant="outline-primary"
                size="sm"
                onClick={runNightlyChain}
                disabled={chainStatus === 'running'}
              >
                {chainStatus === 'running' ? 'Running nightly…' : 'Run nightly chain'}
              </Button>
              <Button 
                variant="outline-secondary" 
                size="sm"
                onClick={() => setShowConfigModal(true)}
              >
                <Settings size={16} />
              </Button>
              <Button 
                variant="primary" 
                size="sm"
                onClick={() => {
                  setSelectedEvent(null);
                  setShowEventModal(true);
                }}
              >
                <Plus size={16} />
                New Event
              </Button>
            </div>
          </div>
          {lastSyncTime && (
            <small className="text-muted">
              Last synced: {lastSyncTime.toLocaleString()}
            </small>
          )}
        </Col>
      </Row>

      {!gcalConnected && (
        <Alert variant="warning" className="mb-3">
          <AlertCircle size={16} className="me-2" />
          Google Calendar is not connected. Connect to enable push/pull sync.
        </Alert>
      )}

      {/* Sync Status Alert */}
      {syncStatus === 'error' && (
        <Alert variant="danger" className="mb-3">
          <AlertCircle size={16} className="me-2" />
          Calendar sync failed. Please check your connection and try again.
        </Alert>
      )}
      
      {syncStatus === 'success' && (
        <Alert variant="success" className="mb-3" dismissible>
          <CheckCircle size={16} className="me-2" />
          Calendar sync completed successfully.
        </Alert>
      )}
      
      {/* Calendar View Controls */}
      <Row className="mb-3">
        <Col md={6}>
          <div className="d-flex gap-2">
            <Button 
              variant={viewType === 'day' ? 'primary' : 'outline-primary'} 
              size="sm"
              onClick={() => setViewType('day')}
            >
              Day
            </Button>
            <Button 
              variant={viewType === 'week' ? 'primary' : 'outline-primary'} 
              size="sm"
              onClick={() => setViewType('week')}
            >
              Week
            </Button>
            <Button 
              variant={viewType === 'month' ? 'primary' : 'outline-primary'} 
              size="sm"
              onClick={() => setViewType('month')}
            >
              Month
            </Button>
          </div>
        </Col>
        <Col md={6}>
          <Form.Control 
            type="date" 
            value={selectedDate.toISOString().split('T')[0]}
            onChange={(e) => setSelectedDate(new Date(e.target.value))}
          />
        </Col>
      </Row>
      
      {/* Events List */}
      <Row>
        <Col md={8}>
          <Card>
            <Card.Header>
              <h5>
                <CalendarIcon size={20} className="me-2" />
                Events for {selectedDate.toLocaleDateString()}
              </h5>
            </Card.Header>
            <Card.Body>
              {filteredEvents.length === 0 ? (
                <p className="text-muted">No events found for this period.</p>
              ) : (
                <Table responsive>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Event</th>
                      <th>Calendar</th>
                      <th>Goal Link</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEvents.map(event => {
                      const linkedGoal = goals.find(g => g.id === event.linkedGoalId);
                      const linkedStory = stories.find(s => s.id === event.linkedStoryId);
                      const confidence = confidenceLabel(event);
                      const rationale = rationaleLabel(event);
                      
                      return (
                        <tr key={event.id}>
                          <td>
                            <div className="d-flex flex-column">
                              <strong>{event.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
                              <small className="text-muted">
                                {event.endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </small>
                            </div>
                          </td>
                          <td>
                            <div>
                              <strong>{event.title}</strong>
                              {event.description && (
                                <div className="text-muted small">{event.description}</div>
                              )}
                              {event.location && (
                                <div className="text-muted small">
                                  <MapPin size={12} className="me-1" />
                                  {event.location}
                                </div>
                              )}
                            </div>
                          </td>
                          <td>
                            <Badge bg={event.source === 'google' ? 'primary' : event.source === 'outlook' ? 'info' : 'secondary'}>
                              {event.source}
                            </Badge>
                            <div className="small text-muted">{event.calendarId}</div>
                          </td>
                          <td>
                            {event.isGoalRelated ? (
                              <div>
                                {linkedGoal && (
                                  <Badge 
                                    bg="success" 
                                    style={{ 
                                      backgroundColor: themeColors[linkedGoal.theme as keyof typeof themeColors] 
                                    }}
                                  >
                                    {linkedGoal.title}
                                  </Badge>
                                )}
                                {linkedStory && (
                                  <div className="small text-muted mt-1">
                                    Story: {linkedStory.title}
                                  </div>
                                )}
                                {confidence && (
                                  <div className="mt-1">
                                    <Badge bg={confidenceVariant(confidence.tier)}>
                                      Match {confidence.value}% ({confidence.tier})
                                    </Badge>
                                  </div>
                                )}
                                {rationale && (
                                  <div className="small text-muted mt-1">{rationale}</div>
                                )}
                              </div>
                            ) : (
                              <Button 
                                variant="outline-secondary" 
                                size="sm"
                                onClick={() => openOverrideModal(event)}
                              >
                                Link to Goal
                              </Button>
                            )}
                          </td>
                          <td>
                            <div className="d-flex gap-1">
                              <Button 
                                variant="outline-secondary" 
                                size="sm"
                                onClick={() => {
                                  setSelectedEvent(event);
                                  setShowEventModal(true);
                                }}
                              >
                                Edit
                              </Button>
                              {event.isGoalRelated && !event.linkedTaskId && (
                                <Button 
                                  variant="outline-success" 
                                  size="sm"
                                  onClick={() => createTaskFromEvent(event)}
                                >
                                  Create Task
                                </Button>
                              )}
                              <Button
                                variant="outline-primary"
                                size="sm"
                                onClick={() => openOverrideModal(event)}
                              >
                                Override Link
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>
        </Col>
        
        {/* Calendar Status Sidebar */}
        <Col md={4}>
          <Card className="mb-3">
            <Card.Header>
              <h6>Calendar Status</h6>
            </Card.Header>
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <span>Google Calendar</span>
                {gcalConnected ? (
                  <div className="d-flex gap-2 align-items-center">
                    <Badge bg="success">Connected</Badge>
                    <Button size="sm" variant="outline-danger" onClick={async ()=>{
                      try {
                        const fn = httpsCallable(functions, 'disconnectGoogle');
                        await fn({});
                        await refreshCalendarStatus();
                      } catch (e) {
                        console.warn('disconnect failed', e);
                      }
                    }}>Disconnect</Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline-primary" onClick={handleGoogleCalendarAuth}>
                    Connect
                  </Button>
                )}
              </div>
              
              <div className="d-flex justify-content-between align-items-center mb-2">
                <span>Outlook Calendar</span>
                {config.outlookCalendarEnabled ? (
                  <Badge bg="success">Connected</Badge>
                ) : (
                  <Button size="sm" variant="outline-primary" onClick={handleOutlookCalendarAuth}>
                    Connect
                  </Button>
                )}
              </div>
              
              <hr />
              
              <div className="small text-muted">
                <div>Sync Interval: {config.syncInterval} minutes</div>
                <div>Auto-create Tasks: {config.autoCreateTasksFromEvents ? 'Enabled' : 'Disabled'}</div>
                <div>Default Reminder: {config.reminderSettings.defaultMinutes} minutes</div>
              </div>
            </Card.Body>
          </Card>
          
          <Card>
            <Card.Header>
              <h6>Goal-Related Events</h6>
            </Card.Header>
            <Card.Body>
              {events.filter(e => e.isGoalRelated).length === 0 ? (
                <p className="text-muted small">No goal-related events yet.</p>
              ) : (
                events
                  .filter(e => e.isGoalRelated)
                  .slice(0, 5)
                  .map(event => {
                    const linkedGoal = goals.find(g => g.id === event.linkedGoalId);
                    return (
                      <div key={event.id} className="mb-2 p-2 border rounded">
                        <div className="small">
                          <strong>{event.title}</strong>
                          <div className="text-muted">
                            {event.startTime.toLocaleDateString()} at {event.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                          {linkedGoal && (
                            <Badge 
                              bg="primary" 
                              style={{ 
                                backgroundColor: themeColors[linkedGoal.theme as keyof typeof themeColors] 
                              }}
                            >
                              {linkedGoal.title}
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })
              )}
            </Card.Body>
          </Card>

          {/* Calendar/Planner Audit */}
          <Card>
            <Card.Header className="d-flex justify-content-between align-items-center">
              <h6 className="mb-0">Recent Calendar Activity</h6>
              <Form.Select size="sm" style={{ maxWidth: 180 }} value={auditFilter} onChange={(e)=>setAuditFilter(e.target.value as any)}>
                <option value="all">All</option>
                <option value="created">Created</option>
                <option value="updated">Updated</option>
                <option value="deleted">Deleted</option>
                <option value="calendar_sync">Sync</option>
              </Form.Select>
            </Card.Header>
            <Card.Body style={{ maxHeight: 300, overflow: 'auto' }}>
              {auditEntries.filter(e => auditFilter==='all' || String(e.activityType)===auditFilter).slice(0,20).map((e) => (
                <div key={e.id} className="border-bottom py-2">
                  <div style={{ fontSize: 13 }}>
                    <Badge bg="light" text="dark" className="me-1">{String(e.activityType)}</Badge>
                    <span>{e.description}</span>
                  </div>
                  <div className="text-muted" style={{ fontSize: 11 }}>
                    {ActivityStreamService.formatTimestamp(e.timestamp)}{e.userEmail ? ` • ${e.userEmail.split('@')[0]}` : ''}
                  </div>
                </div>
              ))}
              {auditEntries.length === 0 && (
                <div className="text-muted small">No recent activity.</div>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
      
      {/* Event Modal */}
      <Modal show={showEventModal} onHide={() => setShowEventModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>
            {selectedEvent ? 'Edit Event' : 'Create Event'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Event Title</Form.Label>
                  <Form.Control 
                    type="text" 
                    defaultValue={selectedEvent?.title || ''}
                    placeholder="Enter event title"
                    ref={titleRef}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Calendar</Form.Label>
                  <Form.Select defaultValue={selectedEvent?.calendarId || config.defaultCalendarId} ref={calRef}>
                    <option value="primary">Primary Calendar</option>
                    <option value="work">Work Calendar</option>
                    <option value="personal">Personal Calendar</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            
              <Form.Group className="mb-3">
                <Form.Label>Description</Form.Label>
                <Form.Control 
                  as="textarea" 
                  rows={3}
                  defaultValue={selectedEvent?.description || ''}
                  placeholder="Event description (optional)"
                  ref={descRef}
                />
              </Form.Group>
            
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Start Time</Form.Label>
                  <Form.Control 
                    type="datetime-local" 
                    defaultValue={selectedEvent?.startTime.toISOString().slice(0, 16) || ''}
                    ref={startRef}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>End Time</Form.Label>
                  <Form.Control 
                    type="datetime-local" 
                    defaultValue={selectedEvent?.endTime.toISOString().slice(0, 16) || ''}
                    ref={endRef}
                  />
                </Form.Group>
              </Col>
            </Row>
            
            <Form.Group className="mb-3">
              <Form.Label>Location</Form.Label>
              <Form.Control 
                type="text" 
                defaultValue={selectedEvent?.location || ''}
                placeholder="Event location (optional)"
              />
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Check 
                type="checkbox" 
                label="Link to Goal"
                defaultChecked={selectedEvent?.isGoalRelated || false}
              />
            </Form.Group>
            
            {(selectedEvent?.isGoalRelated || true) && (
              <>
                <Form.Group className="mb-3">
                  <Form.Label>Goal</Form.Label>
                  <Form.Select defaultValue={selectedEvent?.linkedGoalId || ''}>
                    <option value="">Select a goal</option>
                    {goals.map(goal => (
                      <option key={goal.id} value={goal.id}>
                        {goal.title} ({goal.theme})
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
                
                <Form.Group className="mb-3">
                  <Form.Label>Story (optional)</Form.Label>
                  <Form.Select defaultValue={selectedEvent?.linkedStoryId || ''}>
                    <option value="">Select a story</option>
                    {stories.map(story => (
                      <option key={story.id} value={story.id}>
                        {story.title}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </>
            )}
            
            <Form.Group className="mb-3">
              <Form.Label>Reminder</Form.Label>
              <Form.Select defaultValue={selectedEvent?.reminderMinutes || config.reminderSettings.defaultMinutes}>
                <option value={5}>5 minutes before</option>
                <option value={15}>15 minutes before</option>
                <option value={30}>30 minutes before</option>
                <option value={60}>1 hour before</option>
                <option value={1440}>1 day before</option>
              </Form.Select>
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowEventModal(false)}>
            Cancel
          </Button>
          {selectedEvent && (
            <Button variant="outline-danger" onClick={deleteEvent}>
              Delete
            </Button>
          )}
          <Button variant="primary" onClick={createOrUpdateEvent}>
            {selectedEvent ? 'Update Event' : 'Create Event'}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showOverrideModal} onHide={() => setShowOverrideModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Override Event Link</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="mb-3">
            <div className="small text-muted">Event</div>
            <strong>{overrideEvent?.title || 'Unknown event'}</strong>
          </div>
          {overrideCandidates.length > 0 && (
            <div className="mb-3">
              <div className="small text-muted mb-2">Quick relink suggestions</div>
              <div className="d-flex flex-wrap gap-2">
                {overrideCandidates.map((candidate) => (
                  <Button
                    key={`${candidate.kind}-${candidate.id}`}
                    variant="outline-primary"
                    size="sm"
                    onClick={() => applyRelinkCandidate(candidate)}
                    disabled={overrideBusy}
                  >
                    {candidate.kind === 'story' ? 'Story' : 'Task'}: {candidate.title} ({Math.round(candidate.score * 100)}%)
                  </Button>
                ))}
              </div>
            </div>
          )}
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Story</Form.Label>
              <Form.Select
                value={overrideStoryId}
                onChange={(e) => {
                  setOverrideStoryId(e.target.value);
                  if (e.target.value) setOverrideTaskId('');
                }}
              >
                <option value="">No story</option>
                {stories.map((story) => (
                  <option key={story.id} value={story.id}>{story.title}</option>
                ))}
              </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Task</Form.Label>
              <Form.Select
                value={overrideTaskId}
                onChange={(e) => {
                  setOverrideTaskId(e.target.value);
                  if (e.target.value) setOverrideStoryId('');
                }}
              >
                <option value="">No task</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>{task.title}</option>
                ))}
              </Form.Select>
              <Form.Text className="text-muted">Choose a story or task. Leave both empty to clear the link.</Form.Text>
            </Form.Group>

            <Form.Group>
              <Form.Label>Reason</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={overrideNote}
                onChange={(e) => setOverrideNote(e.target.value)}
                placeholder="Why this override is needed"
              />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowOverrideModal(false)} disabled={overrideBusy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={applyManualOverride} disabled={overrideBusy}>
            {overrideBusy ? 'Saving...' : 'Save Override'}
          </Button>
        </Modal.Footer>
      </Modal>
      
      {/* Configuration Modal */}
      <Modal show={showConfigModal} onHide={() => setShowConfigModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Calendar Settings</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Default Calendar</Form.Label>
              <Form.Select 
                value={config.defaultCalendarId}
                onChange={(e) => setConfig(prev => ({ ...prev, defaultCalendarId: e.target.value }))}
              >
                <option value="primary">Primary Calendar</option>
                <option value="work">Work Calendar</option>
                <option value="personal">Personal Calendar</option>
              </Form.Select>
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Label>Sync Interval (minutes)</Form.Label>
              <Form.Control 
                type="number" 
                value={config.syncInterval}
                onChange={(e) => setConfig(prev => ({ ...prev, syncInterval: parseInt(e.target.value) }))}
                min={5}
                max={60}
              />
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Check 
                type="checkbox" 
                label="Auto-create tasks from calendar events"
                checked={config.autoCreateTasksFromEvents}
                onChange={(e) => setConfig(prev => ({ ...prev, autoCreateTasksFromEvents: e.target.checked }))}
              />
            </Form.Group>
            
            <hr />
            
            <h6>Reminder Settings</h6>
            
            <Form.Group className="mb-3">
              <Form.Label>Default Reminder Time</Form.Label>
              <Form.Select 
                value={config.reminderSettings.defaultMinutes}
                onChange={(e) => setConfig(prev => ({ 
                  ...prev, 
                  reminderSettings: { 
                    ...prev.reminderSettings, 
                    defaultMinutes: parseInt(e.target.value) 
                  } 
                }))}
              >
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
              </Form.Select>
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Check 
                type="checkbox" 
                label="Enable email reminders"
                checked={config.reminderSettings.enableEmailReminders}
                onChange={(e) => setConfig(prev => ({ 
                  ...prev, 
                  reminderSettings: { 
                    ...prev.reminderSettings, 
                    enableEmailReminders: e.target.checked 
                  } 
                }))}
              />
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Check 
                type="checkbox" 
                label="Enable push notifications"
                checked={config.reminderSettings.enablePushNotifications}
                onChange={(e) => setConfig(prev => ({ 
                  ...prev, 
                  reminderSettings: { 
                    ...prev.reminderSettings, 
                    enablePushNotifications: e.target.checked 
                  } 
                }))}
              />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowConfigModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => setShowConfigModal(false)}>
            Save Settings
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default CalendarIntegrationView;
