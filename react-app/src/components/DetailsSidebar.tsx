import React, { useState } from 'react';
import { Card, Button, Badge, Form, Row, Col } from 'react-bootstrap';
import { X, Edit3, Save, Calendar, User, Target, BookOpen, Clock, AlertCircle, Hash } from 'lucide-react';
import { Story, Goal, Task, Sprint } from '../types';
import { isStatus, isTheme, isPriority, getThemeClass, getPriorityBadge } from '../utils/statusHelpers';
import { normalizePriorityValue } from '../utils/priorityUtils';
import { themeVars, domainThemePrimaryVar } from '../utils/themeVars';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

interface DetailsSidebarProps {
  item: Story | Task | null;
  type: 'story' | 'task' | null;
  goals: Goal[];
  stories: Story[];
  sprints: Sprint[];
  onClose: () => void;
  onUpdate: (updates: any) => void;
  isVisible: boolean;
}

const DetailsSidebar: React.FC<DetailsSidebarProps> = ({
  item,
  type,
  goals,
  stories,
  sprints,
  onClose,
  onUpdate,
  isVisible
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);

  // Theme colors mapping
  const themeColors = {
    Health: domainThemePrimaryVar('Health'),
    Growth: domainThemePrimaryVar('Growth'),
    Wealth: domainThemePrimaryVar('Wealth'),
    Tribe: domainThemePrimaryVar('Tribe'),
    Home: domainThemePrimaryVar('Home')
  } as const;

  const deriveEstimatedHours = (task: Task): number | undefined => {
    if (typeof task.estimatedHours === 'number' && !Number.isNaN(task.estimatedHours)) {
      return Math.round(task.estimatedHours * 100) / 100;
    }
    if (typeof task.estimateMin === 'number' && !Number.isNaN(task.estimateMin)) {
      return Math.round((task.estimateMin / 60) * 100) / 100;
    }
    return undefined;
  };

  React.useEffect(() => {
    if (!item) return;
    if (type === 'task') {
      const task = item as Task;
      const fallbackPriority =
        task.aiCriticalityScore != null && Number.isFinite(Number(task.aiCriticalityScore)) && task.aiCriticalityScore >= 90
          ? 4
          : undefined;
      setEditForm({
        ...task,
        estimatedHours: deriveEstimatedHours(task),
        priority: normalizePriorityValue(task.priority ?? fallbackPriority),
      });
    } else {
      setEditForm({ ...item });
    }
    setIsEditing(false);
  }, [item, type]);

  if (!isVisible || !item || !type) {
    return null;
  }

  const handleSave = () => {
    onUpdate(editForm);
    setIsEditing(false);
  };

  const getGoalForStory = (storyId: string) => {
    const story = stories.find(s => s.id === storyId);
    return story ? goals.find(g => g.id === story.goalId) : null;
  };

  const getStoryForTask = (taskId: string) => {
    const task = item as Task;
    return task ? stories.find(s => s.id === task.parentId && task.parentType === 'story') : null;
  };

  const getGoalForItem = () => {
    if (type === 'story') {
      const story = item as Story;
      return goals.find(g => g.id === story.goalId);
    } else if (type === 'task') {
      const story = getStoryForTask(item.id);
      return story ? goals.find(g => g.id === story.goalId) : null;
    }
    return null;
  };

  const goal = getGoalForItem();
  const story = type === 'task' ? getStoryForTask(item.id) : null;
  const themeColor = goal?.theme ? themeColors[goal.theme] : (themeVars.muted as string);
  const derivedEstimatedHours = type === 'task' ? deriveEstimatedHours(item as Task) : undefined;
  const aiScoreValue = type === 'task' && item ? Number(((item as Task).aiCriticalityScore ?? null)) : null;
  const formattedAiScore = aiScoreValue != null && Number.isFinite(aiScoreValue) ? Math.round(aiScoreValue) : null;
  const storyMetadata = type === 'story' && item ? (item as Story).metadata : null;
  const storyAiRaw = storyMetadata ? (storyMetadata.aiScore ?? storyMetadata.aiCriticalityScore ?? null) : null;
  const storyAiScore = storyAiRaw != null && Number.isFinite(Number(storyAiRaw)) ? Number(storyAiRaw) : null;
  const entityAiScore = type === 'task' ? aiScoreValue : storyAiScore;
  const derivedPriorityFromAi = entityAiScore != null && entityAiScore >= 90 ? 4 : undefined;
  const rawPriorityValue = item ? (item.priority ?? derivedPriorityFromAi ?? 0) : derivedPriorityFromAi ?? 0;
  const normalizedPriorityForDisplay = normalizePriorityValue(rawPriorityValue);
  const priorityBadge = getPriorityBadge(normalizedPriorityForDisplay);

  const formatDate = (timestamp: any) => {
    if (!timestamp) return 'Not set';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const generateReferenceNumber = () => {
    // Prefer canonical ref stored on the entity
    if ((item as any)?.ref) return String((item as any).ref);
    if (type === 'story') {
      const storyItem = item as Story;
      return `STRY-${storyItem.id.substring(0, 6).toUpperCase()}`;
    } else if (type === 'task') {
      const taskItem = item as Task;
      return `TASK-${taskItem.id.substring(0, 6).toUpperCase()}`;
    }
    return 'N/A';
  };

  const handleGenerateTasksForStory = async () => {
    if (type !== 'story') return;
    try {
      setAiBusy(true);
      setAiMsg(null);
      const fn = httpsCallable(functions, 'generateTasksForStory');
      const res: any = await fn({ storyId: (item as Story).id });
      setAiMsg(`Generated ${res?.data?.created ?? 0} tasks from story`);
    } catch (e: any) {
      setAiMsg(e?.message || 'Failed to generate tasks');
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: isVisible ? 0 : '-400px',
        width: '400px',
        height: '100vh',
        backgroundColor: themeVars.panel as string,
        boxShadow: '-4px 0 8px rgba(0,0,0,0.1)',
        zIndex: 1000,
        transition: 'right 0.3s ease',
        overflow: 'auto',
        color: themeVars.text as string
      }}
    >
      {/* Header */}
      <div
        style={{
          backgroundColor: themeColor,
          color: themeVars.onAccent as string,
          padding: '20px',
          borderBottom: `1px solid ${themeVars.border}`
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h5 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
            {type === 'story' ? 'Story Details' : 'Task Details'}
          </h5>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button
              variant="link"
              size="sm"
              style={{ color: 'white', padding: '4px' }}
              onClick={() => setIsEditing(!isEditing)}
            >
              <Edit3 size={16} />
            </Button>
            <Button
              variant="link"
              size="sm"
              style={{ color: 'white', padding: '4px' }}
              onClick={onClose}
            >
              <X size={16} />
            </Button>
          </div>
        </div>

        {/* Reference Number */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <Hash size={14} />
          <span style={{ fontSize: '14px', fontFamily: 'monospace' }}>
            {generateReferenceNumber()}
          </span>
        </div>

        {/* Theme Inheritance Chain */}
        {goal && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
            <Target size={12} />
            <span>{goal.title}</span>
            {story && (
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
      <div style={{ padding: '20px' }}>
        {/* Title */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '14px', fontWeight: '500', color: themeVars.text as string, marginBottom: '6px', display: 'block' }}>
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
            <h4 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: themeVars.text as string }}>
              {item.title}
            </h4>
          )}
        </div>

        {/* Story-level AI Actions */}
        {type === 'story' && (
          <div style={{ marginBottom: '16px', display: 'flex', gap: 8 }}>
            <Button variant="outline-primary" size="sm" disabled={aiBusy} onClick={handleGenerateTasksForStory}>
              {aiBusy ? 'Generating…' : 'AI: Generate Tasks for Story'}
            </Button>
            {aiMsg && (
              <span className="text-muted" style={{ fontSize: 12 }}>{aiMsg}</span>
            )}
          </div>
        )}

        {/* Description */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '14px', fontWeight: '500', color: themeVars.text as string, marginBottom: '6px', display: 'block' }}>
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
            <p style={{ margin: 0, color: themeVars.muted as string, lineHeight: '1.5' }}>
              {item.description || 'No description provided'}
            </p>
          )}
        </div>

        {/* Status and Priority */}
        <Row style={{ marginBottom: '20px' }}>
          <Col xs={6}>
            <label style={{ fontSize: '14px', fontWeight: '500', color: themeVars.text as string, marginBottom: '6px', display: 'block' }}>
              Status
            </label>
            {isEditing ? (
              <Form.Select
                value={typeof editForm.status === 'number' ? editForm.status : Number(editForm.status) || 0}
                onChange={(e) => setEditForm({ ...editForm, status: Number(e.target.value) })}
              >
                <option value={0}>Backlog</option>
                <option value={1}>In Progress</option>
                <option value={2}>Done</option>
              </Form.Select>
            ) : (
              <Badge
                bg={isStatus(item.status, 'done') ? 'success' : isStatus(item.status, 'in-progress') ? 'primary' : 'secondary'}
                style={{ fontSize: '12px', padding: '6px 12px' }}
              >
                {String(item.status)}
              </Badge>
            )}
          </Col>
          <Col xs={6}>
            <label style={{ fontSize: '14px', fontWeight: '500', color: themeVars.text as string, marginBottom: '6px', display: 'block' }}>
              Priority
            </label>
            {isEditing ? (
              <Form.Select
                size="sm"
                value={String(editForm.priority ?? '')}
                onChange={(e) => setEditForm({ ...editForm, priority: Number(e.target.value) })}
                style={{ fontSize: '13px' }}
              >
                <option value="">None</option>
                <option value={4}>Critical</option>
                <option value={3}>High</option>
                <option value={2}>Medium</option>
                <option value={1}>Low</option>
              </Form.Select>
            ) : (
              <Badge
                bg={priorityBadge.bg}
                style={{ fontSize: '12px', padding: '6px 12px' }}
              >
                {priorityBadge.text}
              </Badge>
            )}
          </Col>
        </Row>

        {/* Story-specific fields */}
        {type === 'story' && (
          <>
            <Row style={{ marginBottom: '20px' }}>
              <Col xs={6}>
                <label style={{ fontSize: '14px', fontWeight: '500', color: themeVars.text as string, marginBottom: '6px', display: 'block' }}>
                  Story Points
                </label>
                {isEditing ? (
                  <Form.Control
                    type="number"
                    min="1"
                    max="13"
                    value={editForm.points || 1}
                    onChange={(e) => setEditForm({ ...editForm, points: parseInt(e.target.value) })}
                  />
                ) : (
                  <Badge bg="info" style={{ fontSize: '14px', padding: '8px 12px' }}>
                    {(item as Story).points} points
                  </Badge>
                )}
              </Col>
              <Col xs={6}>
                <label style={{ fontSize: '14px', fontWeight: '500', color: themeVars.text as string, marginBottom: '6px', display: 'block' }}>
                  WIP Limit
                </label>
                {isEditing ? (
                  <Form.Control
                    type="number"
                    min="1"
                    max="10"
                    value={editForm.wipLimit || 3}
                    onChange={(e) => setEditForm({ ...editForm, wipLimit: parseInt(e.target.value) })}
                  />
                ) : (
                  <span style={{ color: themeVars.muted as string }}>
                    {(item as Story).wipLimit}
                  </span>
                )}
              </Col>
            </Row>

            {/* Goal Assignment */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '14px', fontWeight: '500', color: themeVars.text as string, marginBottom: '6px', display: 'block' }}>
                Linked Goal
              </label>
              {isEditing ? (
                <Form.Select
                  value={editForm.goalId || ''}
                  onChange={(e) => setEditForm({ ...editForm, goalId: e.target.value })}
                >
                  <option value="">Select Goal</option>
                  {goals.map(g => (
                    <option key={g.id} value={g.id}>{g.title}</option>
                  ))}
                </Form.Select>
              ) : goal ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Target size={16} color={themeColor} />
                  <span style={{ color: themeVars.text as string, fontWeight: '500' }}>{goal.title}</span>
                  <Badge
                    style={{
                      backgroundColor: themeColor,
                      color: themeVars.onAccent as string,
                      fontSize: '10px'
                    }}
                  >
                    {goal.theme}
                  </Badge>
                </div>
              ) : (
                <span style={{ color: themeVars.muted as string }}>No goal linked</span>
              )}
            </div>
          </>
        )}

        {/* Task-specific fields */}
        {type === 'task' && (
          <>
            <Row style={{ marginBottom: '20px' }}>
              <Col xs={6}>
                <label style={{ fontSize: '14px', fontWeight: '500', color: themeVars.text as string, marginBottom: '6px', display: 'block' }}>
                  Effort
                </label>
                {isEditing ? (
                  <Form.Select
                    value={editForm.effort || ''}
                    onChange={(e) => setEditForm({ ...editForm, effort: e.target.value })}
                  >
                    <option value="S">S - Small</option>
                    <option value="M">M - Medium</option>
                    <option value="L">L - Large</option>
                  </Form.Select>
                ) : (
                  <Badge bg="outline-secondary" style={{ fontSize: '12px', padding: '6px 12px', border: `1px solid ${themeVars.border}` }}>
                    {(item as Task).effort}
                  </Badge>
                )}
              </Col>
              <Col xs={6}>
                <label style={{ fontSize: '14px', fontWeight: '500', color: themeVars.text as string, marginBottom: '6px', display: 'block' }}>
                  Estimate
                </label>
                {isEditing ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <Form.Control
                      type="number"
                      min="0"
                      step="0.25"
                      value={editForm.estimatedHours ?? derivedEstimatedHours ?? 1}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value);
                        if (Number.isNaN(value)) {
                          setEditForm({ ...editForm, estimatedHours: undefined });
                          return;
                        }
                        const rounded = Math.round(value * 100) / 100;
                        setEditForm({
                          ...editForm,
                          estimatedHours: rounded,
                          estimateMin: Math.max(5, Math.round(rounded * 60))
                        });
                      }}
                    />
                    <Form.Text muted>
                      ≈ {Math.max(5, Math.round((editForm.estimatedHours ?? derivedEstimatedHours ?? 1) * 60))} minutes
                    </Form.Text>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Clock size={14} color={themeVars.muted as string} />
                    <span style={{ color: themeVars.muted as string }}>
                      {(derivedEstimatedHours ?? 1).toFixed(2)} h · {(item as Task).estimateMin ?? Math.round(((derivedEstimatedHours ?? 1) * 60))} minutes
                    </span>
                  </div>
                )}
              </Col>
            </Row>

            {/* Parent Story */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '14px', fontWeight: '500', color: themeVars.text as string, marginBottom: '6px', display: 'block' }}>
                Parent Story
              </label>
              {isEditing ? (
                <Form.Select
                  value={editForm.parentId || ''}
                  onChange={(e) => setEditForm({ ...editForm, parentId: e.target.value, parentType: 'story' })}
                >
                  <option value="">Select Story</option>
                  {stories.map(s => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </Form.Select>
              ) : story ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <BookOpen size={16} color={themeColor} />
                  <span style={{ color: themeVars.text as string, fontWeight: '500' }}>{story.title}</span>
                </div>
              ) : (
                <span style={{ color: themeVars.muted as string }}>No parent story</span>
              )}
            </div>

            {/* Due Date */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '14px', fontWeight: '500', color: themeVars.text as string, marginBottom: '6px', display: 'block' }}>
                Due Date
              </label>
              {isEditing ? (
                <Form.Control
                  type="datetime-local"
                  value={editForm.dueDate ? new Date(editForm.dueDate).toISOString().slice(0, 16) : ''}
                  onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value ? new Date(e.target.value).getTime() : undefined })}
                />
              ) : (item as Task).dueDate ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Calendar size={14} color={themeVars.muted as string} />
                  <span style={{ color: themeVars.muted as string }}>
                    {new Date((item as Task).dueDate!).toLocaleDateString()}
                  </span>
                </div>
              ) : (
                <span style={{ color: themeVars.muted as string }}>No due date set</span>
              )}
            </div>
          </>
        )}

        {/* Metadata */}
        <div style={{ borderTop: `1px solid ${themeVars.border}`, paddingTop: '20px', marginTop: '20px' }}>
          <h6 style={{ fontSize: '14px', fontWeight: '600', color: themeVars.text as string, marginBottom: '12px' }}>
            Metadata
          </h6>

          <div style={{ fontSize: '13px', color: themeVars.muted as string, lineHeight: '1.6' }}>
            <div style={{ marginBottom: '8px' }}>
              <strong>ID:</strong> <code style={{ fontSize: '11px' }}>{item.id}</code>
            </div>
            <div style={{ marginBottom: '8px' }}>
              <strong>Created:</strong> {formatDate(item.createdAt)}
            </div>
            <div style={{ marginBottom: '8px' }}>
              <strong>Updated:</strong> {formatDate(item.updatedAt)}
            </div>
            <div style={{ marginBottom: '8px' }}>
              <strong>Owner:</strong> {item.ownerUid}
            </div>
            {type === 'task' && (
              <>
                <div style={{ marginBottom: '8px' }}>
                  <strong>Source:</strong> {(item as Task).source}
                </div>
                <div style={{ marginBottom: '8px' }}>
                  <strong>Sync State:</strong> {(item as Task).syncState}
                </div>
                <div style={{ marginBottom: '8px' }}>
                  <strong>Points:</strong> {(item as Task).points ?? '—'}
                </div>
                {(item as Task).aiCriticalityScore != null && (
                  <>
                    <div style={{ marginBottom: '8px' }}>
                      <strong>AI Score:</strong> {formattedAiScore ?? (item as Task).aiCriticalityScore}
                    </div>
                    {(item as Task).aiCriticalityReason && (
                      <div style={{ marginBottom: '8px' }}>
                        <strong>AI Rationale:</strong> {(item as Task).aiCriticalityReason}
                      </div>
                    )}
                  </>
                )}
              </>
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
    </div>
  );
};

export default DetailsSidebar;
