import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Button, Form, Badge, ListGroup, Spinner } from 'react-bootstrap';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { ActivityStreamService, ActivityEntry } from '../services/ActivityStreamService';
import { useAuth } from '../contexts/AuthContext';
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
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [resolvedThemeHex, setResolvedThemeHex] = useState<string>('#6b7280');
  const { themes: globalThemes } = useGlobalThemes();
  const activityRef = useRef<HTMLDivElement | null>(null);

  // Resolve theme color based on entity (goal direct; story->goal; task->story->goal)
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!item) return;
      try {
        if (type === 'goal') {
          const themeId = migrateThemeValue((item as any).theme);
          const hex = getThemeById(themeId).color;
          if (!cancelled) setResolvedThemeHex(hex);
          return;
        }
        if (type === 'story') {
          const goalId = (item as any).goalId;
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
          const parentId = (item as any).parentId;
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
          const ownTheme = migrateThemeValue((item as any).theme);
          if (ownTheme) {
            if (!cancelled) setResolvedThemeHex(getThemeById(ownTheme).color);
          }
        }
      } catch {}
    };
    run();
    return () => { cancelled = true; };
  }, [item, type]);

  // Subscribe to activity stream for this entity
  useEffect(() => {
    if (!item) { setActivities([]); return; }
    return ActivityStreamService.subscribeToActivityStream(item.id, setActivities, currentUser?.uid);
  }, [item?.id, currentUser?.uid]);

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
    if (item) setEditForm({ ...(item as any) });
    setIsEditing(false);
  }, [item]);

  const headerStyle: React.CSSProperties = {
    background: resolvedThemeHex,
    color: themeVars.onAccent as string,
  };

  const handleSave = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const col = type === 'goal' ? 'goals' : type === 'story' ? 'stories' : 'tasks';
      const updates = { ...editForm };
      delete (updates as any).id;
      await updateDoc(doc(db, col, (item as any).id), { ...updates, updatedAt: serverTimestamp() });

      // Log changes
      const referenceNumber = (item as any).ref || (item as any).referenceNumber || (item as any).id;
      Object.keys(editForm).forEach(async (key) => {
        if ((item as any)[key] !== editForm[key]) {
          const oldVal = (item as any)[key];
          const newVal = editForm[key];
          if (key === 'status') {
            await ActivityStreamService.logStatusChange(
              (item as any).id,
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
              (item as any).id,
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
              (item as any).id,
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
      });
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

  if (!item) return null;

  return (
    <Modal show={show} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton style={headerStyle}>
        <Modal.Title>
          {(item as any).title || 'Untitled'}
        </Modal.Title>
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
              <div>{(item as any).title}</div>
            )}
          </div>
          <div>
            <label style={{ fontWeight: 500 }}>Description</label>
            {isEditing ? (
              <Form.Control as="textarea" rows={3} value={editForm.description || ''} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
            ) : (
              <div style={{ whiteSpace: 'pre-wrap' }}>{(item as any).description || '—'}</div>
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
                    const v = (item as any).status;
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
                <Badge bg="secondary">{String((item as any).priority ?? '—')}</Badge>
              )}
            </div>
          </div>

          {/* Theme (tasks without a story can set theme directly) */}
          {type === 'task' && (!((item as any)?.parentId) || (item as any)?.parentType !== 'story') && (
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
                  const themeId = migrateThemeValue((item as any).theme);
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
            <Button variant="secondary" onClick={() => setIsEditing(false)} disabled={loading}>
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
