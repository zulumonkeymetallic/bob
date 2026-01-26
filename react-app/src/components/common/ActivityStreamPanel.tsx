import React, { useEffect, useRef, useState } from 'react';
import { Button, Card, Collapse, Form, ListGroup, Spinner } from 'react-bootstrap';
import { ActivityEntry, ActivityStreamService } from '../../services/ActivityStreamService';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';

type ActivityEntityType = 'goal' | 'story' | 'task';

interface ActivityStreamPanelProps {
  entityId?: string | null;
  entityType: ActivityEntityType;
  title?: string;
  defaultCollapsed?: boolean;
  maxHeight?: number;
  className?: string;
  referenceNumber?: string;
}

const ActivityStreamPanel: React.FC<ActivityStreamPanelProps> = ({
  entityId,
  entityType,
  title = 'Activity Stream',
  defaultCollapsed = false,
  maxHeight = 360,
  className = '',
  referenceNumber
}) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [activityLimit, setActivityLimit] = useState(50);
  const [activityHasMore, setActivityHasMore] = useState(true);
  const [activityLoadingMore, setActivityLoadingMore] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const lastCountRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setActivityLimit(50);
    setActivityHasMore(true);
    setActivityLoadingMore(false);
    lastCountRef.current = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [entityId, entityType]);

  useEffect(() => {
    if (!entityId || !currentUser?.uid) {
      setActivities([]);
      return;
    }

    const unsubscribe = ActivityStreamService.subscribeToActivityStreamAny(
      entityId,
      entityType,
      (items) => {
        setActivities(items);
        const previousCount = lastCountRef.current;
        lastCountRef.current = items.length;
        if (activityLoadingMore && items.length <= previousCount) {
          setActivityHasMore(false);
        } else {
          setActivityHasMore(items.length >= activityLimit);
        }
        setActivityLoadingMore(false);
      },
      currentUser.uid,
      activityLimit
    );

    return unsubscribe;
  }, [entityId, entityType, currentUser?.uid, activityLimit, activityLoadingMore]);

  const handleAddNote = async () => {
    if (!entityId || !currentUser?.uid) return;
    const trimmed = noteDraft.trim();
    if (!trimmed) {
      setNoteError('Note cannot be empty.');
      return;
    }
    setNoteSaving(true);
    setNoteError(null);
    try {
      await ActivityStreamService.addNote(
        entityId,
        entityType,
        trimmed,
        currentUser.uid,
        currentUser.email || undefined,
        currentPersona || undefined,
        referenceNumber
      );
      setNoteDraft('');
      setNoteOpen(false);
    } catch (error) {
      console.warn('Failed to add note', error);
      setNoteError('Failed to add note. Please try again.');
    } finally {
      setNoteSaving(false);
    }
  };

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 40;
    if (!nearBottom || activityLoadingMore || !activityHasMore) return;
    setActivityLoadingMore(true);
    setActivityLimit((prev) => prev + 50);
  };

  return (
    <Card className={`h-100 ${className}`}>
      <Card.Header className="d-flex justify-content-between align-items-center py-2">
        <div className="fw-semibold">{title}</div>
        <div className="d-flex align-items-center gap-2">
          <Button
            variant="outline-primary"
            size="sm"
            onClick={() => setNoteOpen((prev) => !prev)}
            disabled={!entityId || !currentUser?.uid}
          >
            {noteOpen ? 'Close Note' : 'Add Note'}
          </Button>
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => setCollapsed((prev) => !prev)}
          >
            {collapsed ? 'Show' : 'Hide'}
          </Button>
        </div>
      </Card.Header>
      <Collapse in={!collapsed}>
        <div>
          <Card.Body className="p-2">
            {!entityId && (
              <div className="text-muted small">Save this item to start logging activity.</div>
            )}
            {entityId && !currentUser?.uid && (
              <div className="text-muted small">Sign in to view activity.</div>
            )}
            {entityId && currentUser?.uid && noteOpen && (
              <div className="mb-2">
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Add a note to the activity stream..."
                />
                {noteError && (
                  <div className="text-danger small mt-1">{noteError}</div>
                )}
                <div className="d-flex justify-content-end gap-2 mt-2">
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={() => {
                      setNoteOpen(false);
                      setNoteDraft('');
                      setNoteError(null);
                    }}
                    disabled={noteSaving}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleAddNote}
                    disabled={noteSaving}
                  >
                    {noteSaving ? 'Saving…' : 'Save Note'}
                  </Button>
                </div>
              </div>
            )}
            {entityId && currentUser?.uid && (
              <div
                ref={scrollRef}
                onScroll={handleScroll}
                style={{
                  maxHeight,
                  overflow: 'auto',
                  borderRadius: 6,
                  border: '1px solid var(--bs-border-color, #dee2e6)'
                }}
              >
                {activities.length === 0 ? (
                  <div className="text-muted small text-center py-3">No activity yet.</div>
                ) : (
                  <ListGroup variant="flush">
                    {activities.map((activity, index) => (
                      <ListGroup.Item key={activity.id || index} className="py-2">
                        <div className="small">{activity.description}</div>
                        <div className="text-muted" style={{ fontSize: 11 }}>
                          {ActivityStreamService.formatTimestamp(activity.timestamp)}
                          {activity.userEmail && ` • ${activity.userEmail.split('@')[0]}`}
                        </div>
                      </ListGroup.Item>
                    ))}
                  </ListGroup>
                )}
                {activities.length > 0 && activityLoadingMore && (
                  <div className="text-muted small text-center py-2">
                    <Spinner size="sm" animation="border" className="me-2" />
                    Loading more…
                  </div>
                )}
                {activities.length > 0 && !activityHasMore && (
                  <div className="text-muted small text-center py-2">All activity loaded.</div>
                )}
              </div>
            )}
          </Card.Body>
        </div>
      </Collapse>
    </Card>
  );
};

export default ActivityStreamPanel;
