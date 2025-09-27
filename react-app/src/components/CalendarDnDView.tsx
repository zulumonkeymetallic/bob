import React, { useEffect, useMemo, useState } from 'react';
import { Calendar as RBC, Views, dateFnsLocalizer } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enGB } from 'date-fns/locale';
import { Container, Button, Modal, Form, Badge } from 'react-bootstrap';
import { httpsCallable } from 'firebase/functions';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, orderBy, getDoc, getDocs } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { CalendarBlock } from '../types';
import { GlobalTheme, GLOBAL_THEMES } from '../constants/globalThemes';
import { getContrastTextColor } from '../hooks/useThemeAwareColors';
import { ActivityStreamService } from '../services/ActivityStreamService';

const locales = { 'en-GB': enGB } as any;
const localizer = dateFnsLocalizer({ format, parse, startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }), getDay, locales });
const DnDCalendar = withDragAndDrop(RBC as any);

interface RbcEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  source?: 'block' | 'google';
  block?: CalendarBlock;
}

interface ScheduledItem {
  id: string;
  ownerUid: string;
  blockId: string;
  type: 'story' | 'task' | 'habit' | 'routine' | 'goal';
  refId: string;
  title?: string;
  linkUrl?: string;
  createdAt?: number;
  updatedAt?: number;
}

const DEFAULT_THEME_COLORS: Record<string, string> = {
  Health: '#22c55e',
  Growth: '#3b82f6',
  Wealth: '#eab308',
  Tribe: '#8b5cf6',
  Home: '#f97316'
};

const CalendarDnDView: React.FC = () => {
  const { currentUser } = useAuth();
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [googleEvents, setGoogleEvents] = useState<RbcEvent[]>([]);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createRange, setCreateRange] = useState<{ start: Date; end: Date } | null>(null);
  const [createForm, setCreateForm] = useState({
    title: 'Block',
    theme: 'Health',
    category: 'Fitness',
    flexibility: 'soft' as CalendarBlock['flexibility'],
    rationale: '',
    repeat: 'none' as 'none' | 'weekly',
    syncToGoogle: false
  });
  const [editBlock, setEditBlock] = useState<CalendarBlock | null>(null);
  const [editForm, setEditForm] = useState({
    title: 'Block',
    theme: 'Health',
    category: 'Fitness',
    flexibility: 'soft' as CalendarBlock['flexibility'],
    rationale: '',
    start: '',
    end: '',
    syncToGoogle: false
  });
  const [editScope, setEditScope] = useState<'single'|'future'|'all'>('single');
  const [globalThemes, setGlobalThemes] = useState<GlobalTheme[]>(GLOBAL_THEMES);
  const [blockItems, setBlockItems] = useState<ScheduledItem[]>([]);
  const [linkForm, setLinkForm] = useState({ type: 'story' as 'story' | 'task' | 'habit' | 'routine', refId: '' });
  const [history, setHistory] = useState<any[]>([]);
  const [googleEdit, setGoogleEdit] = useState<{ id: string; summary: string; start: string; end: string } | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteScope, setDeleteScope] = useState<'single'|'future'|'all'>('single');
  // Optional n8n webhook integration (set REACT_APP_N8N_WEBHOOK_URL)
  const notifyN8n = async (event: string, payload: any) => {
    const url = (process.env as any).REACT_APP_N8N_WEBHOOK_URL as string | undefined;
    if (!url) return;
    try {
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'bob', event, payload }) });
    } catch (e) {
      console.warn('n8n notify failed', (e as any)?.message);
    }
  };

  // Load user-defined global themes (for colors + labels)
  useEffect(() => {
    const loadThemes = async () => {
      if (!currentUser) return;
      try {
        const ref = doc(db, 'global_themes', currentUser.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() as any;
          if (Array.isArray(data.themes) && data.themes.length) {
            setGlobalThemes(data.themes as GlobalTheme[]);
          }
        }
      } catch (e) {
        console.warn('CalendarDnDView: failed to load global themes', (e as any)?.message);
      }
    };
    loadThemes();
  }, [currentUser]);

  // Subscribe to scheduled items for the selected block
  useEffect(() => {
    if (!currentUser || !editBlock) {
      setBlockItems([]);
      setHistory([]);
      return;
    }
    const q = query(collection(db, 'scheduled_items'), where('ownerUid', '==', currentUser.uid), where('blockId', '==', editBlock.id));
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ScheduledItem[];
      setBlockItems(items);
    });
    // Load activity history (last 20 events) for this block
    const actQ = query(collection(db, 'activity_stream'), where('entityId', '==', editBlock.id));
    const unsub2 = onSnapshot(actQ, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      rows.sort((a, b) => {
        const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt || a.timestamp || 0);
        const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt || b.timestamp || 0);
        return bt - at;
      });
      setHistory(rows.slice(0, 20));
    });
    return () => { unsub(); unsub2(); };
  }, [currentUser, editBlock]);

  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'calendar_blocks'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('start', 'asc')
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as CalendarBlock[];
      setBlocks(rows);
    });
    return unsub;
  }, [currentUser]);

  useEffect(() => {
    const load = async () => {
      if (!currentUser) return;
      try {
        setLoadingGoogle(true);
        const callable = httpsCallable(functions, 'listUpcomingEvents');
        const res: any = await callable({ maxResults: 200, daysBack: 14, daysForward: 30 });
        const items: RbcEvent[] = (res?.data?.items || []).map((e: any) => {
          const desc = e.description || '';
          const m = String(desc).match(/Theme:\s*(Health|Growth|Wealth|Tribe|Home)/i);
          const theme = m && m[1] ? (m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()) : undefined;
          return {
            id: e.id,
            title: e.summary || 'Untitled',
            start: new Date(e.start?.dateTime || e.start?.date),
            end: new Date(e.end?.dateTime || e.end?.date),
            source: 'google',
            block: theme ? ({ theme } as any) : undefined
          } as RbcEvent;
        });
        setGoogleEvents(items);
      } catch (e) {
        console.warn('Google events load failed', (e as any)?.message);
      } finally {
        setLoadingGoogle(false);
      }
    };
    load();
  }, [currentUser]);

  const events: RbcEvent[] = useMemo(() => {
    const blockEvents: RbcEvent[] = blocks.map((b) => ({
      id: b.id,
      title: (b as any).title || `${b.category || 'Block'} (${b.theme})`,
      start: new Date(b.start),
      end: new Date(b.end),
      source: 'block',
      block: b
    }));
    return [...googleEvents, ...blockEvents];
  }, [blocks, googleEvents]);

  const handleSelectSlot = ({ start, end }: { start: Date; end: Date }) => {
    setCreateRange({ start, end });
    // Default theme to user's first configured theme, else Health
    const defaultTheme = globalThemes?.[0]?.label || 'Health';
    setCreateForm({ title: 'Block', theme: defaultTheme, category: 'Fitness', flexibility: 'soft', rationale: '', repeat: 'none', syncToGoogle: false });
    setShowCreate(true);
  };

  const createBlock = async () => {
    if (!currentUser || !createRange) return;
    const seriesId = createForm.repeat === 'weekly' ? `series_${Date.now()}_${Math.random().toString(36).slice(2,8)}` : undefined;
    const basePayload: Partial<CalendarBlock> = {
      persona: 'personal',
      theme: createForm.theme as any,
      category: createForm.category as any,
      start: createRange.start.getTime(),
      end: createRange.end.getTime(),
      flexibility: createForm.flexibility,
      status: 'applied',
      createdBy: 'user',
      rationale: createForm.rationale,
      version: 1,
      ownerUid: currentUser.uid,
      seriesId,
      syncToGoogle: createForm.syncToGoogle,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const refs: string[] = [];
    const first = await addDoc(collection(db, 'calendar_blocks'), basePayload);
    refs.push(first.id);
    // Repeat weekly: create next 6 occurrences
    if (createForm.repeat === 'weekly') {
      for (let i = 1; i <= 6; i++) {
        const start = new Date(createRange.start.getTime());
        start.setDate(start.getDate() + i * 7);
        const end = new Date(createRange.end.getTime());
        end.setDate(end.getDate() + i * 7);
        const p = { ...basePayload, start: start.getTime(), end: end.getTime() } as any;
        const ref = await addDoc(collection(db, 'calendar_blocks'), p);
        refs.push(ref.id);
      }
    }
    // Optional: sync to Google for created refs
    if (createForm.syncToGoogle) {
      try {
        const callable = httpsCallable(functions, 'createCalendarEvent');
        for (const id of refs) {
          const b = (id === first.id)
            ? basePayload
            : undefined;
          // Requery to get accurate times for each id
          const snap = await getDoc(doc(db, 'calendar_blocks', id));
          const data: any = snap.data();
          const summary = (data?.title) || `${data?.category || 'Block'} (${data?.theme || 'Growth'})`;
          const description = `Theme: ${data?.theme || 'Growth'}\nBy: Human\nBOB BlockId: ${id}\nCategory: ${data?.category || ''}\nSource: BOB`;
          const res: any = await callable({ summary, start: new Date(data.start).toISOString(), end: new Date(data.end).toISOString(), description, bobId: id });
          const evId = res?.data?.event?.id || res?.data?.id || res?.event?.id;
          if (evId) {
            await updateDoc(doc(db, 'calendar_blocks', id), { googleEventId: evId, syncToGoogle: true, updatedAt: Date.now() });
          }
        }
      } catch (e) {
        console.warn('Create: failed to sync to Google', (e as any)?.message);
      }
    }
    // Activity Stream
    try {
      await ActivityStreamService.addActivity({
        entityId: first.id,
        entityType: 'calendar_block',
        activityType: 'created',
        userId: currentUser.uid,
        userEmail: currentUser.email || undefined,
        description: `Created block${createForm.repeat === 'weekly' ? ' (weekly x7)' : ''}: ${createForm.category} (${createForm.theme})`,
        source: 'human'
      });
    } catch {}
    setShowCreate(false);
    // n8n integration: notify created IDs
    try { await notifyN8n('calendar_block_created', { ids: refs, ownerUid: currentUser.uid }); } catch {}
  };

  const handleEventDrop = async ({ event, start, end }: any) => {
    // Only allow moving our blocks
    if (event.source === 'block') {
      try {
        await updateDoc(doc(db, 'calendar_blocks', event.id), {
          start: start.getTime(),
          end: end.getTime(),
          updatedAt: Date.now()
        });
        // If synced to Google, update or create event
        try {
          const snap = await getDoc(doc(db, 'calendar_blocks', event.id));
          const data: any = snap.data();
          if (data?.syncToGoogle) {
            const callable = httpsCallable(functions, data?.googleEventId ? 'updateCalendarEvent' : 'createCalendarEvent');
            if (data?.googleEventId) {
              const description = `Theme: ${data?.theme || 'Growth'}\nBy: Human\nBOB BlockId: ${event.id}\nCategory: ${data?.category || ''}\nSource: BOB`;
              await (callable as any)({ eventId: data.googleEventId, start: start.toISOString(), end: end.toISOString(), description, bobId: event.id });
            } else {
              const summary = (data?.title) || `${data?.category || 'Block'} (${data?.theme || 'Growth'})`;
              const description = `Theme: ${data?.theme || 'Growth'}\nBy: Human\nBOB BlockId: ${event.id}\nCategory: ${data?.category || ''}\nSource: BOB`;
              const res: any = await (callable as any)({ summary, start: start.toISOString(), end: end.toISOString(), description, bobId: event.id });
              const evId = res?.data?.event?.id || res?.data?.id || res?.event?.id;
              if (evId) await updateDoc(doc(db, 'calendar_blocks', event.id), { googleEventId: evId });
            }
          }
        } catch {}
        if (currentUser) {
          await ActivityStreamService.addActivity({
            entityId: event.id,
            entityType: 'calendar_block',
            activityType: 'updated',
            userId: currentUser.uid,
            userEmail: currentUser.email || undefined,
            description: 'Moved block to new time',
            source: 'human'
          });
        }
        // n8n integration: notify update
        try { await notifyN8n('calendar_block_updated', { id: event.id, start: start.getTime(), end: end.getTime(), ownerUid: currentUser?.uid }); } catch {}
      } catch (e) {
        console.error('Failed to move block', e);
        alert('Failed to move block');
      }
    } else if (event.source === 'google') {
      try {
        const callable = httpsCallable(functions, 'updateCalendarEvent');
        await callable({ eventId: event.id, start: start.toISOString(), end: end.toISOString() });
      } catch (e: any) {
        console.warn('Failed to update Google event', e?.message);
        alert('Failed to update Google event');
      }
    }
  };

  const handleEventResize = async ({ event, start, end }: any) => {
    if (event.source === 'block') {
      try {
        await updateDoc(doc(db, 'calendar_blocks', event.id), {
          start: start.getTime(),
          end: end.getTime(),
          updatedAt: Date.now()
        });
        // If synced to Google, update
        try {
          const snap = await getDoc(doc(db, 'calendar_blocks', event.id));
          const data: any = snap.data();
          if (data?.syncToGoogle && data?.googleEventId) {
            const callable = httpsCallable(functions, 'updateCalendarEvent');
            const description = `Theme: ${data?.theme || 'Growth'}\nBy: Human\nBOB BlockId: ${event.id}\nCategory: ${data?.category || ''}\nSource: BOB`;
            await callable({ eventId: data.googleEventId, start: start.toISOString(), end: end.toISOString(), description, bobId: event.id });
          }
        } catch {}
        if (currentUser) {
          await ActivityStreamService.addActivity({
            entityId: event.id,
            entityType: 'calendar_block',
            activityType: 'updated',
            userId: currentUser.uid,
            userEmail: currentUser.email || undefined,
            description: 'Resized block',
            source: 'human'
          });
        }
        // n8n integration: notify resize
        try { await notifyN8n('calendar_block_resized', { id: event.id, start: start.getTime(), end: end.getTime(), ownerUid: currentUser?.uid }); } catch {}
      } catch (e) {
        console.error('Failed to resize block', e);
        alert('Failed to resize block');
      }
    } else if (event.source === 'google') {
      try {
        const callable = httpsCallable(functions, 'updateCalendarEvent');
        await callable({ eventId: event.id, start: start.toISOString(), end: end.toISOString() });
      } catch (e: any) {
        console.warn('Failed to update Google event', e?.message);
        alert('Failed to update Google event');
      }
    }
  };

  const handleSelectEvent = (evt: RbcEvent) => {
    if (evt.source === 'google') {
      setGoogleEdit({
        id: evt.id,
        summary: evt.title,
        start: evt.start.toISOString().slice(0, 16),
        end: evt.end.toISOString().slice(0, 16)
      });
      return;
    }
    const b = evt.block!;
    setEditBlock(b);
    setEditScope('single');
    setEditForm({
      title: `${b.category || 'Block'} (${b.theme})`,
      theme: b.theme,
      category: b.category || '',
      flexibility: b.flexibility,
      rationale: b.rationale || '',
      start: new Date(b.start).toISOString().slice(0, 16),
      end: new Date(b.end).toISOString().slice(0, 16),
      syncToGoogle: (b as any).syncToGoogle || false
    });
  };

  // Support deep-link open by blockId param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const blockId = params.get('blockId');
    if (!blockId || !blocks.length) return;
    const b = blocks.find(x => x.id === blockId);
    if (b) {
      // Open modal pre-filled
      setEditBlock(b);
      setEditScope('single');
      setEditForm({
        title: `${b.category || 'Block'} (${b.theme})`,
        theme: b.theme,
        category: b.category || '',
        flexibility: b.flexibility,
        rationale: b.rationale || '',
        start: new Date(b.start).toISOString().slice(0, 16),
        end: new Date(b.end).toISOString().slice(0, 16),
        syncToGoogle: (b as any).syncToGoogle || false
      });
    }
  }, [blocks]);

  const saveEditBlock = async () => {
    if (!editBlock || !currentUser) return;
    try {
      const originalStart = editBlock.start;
      const originalEnd = editBlock.end;
      const newStartMs = new Date(editForm.start).getTime();
      const newEndMs = new Date(editForm.end).getTime();
      const deltaStart = newStartMs - originalStart;
      const deltaEnd = newEndMs - originalEnd;

      const baseUpdate = {
        category: editForm.category,
        theme: editForm.theme as any,
        flexibility: editForm.flexibility,
        rationale: editForm.rationale,
        syncToGoogle: editForm.syncToGoogle,
        updatedAt: Date.now()
      } as any;

      const targets: Array<{ id: string; data: any }> = [];
      if (editBlock.seriesId && (editScope === 'future' || editScope === 'all')) {
        const qSeries = query(
          collection(db, 'calendar_blocks'),
          where('ownerUid', '==', currentUser.uid),
          where('seriesId', '==', (editBlock as any).seriesId)
        );
        const snaps = await getDocs(qSeries);
        const all = snaps.docs.map(d => ({ id: d.id, data: d.data() as any }));
        const filtered = editScope === 'future' ? all.filter(b => (b.data.start || 0) >= originalStart) : all;
        targets.push(...filtered);
      } else {
        const snap = await getDoc(doc(db, 'calendar_blocks', editBlock.id));
        targets.push({ id: editBlock.id, data: snap.data() });
      }

      for (const t of targets) {
        const currStart = (t.data as any).start || newStartMs;
        const currEnd = (t.data as any).end || newEndMs;
        const upd: any = { ...baseUpdate };
        if (t.id === editBlock.id) {
          upd.start = newStartMs;
          upd.end = newEndMs;
        } else {
          upd.start = currStart + deltaStart;
          upd.end = currEnd + deltaEnd;
        }
        await updateDoc(doc(db, 'calendar_blocks', t.id), upd);

        // Google sync per target
        try {
          const d: any = t.data;
          if (editForm.syncToGoogle) {
            const callable = httpsCallable(functions, d?.googleEventId ? 'updateCalendarEvent' : 'createCalendarEvent');
            if (d?.googleEventId) {
              await (callable as any)({ eventId: d.googleEventId, summary: editForm.category, start: new Date(upd.start).toISOString(), end: new Date(upd.end).toISOString() });
            } else {
              const summary = (d?.title) || `${editForm.category || d?.category || 'Block'} (${editForm.theme || d?.theme || 'Growth'})`;
              const res: any = await (callable as any)({ summary, start: new Date(upd.start).toISOString(), end: new Date(upd.end).toISOString() });
              const evId = res?.data?.event?.id || res?.data?.id || res?.event?.id;
              if (evId) await updateDoc(doc(db, 'calendar_blocks', t.id), { googleEventId: evId });
            }
          } else if (!editForm.syncToGoogle && d?.googleEventId) {
            const callable = httpsCallable(functions, 'deleteCalendarEvent');
            await callable({ eventId: d.googleEventId });
            await updateDoc(doc(db, 'calendar_blocks', t.id), { googleEventId: null });
          }
        } catch {}
      }

      const scopeDesc = editBlock.seriesId && (editScope === 'future' || editScope === 'all')
        ? `Edited series (${editScope}) occurrences: ${targets.length}`
        : 'Edited block details';
      await ActivityStreamService.addActivity({
        entityId: editBlock.id,
        entityType: 'calendar_block',
        activityType: 'updated',
        userId: currentUser.uid,
        userEmail: currentUser.email || undefined,
        description: scopeDesc,
        source: 'human'
      });

      setEditBlock(null);
      // n8n integration: batch update notification
      try { await notifyN8n('calendar_block_series_updated', { ids: targets.map(t => t.id), ownerUid: currentUser.uid }); } catch {}
    } catch (e) {
      console.error('Failed to update block/series', e);
      alert('Failed to update block/series');
    }
  };

  const deleteBlock = async () => {
    if (!editBlock) return;
    // If part of a series, show the scoped delete modal
    if ((editBlock as any).seriesId) {
      setDeleteScope('single');
      setShowDelete(true);
      return;
    }
    // Single delete fallback
    try {
      const snap = await getDoc(doc(db, 'calendar_blocks', editBlock.id));
      const data: any = snap.data();
      if (data?.syncToGoogle && data?.googleEventId) {
        try {
          const callable = httpsCallable(functions, 'deleteCalendarEvent');
          await callable({ eventId: data.googleEventId });
        } catch {}
      }
      await deleteDoc(doc(db, 'calendar_blocks', editBlock.id));
      if (currentUser) {
        await ActivityStreamService.addActivity({
          entityId: editBlock.id,
          entityType: 'calendar_block',
          activityType: 'deleted',
          userId: currentUser.uid,
          userEmail: currentUser.email || undefined,
          description: 'Deleted block',
          source: 'human'
        });
      }
      setEditBlock(null);
      try { await notifyN8n('calendar_block_deleted', { id: editBlock.id, ownerUid: currentUser.uid }); } catch {}
    } catch (e) {
      console.error('Failed to delete block', e);
      alert('Failed to delete block');
    }
  };

  const confirmDeleteSeries = async () => {
    if (!editBlock || !currentUser) return;
    try {
      const sid = (editBlock as any).seriesId;
      const qSeries = query(
        collection(db, 'calendar_blocks'),
        where('ownerUid', '==', currentUser.uid),
        where('seriesId', '==', sid)
      );
      const snaps = await getDocs(qSeries);
      let targets = snaps.docs.map(d => ({ id: d.id, data: d.data() as any }));
      if (deleteScope === 'future') {
        targets = targets.filter(t => (t.data.start || 0) >= (editBlock.start || 0));
      }
      // Google cleanup then delete
      for (const t of targets) {
        try {
          if (t.data?.syncToGoogle && t.data?.googleEventId) {
            const callable = httpsCallable(functions, 'deleteCalendarEvent');
            await callable({ eventId: t.data.googleEventId });
          }
        } catch {}
        await deleteDoc(doc(db, 'calendar_blocks', t.id));
      }
      await ActivityStreamService.addActivity({
        entityId: editBlock.id,
        entityType: 'calendar_block',
        activityType: 'deleted',
        userId: currentUser.uid,
        userEmail: currentUser.email || undefined,
        description: `Deleted series (${deleteScope}) occurrences: ${targets.length}`,
        source: 'human'
      });
      setShowDelete(false);
      setEditBlock(null);
      try { await notifyN8n('calendar_block_series_deleted', { ids: targets.map(t => t.id), ownerUid: currentUser.uid }); } catch {}
    } catch (e) {
      console.error('Failed to delete series', e);
      alert('Failed to delete series');
    }
  };

  // Link item helpers
  const addLinkedItem = async () => {
    if (!editBlock || !currentUser || !linkForm.refId.trim()) return;
    try {
      let title: string | undefined = undefined;
      try {
        const coll = linkForm.type === 'story' ? 'stories' : linkForm.type === 'task' ? 'tasks' : linkForm.type === 'habit' ? 'habits' : 'routines';
        const ref = doc(db, coll, linkForm.refId.trim());
        const snap = await getDoc(ref);
        title = snap.exists() ? ((snap.data() as any).title || (snap.data() as any).name) : undefined;
      } catch {}
      const linkUrl = linkForm.type === 'story'
        ? `/stories?storyId=${linkForm.refId.trim()}`
        : linkForm.type === 'task'
        ? `/tasks?taskId=${linkForm.refId.trim()}`
        : linkForm.type === 'habit'
        ? `/habits?habitId=${linkForm.refId.trim()}`
        : undefined;
      await addDoc(collection(db, 'scheduled_items'), {
        ownerUid: currentUser.uid,
        blockId: editBlock.id,
        type: linkForm.type,
        refId: linkForm.refId.trim(),
        title: title || undefined,
        linkUrl,
        createdAt: Date.now(),
        updatedAt: Date.now()
      } as any);
      setLinkForm(prev => ({ ...prev, refId: '' }));
      await ActivityStreamService.addActivity({
        entityId: editBlock.id,
        entityType: 'calendar_block',
        activityType: 'updated',
        userId: currentUser.uid,
        userEmail: currentUser.email || undefined,
        description: `Linked ${linkForm.type} ${linkForm.refId} to block`,
        source: 'human'
      });
    } catch (e) {
      console.error('Failed to link item', e);
      alert('Failed to link item');
    }
  };

  const removeLinkedItem = async (item: { id: string; type: string; refId: string }) => {
    if (!editBlock || !currentUser) return;
    try {
      await deleteDoc(doc(db, 'scheduled_items', item.id));
      await ActivityStreamService.addActivity({
        entityId: editBlock.id,
        entityType: 'calendar_block',
        activityType: 'updated',
        userId: currentUser.uid,
        userEmail: currentUser.email || undefined,
        description: `Unlinked ${item.type} ${item.refId} from block`,
        source: 'human'
      });
    } catch (e) {
      console.error('Failed to unlink item', e);
      alert('Failed to unlink item');
    }
  };

  const eventPropGetter = (evt: RbcEvent) => {
    if (evt.source === 'google') {
      const isDark = (document.documentElement.getAttribute('data-bs-theme') === 'dark') || document.body.classList.contains('dark');
      const bg = isDark ? '#a7c9ff' : '#cfe6ff';
      const tx = isDark ? '#0b2b6b' : '#0b3b74';
      return { style: { backgroundColor: bg, color: tx, border: '1px solid #84b6f4' } };
    }
    const themeLabel = evt.block?.theme || 'Health';
    const themeMatch = globalThemes.find(t => t.label === themeLabel || t.name === themeLabel);
    const bg = themeMatch?.color || DEFAULT_THEME_COLORS[themeLabel] || '#64748b';
    const tx = getContrastTextColor(bg);
    return { style: { backgroundColor: bg, color: tx, border: 'none' } };
  };

  if (!currentUser) {
    return <div className="p-4">Please sign in to view your calendar.</div>;
  }

  return (
    <Container fluid className="p-3">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h2 className="mb-0">Calendar</h2>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" size="sm" onClick={() => window.location.reload()} disabled={loadingGoogle}>
            {loadingGoogle ? 'Loading Google…' : 'Reload Google Events'}
          </Button>
        </div>
      </div>
      <DnDCalendar
        localizer={localizer}
        events={events}
        defaultView={Views.WEEK}
        views={[Views.DAY, Views.WEEK, Views.MONTH]}
        step={30}
        timeslots={2}
        selectable
        resizable
        onSelectSlot={handleSelectSlot as any}
        onEventDrop={handleEventDrop as any}
        onEventResize={handleEventResize as any}
        onSelectEvent={handleSelectEvent as any}
        style={{ height: 'calc(100vh - 160px)' }}
        eventPropGetter={eventPropGetter as any}
      />

      {/* Create Block Modal */}
      <Modal show={showCreate} onHide={() => setShowCreate(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Create Block</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {createRange && (
            <div className="mb-2">
              <Badge bg="secondary">{createRange.start.toLocaleString()} → {createRange.end.toLocaleString()}</Badge>
            </div>
          )}
          <Form>
            <Form.Group className="mb-2">
              <Form.Label>Title (category)</Form.Label>
              <Form.Control value={createForm.category} onChange={(e)=>setCreateForm({...createForm, category: e.target.value})} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Theme</Form.Label>
              <div className="d-flex align-items-center gap-2">
                <Form.Select value={createForm.theme} onChange={(e)=>setCreateForm({...createForm, theme: e.target.value})}>
                  {globalThemes.map(t => (
                    <option key={t.id} value={t.label}>{t.label}</option>
                  ))}
                </Form.Select>
                {/* Theme chip preview */}
                {(() => { const tm = globalThemes.find(t=>t.label===createForm.theme); return (
                  <span title={createForm.theme} style={{display:'inline-block', width:18, height:18, borderRadius:9, background: tm?.color || '#64748b', border:'1px solid rgba(0,0,0,0.2)'}} />
                ); })()}
              </div>
            </Form.Group>
          <Form.Group className="mb-2">
            <Form.Label>Flexibility</Form.Label>
            <Form.Select value={createForm.flexibility} onChange={(e)=>setCreateForm({...createForm, flexibility: e.target.value as any})}>
              <option value="soft">Soft</option>
              <option value="hard">Hard</option>
            </Form.Select>
          </Form.Group>
          <Form.Group className="mb-2">
            <Form.Check
              type="checkbox"
              label="Sync to Google"
              checked={createForm.syncToGoogle}
              onChange={(e)=>setCreateForm({...createForm, syncToGoogle: e.currentTarget.checked})}
            />
          </Form.Group>
          <Form.Group className="mb-2">
            <Form.Label>Repeat</Form.Label>
            <Form.Select value={createForm.repeat} onChange={(e)=>setCreateForm({...createForm, repeat: e.target.value as any})}>
              <option value="none">None</option>
              <option value="weekly">Weekly</option>
            </Form.Select>
          </Form.Group>
          <Form.Group>
            <Form.Label>Rationale</Form.Label>
            <Form.Control as="textarea" rows={3} value={createForm.rationale} onChange={(e)=>setCreateForm({...createForm, rationale: e.target.value})} />
          </Form.Group>
          </Form>
          {/* History */}
          <div className="mt-3">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <strong>History</strong>
            </div>
            {history.length === 0 ? (
              <div className="text-muted">No activity recorded</div>
            ) : (
              <ul className="list-unstyled" style={{ maxHeight: 180, overflowY: 'auto' }}>
                {history.map((h) => (
                  <li key={h.id} className="small mb-1">
                    <Badge bg={h.source === 'ai' ? 'warning' : 'secondary'} className="me-1">{h.source || 'human'}</Badge>
                    <Badge bg="light" text="dark" className="me-1">{h.activityType}</Badge>
                    <span>{h.description || ''}</span>
                    {h.userEmail && (
                      <span className="text-muted ms-1">• {String(h.userEmail).split('@')[0]}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={()=>setShowCreate(false)}>Cancel</Button>
          <Button variant="primary" onClick={createBlock}>Create</Button>
        </Modal.Footer>
      </Modal>

      {/* Edit Google Event Modal */}
      <Modal show={!!googleEdit} onHide={() => setGoogleEdit(null)}>
        <Modal.Header closeButton>
          <Modal.Title>Edit Google Event</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {googleEdit && (
            <Form>
              <Form.Group className="mb-2">
                <Form.Label>Title</Form.Label>
                <Form.Control value={googleEdit.summary} onChange={(e)=>setGoogleEdit({ ...googleEdit, summary: e.target.value })} />
              </Form.Group>
              <Form.Group className="mb-2">
                <Form.Label>Start</Form.Label>
                <Form.Control type="datetime-local" value={googleEdit.start} onChange={(e)=>setGoogleEdit({ ...googleEdit, start: e.target.value })} />
              </Form.Group>
              <Form.Group className="mb-2">
                <Form.Label>End</Form.Label>
                <Form.Control type="datetime-local" value={googleEdit.end} onChange={(e)=>setGoogleEdit({ ...googleEdit, end: e.target.value })} />
              </Form.Group>
            </Form>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={()=>setGoogleEdit(null)}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async ()=>{
              if (!googleEdit) return;
              try {
                const callable = httpsCallable(functions, 'updateCalendarEvent');
                await callable({
                  eventId: googleEdit.id,
                  summary: googleEdit.summary,
                  start: new Date(googleEdit.start).toISOString(),
                  end: new Date(googleEdit.end).toISOString()
                });
                // Log to activity if a block is open with a googleEventId matching
                try {
                  if (editBlock && (editBlock as any).googleEventId === googleEdit.id && currentUser) {
                    await ActivityStreamService.addActivity({
                      entityId: editBlock.id,
                      entityType: 'calendar_block',
                      activityType: 'updated',
                      userId: currentUser.uid,
                      userEmail: currentUser.email || undefined,
                      description: 'Updated Google event via editor',
                      source: 'human'
                    });
                  }
                } catch {}
                setGoogleEdit(null);
                window.setTimeout(()=>window.location.reload(), 300);
              } catch (e: any) {
                alert('Failed to update Google event: ' + (e?.message || 'unknown error'));
              }
            }}
          >Save</Button>
        </Modal.Footer>
      </Modal>

      {/* Edit Block Modal */}
      <Modal show={!!editBlock} onHide={()=>setEditBlock(null)}>
        <Modal.Header closeButton>
          <Modal.Title>Edit Block</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-2">
              <Form.Label>Start</Form.Label>
              <Form.Control type="datetime-local" value={editForm.start} onChange={(e)=>setEditForm({...editForm, start: e.target.value})} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>End</Form.Label>
              <Form.Control type="datetime-local" value={editForm.end} onChange={(e)=>setEditForm({...editForm, end: e.target.value})} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Category</Form.Label>
              <Form.Control value={editForm.category} onChange={(e)=>setEditForm({...editForm, category: e.target.value})} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Theme</Form.Label>
              <div className="d-flex align-items-center gap-2">
                <Form.Select value={editForm.theme} onChange={(e)=>setEditForm({...editForm, theme: e.target.value})}>
                  {globalThemes.map(t => (
                    <option key={t.id} value={t.label}>{t.label}</option>
                  ))}
                </Form.Select>
                {(() => { const tm = globalThemes.find(t=>t.label===editForm.theme); return (
                  <span title={editForm.theme} style={{display:'inline-block', width:18, height:18, borderRadius:9, background: tm?.color || '#64748b', border:'1px solid rgba(0,0,0,0.2)'}} />
                ); })()}
              </div>
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Flexibility</Form.Label>
              <Form.Select value={editForm.flexibility} onChange={(e)=>setEditForm({...editForm, flexibility: e.target.value as any})}>
                <option value="soft">Soft</option>
                <option value="hard">Hard</option>
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Check
                type="checkbox"
                label="Sync to Google"
                checked={editForm.syncToGoogle}
                onChange={(e)=>setEditForm({...editForm, syncToGoogle: e.currentTarget.checked})}
              />
            </Form.Group>
            {(editBlock as any)?.syncToGoogle && (editBlock as any)?.googleEventId && (
              <div className="mb-2">
                <Button size="sm" variant="outline-info" onClick={()=>{
                  const id = (editBlock as any).googleEventId as string;
                  setGoogleEdit({ id, summary: editForm.category, start: editForm.start, end: editForm.end });
                }}>Edit Google Event</Button>
              </div>
            )}
            {editBlock && (editBlock as any).seriesId && (
              <Form.Group className="mb-2">
                <Form.Label>Apply changes to</Form.Label>
                <div className="d-flex gap-3">
                  <Form.Check
                    type="radio"
                    id="scope-single"
                    label="This occurrence"
                    name="edit-scope"
                    checked={editScope === 'single'}
                    onChange={()=>setEditScope('single')}
                  />
                  <Form.Check
                    type="radio"
                    id="scope-future"
                    label="This and future"
                    name="edit-scope"
                    checked={editScope === 'future'}
                    onChange={()=>setEditScope('future')}
                  />
                  <Form.Check
                    type="radio"
                    id="scope-all"
                    label="Entire series"
                    name="edit-scope"
                    checked={editScope === 'all'}
                    onChange={()=>setEditScope('all')}
                  />
                </div>
              </Form.Group>
            )}
            <Form.Group>
              <Form.Label>Rationale</Form.Label>
              <Form.Control as="textarea" rows={3} value={editForm.rationale} onChange={(e)=>setEditForm({...editForm, rationale: e.target.value})} />
            </Form.Group>
          </Form>
            {/* Quick open primary linked item */}
            <div className="mt-3 mb-2">
              {(() => {
                const priorityOrder = ['routine','habit','task','story','goal'];
                const byType: Record<string, ScheduledItem[]> = {} as any;
                blockItems.forEach(i => { byType[i.type] = byType[i.type] || []; byType[i.type].push(i); });
                let primary: ScheduledItem | null = null;
                for (const t of priorityOrder) {
                  if (byType[t] && byType[t].length) { primary = byType[t][0]; break; }
                }
                return (
                  <Button
                    size="sm"
                    variant="outline-success"
                    disabled={!primary || !primary.linkUrl}
                    onClick={() => { if (primary?.linkUrl) window.location.href = primary.linkUrl; }}
                  >
                    {primary ? `Open ${primary.type}` : 'No linked items'}
                  </Button>
                );
              })()}
            </div>

            {/* Linked items */}
            <div className="mt-3">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <strong>Linked Items</strong>
              <div className="d-flex gap-2">
                <Form.Select size="sm" style={{ width: '140px' }} value={linkForm.type} onChange={(e)=>setLinkForm({ ...linkForm, type: e.target.value as any })}>
                  <option value="story">Story</option>
                  <option value="task">Task</option>
                  <option value="habit">Habit</option>
                  <option value="routine">Routine</option>
                </Form.Select>
                <Form.Control size="sm" placeholder="Enter ID" style={{ width: '200px' }} value={linkForm.refId} onChange={(e)=>setLinkForm({ ...linkForm, refId: e.target.value })} />
                <Button size="sm" variant="outline-primary" onClick={addLinkedItem}>Link</Button>
              </div>
            </div>
            {blockItems.length === 0 ? (
              <div className="text-muted">No linked items</div>
            ) : (
              <ul className="list-unstyled">
                {blockItems.map(item => (
                  <li key={item.id} className="d-flex justify-content-between align-items-center py-1">
                    <span>
                      <Badge bg="secondary" className="me-2">{item.type}</Badge>
                      {item.linkUrl ? (
                        <a href={item.linkUrl} target="_self" rel="noopener noreferrer">{item.title || item.refId}</a>
                      ) : (
                        item.title || item.refId
                      )}
                    </span>
                    <Button size="sm" variant="outline-danger" onClick={()=>removeLinkedItem(item)}>Remove</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-danger" onClick={deleteBlock}>Delete</Button>
          <Button variant="secondary" onClick={()=>setEditBlock(null)}>Cancel</Button>
          <Button variant="primary" onClick={saveEditBlock}>Save</Button>
        </Modal.Footer>
      </Modal>
      {/* Delete Series Modal */}
      <Modal show={showDelete} onHide={()=>setShowDelete(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Delete Blocks</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-2">This block is part of a repeating series. Which occurrences do you want to delete?</p>
          <Form>
            <div className="d-flex flex-column gap-2">
              <Form.Check type="radio" id="del-single" label="This occurrence" name="del-scope" checked={deleteScope==='single'} onChange={()=>setDeleteScope('single')} />
              <Form.Check type="radio" id="del-future" label="This and future" name="del-scope" checked={deleteScope==='future'} onChange={()=>setDeleteScope('future')} />
              <Form.Check type="radio" id="del-all" label="Entire series" name="del-scope" checked={deleteScope==='all'} onChange={()=>setDeleteScope('all')} />
            </div>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={()=>setShowDelete(false)}>Cancel</Button>
          <Button variant="danger" onClick={async ()=>{
            if (deleteScope==='single') {
              setShowDelete(false);
              if (!editBlock) return;
              try {
                const snap = await getDoc(doc(db, 'calendar_blocks', editBlock.id));
                const data: any = snap.data();
                if (data?.syncToGoogle && data?.googleEventId) {
                  try { const callable = httpsCallable(functions, 'deleteCalendarEvent'); await callable({ eventId: data.googleEventId }); } catch {}
                }
                await deleteDoc(doc(db, 'calendar_blocks', editBlock.id));
                if (currentUser) {
                  await ActivityStreamService.addActivity({ entityId: editBlock.id, entityType: 'calendar_block', activityType: 'deleted', userId: currentUser.uid, userEmail: currentUser.email || undefined, description: 'Deleted block', linkUrl: `/calendar?blockId=${editBlock.id}`, source: 'human' });
                }
                setEditBlock(null);
              } catch (e) { console.error(e); alert('Failed to delete block'); }
            } else {
              await confirmDeleteSeries();
            }
          }}>Delete</Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default CalendarDnDView;
