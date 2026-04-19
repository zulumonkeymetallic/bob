import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Button, Form, Badge, ListGroup, Spinner } from 'react-bootstrap';
import { MessageCircle } from 'lucide-react';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { ActivityStreamService, ActivityEntry } from '../services/ActivityStreamService';
import { useAuth } from '../contexts/AuthContext';
import { useSidebar } from '../contexts/SidebarContext';
import { Goal, Story, Task } from '../types';
import { getThemeById, migrateThemeValue } from '../constants/globalThemes';
import { themeVars } from '../utils/themeVars';
import { useGlobalThemes } from '../hooks/useGlobalThemes';
import { ChoiceHelper } from '../config/choices';
import { storyStatusText } from '../utils/storyCardFormatting';

type EntityType = 'goal' | 'story' | 'task';

interface Props {
  show: boolean;
  type: EntityType;
  item: Goal | Story | Task | null;
  onHide: () => void;
  initialTab?: 'details' | 'activity';
}

const EntityDetailModal: React.FC<Props> = ({ show, type, item, onHide, initialTab = 'details' }) => {
  const { currentUser } = useAuth();
  const { showSidebar } = useSidebar();
  const [activeItem, setActiveItem] = useState<Goal | Story | Task | null>(item);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [quickCompleting, setQuickCompleting] = useState(false);
  const [resolvedThemeHex, setResolvedThemeHex] = useState<string>('#6b7280');
  const { themes: globalThemes } = useGlobalThemes();
  const activityRef = useRef<HTMLDivElement | null>(null);

  const formatDateDisplay = (value: any): string => {
    if (!value) return '—';
    let date: Date;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (Number.isNaN(parsed)) return value;
      date = new Date(parsed);
    } else if (typeof value?.toDate === 'function') {
      date = value.toDate();
    } else {
      date = new Date(value);
    }
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return '—';
    }
    return date.toLocaleDateString();
  };

  const toDateInputValue = (value: any): string => {
    if (!value) return '';
    const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const fromDateInputValue = (value: string): number | null => {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  };

  const getReferenceNumber = (entity?: any) => entity?.ref || entity?.referenceNumber || entity?.id;

  const completeStatusValue = type === 'story' ? 4 : 2;

  const isEntityComplete = () => {
    const status = Number((activeItem as any)?.status ?? 0);
    return status === completeStatusValue;
  };

  const handleOpenActivitySidebar = () => {
    if (!activeItem) return;
    try {
      showSidebar(activeItem as any, type);
    } catch (error) {
      console.warn('Failed to open activity sidebar', error);
    }
  };

  const handleQuickComplete = async () => {
    if (!activeItem || !currentUser || isEntityComplete()) {
      return;
    }
    setQuickCompleting(true);
    try {
      const collectionName = type === 'goal' ? 'goals' : type === 'story' ? 'stories' : 'tasks';
      const updates: Record<string, any> = {
        status: completeStatusValue,
        updatedAt: serverTimestamp()
      };
      if (type === 'task') {
        updates.completedAt = serverTimestamp();
      }
      await updateDoc(doc(db, collectionName, (activeItem as any).id), updates);
      const referenceNumber = getReferenceNumber(activeItem);
      await ActivityStreamService.logStatusChange(
        (activeItem as any).id,
        type,
        currentUser.uid,
        currentUser.email || undefined,
        String((activeItem as any).status),
        String(completeStatusValue),
        'personal',
        referenceNumber
      );
      setActiveItem(prev => (prev ? ({ ...prev, status: completeStatusValue } as typeof prev) : prev));
      setEditForm((prev: any) => ({ ...prev, status: completeStatusValue }));
    } catch (error) {
      // eslint-disable-next-line no-alert
      alert('Failed to mark as complete. Please try again.');
    } finally {
      setQuickCompleting(false);
    }
  };

  // Resolve theme color based on entity (goal direct; story->goal; task->story->goal)
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!activeItem) return;
      try {
        if (type === 'goal') {
          const themeId = migrateThemeValue((activeItem as any).theme);
          const hex = getThemeById(themeId).color;
          if (!cancelled) setResolvedThemeHex(hex);
          return;
        }
        if (type === 'story') {
          const goalId = (activeItem as any).goalId;
          if (goalId) {
            const snap = await getDoc(doc(db, 'goals', goalId));
            if (snap.exists()) {
              const themeId = migrateThemeValue((snap.data() as any).theme);
              if (!cancelled) setResolvedThemeHex(getThemeById(themeId).color);
            }
          }
          return;
        }
        if (type === 'task') {
          const parentId = (activeItem as any).parentId;
          if (parentId) {
            const storySnap = await getDoc(doc(db, 'stories', parentId));
            if (storySnap.exists()) {
              const goalId = (storySnap.data() as any).goalId;
              if (goalId) {
                const goalSnap = await getDoc(doc(db, 'goals', goalId));
                if (goalSnap.exists()) {
                  const themeId = migrateThemeValue((goalSnap.data() as any).theme);
                  if (!cancelled) setResolvedThemeHex(getThemeById(themeId).color);
                  return;
                }
              }
            }
          }
          // Fallback: use task's own theme if present
          const ownTheme = migrateThemeValue((activeItem as any).theme);
          if (ownTheme) {
            if (!cancelled) setResolvedThemeHex(getThemeById(ownTheme).color);
          }
        }
      } catch {}
    };
    run();
    return () => { cancelled = true; };
  }, [activeItem, type]);

  // Subscribe to activity stream for this entity
  useEffect(() => {
    if (!activeItem) { setActivities([]); return; }
    return ActivityStreamService.subscribeToActivityStreamAny(
      activeItem.id,
      type as 'task' | 'story' | 'goal',
      setActivities,
      currentUser?.uid
    );
  }, [activeItem?.id, currentUser?.uid, type]);

  // If requested, scroll to activity on open
  useEffect(() => {
    if (show && initialTab === 'activity') {
      setTimeout(() => {
        try { activityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
      }, 100);
    }
  }, [show, initialTab]);

  // Initialize edit form when opening
  useEffect(() => {
    setActiveItem(item);
    if (item) {
      setEditForm({ ...(item as any) });
    } else {
      setEditForm({});
    }
    setIsEditing(false);
  }, [item]);

  const headerStyle: React.CSSProperties = {
    background: resolvedThemeHex,
    color: themeVars.onAccent as string,
  };

  const handleSave = async () => {
    if (!currentUser || !activeItem) return;
    setLoading(true);
    try {
      const col = type === 'goal' ? 'goals' : type === 'story' ? 'stories' : 'tasks';
      const updates = { ...editForm };
      delete (updates as any).id;
      await updateDoc(doc(db, col, (activeItem as any).id), { ...updates, updatedAt: serverTimestamp() });
      setActiveItem(prev => (prev ? ({ ...prev, ...updates } as typeof prev) : prev));

      // Log changes
      const referenceNumber = getReferenceNumber(activeItem);
      const changedKeys = Object.keys(editForm).filter((key) => key !== 'id' && (activeItem as any)[key] !== editForm[key]);
      for (const key of changedKeys) {
        const oldVal = (activeItem as any)[key];
        const newVal = editForm[key];
        if (key === 'status') {
          await ActivityStreamService.logStatusChange(
            (activeItem as any).id,
            type,
            currentUser.uid,
            currentUser.email || undefined,
            String(oldVal),
            String(newVal),
            'personal',
            referenceNumber
          );
        } else if (key === 'sprintId') {
          await ActivityStreamService.logSprintChange(
            (activeItem as any).id,
            (type === 'goal' ? 'story' : type) as any,
            String(oldVal || ''),
            String(newVal || ''),
            currentUser.uid,
            currentUser.email || undefined,
            'personal',
            referenceNumber
          );
        } else {
          await ActivityStreamService.logFieldChange(
            (activeItem as any).id,
            type,
            currentUser.uid,
            currentUser.email || undefined,
            key,
            oldVal,
            newVal,
            'personal',
            referenceNumber
          );
        }
      }
      setIsEditing(false);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert('Failed to save changes');
    } finally {
      setLoading(false);
    }
  };

  // Canonical numeric status options per entity
  const statusOptions = useMemo(() => {
    if (type === 'goal') return ChoiceHelper.getOptions('goal', 'status');
    if (type === 'story') return ChoiceHelper.getOptions('story', 'status');
    return ChoiceHelper.getOptions('task', 'status');
  }, [type]);

  if (!activeItem) return null;
  const entity = activeItem as any;

  return (
    <Modal show={show} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton style={headerStyle}>
        <div className="d-flex align-items-center w-100 justify-content-between">
          <Modal.Title>
            {entity.title || 'Untitled'}
          </Modal.Title>
          <div className="d-flex align-items-center gap-2">
            <Button
              variant="outline-light"
              size="sm"
              onClick={handleOpenActivitySidebar}
              title="Open activity stream"
            >
              <MessageCircle size={14} className="me-1" />
              Activity
            </Button>
            <Button
              variant="light"
              size="sm"
              onClick={handleQuickComplete}
              disabled={quickCompleting || isEntityComplete() || loading}
            >
              {quickCompleting ? 'Completing…' : 'Mark Complete'}
            </Button>
          </div>
        </div>
      </Modal.Header>
      <Modal.Body>
        <div style={{ display: 'flex', gap: 16, flexDirection: 'column' }}>
          {/* If initialTab=activity, a small anchor to jump down */}
          {initialTab === 'activity' && (
            <a href="#entity-activity" style={{ position: 'absolute', left: -9999 }} aria-hidden>
              Activity
            </a>
          )}
          {/* Core fields */}
          <div>
            <label style={{ fontWeight: 500 }}>Title</label>
            {isEditing ? (
              <Form.Control value={editForm.title || ''} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
            ) : (
              <div>{entity.title}</div>
            )}
          </div>
          <div>
            <label style={{ fontWeight: 500 }}>Description</label>
            {isEditing ? (
              <Form.Control as="textarea" rows={3} value={editForm.description || ''} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
            ) : (
              <div style={{ whiteSpace: 'pre-wrap' }}>{entity.description || '—'}</div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontWeight: 500 }}>Status</label>
              {isEditing ? (
                <Form.Select
                  value={typeof editForm.status === 'number' ? editForm.status : (Number(editForm.status) || '')}
                  onChange={(e) => setEditForm({ ...editForm, status: Number(e.target.value) })}
                >
                  {statusOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </Form.Select>
              ) : (
                <Badge bg="secondary">
                  {(() => {
                    const v = entity.status;
                    const n = typeof v === 'number' ? v : Number(v);
                    if (type === 'story') {
                      return storyStatusText(n);
                    }
                    if (Number.isFinite(n)) {
                      // At this point, type is not 'story' (handled above),
                      // so it's safe to map only 'goal' | 'task'
                      const table: 'goal' | 'task' = type === 'goal' ? 'goal' : 'task';
                      return ChoiceHelper.getLabel(table, 'status', n);
                    }
                    return String(v ?? '—');
                  })()}
                </Badge>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontWeight: 500 }}>Priority</label>
              {isEditing ? (
                <Form.Select value={editForm.priority ?? ''} onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}>
                  {type === 'story' ? (
                    <>
                      <option value="P1">P1 - High</option>
                      <option value="P2">P2 - Medium</option>
                      <option value="P3">P3 - Low</option>
                    </>
                  ) : (
                    <>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </>
                  )}
                </Form.Select>
              ) : (
                <Badge bg="secondary">{String(entity.priority ?? '—')}</Badge>
              )}
            </div>
          </div>

          {(type === 'task' || type === 'story') && (
            <div>
              <label style={{ fontWeight: 500 }}>Due Date</label>
              {isEditing ? (
                <Form.Control
                  type="date"
                  value={toDateInputValue(editForm.dueDate ?? entity.dueDate)}
                  onChange={(e) => setEditForm({ ...editForm, dueDate: fromDateInputValue(e.target.value) })}
                />
              ) : (
                <div>{formatDateDisplay(entity.dueDate)}</div>
              )}
            </div>
          )}

          {type === 'goal' && (
            <div>
              <label style={{ fontWeight: 500 }}>Target Date</label>
              {isEditing ? (
                <Form.Control
                  type="date"
                  value={((editForm.targetDate ?? entity.targetDate) || '').slice(0, 10)}
                  onChange={(e) => setEditForm({ ...editForm, targetDate: e.target.value })}
                />
              ) : (
                <div>{entity.targetDate ? formatDateDisplay(entity.targetDate) : '—'}</div>
              )}
            </div>
          )}

          {/* Theme (tasks without a story can set theme directly) */}
          {type === 'task' && (!(entity?.parentId) || entity?.parentType !== 'story') && (
            <div>
              <label style={{ fontWeight: 500 }}>Theme</label>
              {isEditing ? (
                <Form.Select
                  value={migrateThemeValue(editForm.theme) || ''}
                  onChange={(e) => setEditForm({ ...editForm, theme: Number(e.target.value) })}
                >
                  {globalThemes.map(t => (
                    <option key={t.id} value={t.id}>{t.label || t.name}</option>
                  ))}
                </Form.Select>
              ) : (
                <Badge bg="secondary">{(() => {
                  const themeId = migrateThemeValue(entity.theme);
                  const found = globalThemes.find(t => t.id === themeId);
                  return found?.label || found?.name || '—';
                })()}</Badge>
              )}
            </div>
          )}

          {/* Activity Stream */}
          <div id="entity-activity" ref={activityRef}>
            <label style={{ fontWeight: 600 }}>Activity</label>
            {!activities && <Spinner size="sm" />}
            {activities && (
              <ListGroup style={{ maxHeight: 240, overflow: 'auto' }}>
                {activities.map((a) => (
                  <ListGroup.Item key={a.id}>
                    <div style={{ fontSize: 13 }}>{a.description}</div>
                    <div style={{ fontSize: 11, color: themeVars.muted as string }}>
                      {ActivityStreamService.formatTimestamp(a.timestamp)}
                      {a.userEmail && ` • ${a.userEmail.split('@')[0]}`}
                    </div>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            )}
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        {!isEditing ? (
          <Button variant="primary" onClick={() => setIsEditing(true)}>
            Edit
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={() => { setEditForm({ ...entity }); setIsEditing(false); }}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={loading}>
              {loading ? 'Saving…' : 'Save Changes'}
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
};

export default EntityDetailModal;
