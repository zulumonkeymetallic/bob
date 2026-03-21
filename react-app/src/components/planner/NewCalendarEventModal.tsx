/**
 * NewCalendarEventModal
 *
 * Reusable modal for creating / editing a calendar_blocks entry.
 * Extracted from UnifiedPlannerPage so it can be invoked from any surface
 * (kanban cards, daily plan, etc.) without duplicating the form logic.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Alert, Button, Col, Form, Modal, Row, Spinner } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { useGlobalThemes } from '../../hooks/useGlobalThemes';
import { db } from '../../firebase';
import { addDoc, collection, doc, updateDoc } from 'firebase/firestore';
import type { CalendarBlock, Story } from '../../types';
import { LEGACY_THEME_MAP } from '../../constants/globalThemes';
import { pushDiagnosticLog } from '../../hooks/useDiagnosticsLog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlockFormState {
  id?: string;
  title: string;
  theme?: CalendarBlock['theme'];
  category?: CalendarBlock['category'];
  flexibility?: CalendarBlock['flexibility'];
  rationale: string;
  start: string;
  end: string;
  syncToGoogle: boolean;
  subTheme: string;
  persona?: 'personal' | 'work' | null;
  storyId?: string;
  taskId?: string;
  aiScore?: number | null;
  aiReason?: string | null;
  storyInput?: string;
  recurrenceFreq: 'none' | 'daily' | 'weekly';
  recurrenceDays: string[];
  recurrenceUntil: string;
}

export const DEFAULT_BLOCK_FORM: BlockFormState = {
  title: 'Calendar entry',
  theme: 'General',
  category: 'Wellbeing',
  flexibility: 'soft',
  rationale: '',
  start: '',
  end: '',
  syncToGoogle: true,
  subTheme: '',
  persona: null,
  storyId: undefined,
  taskId: undefined,
  aiScore: null,
  aiReason: null,
  storyInput: '',
  recurrenceFreq: 'none',
  recurrenceDays: [],
  recurrenceUntil: '',
};

export interface CalendarComposerPrefillInput {
  title?: string | null;
  startMs?: number | null;
  endMs?: number | null;
  estimateMin?: number | null;
  points?: number | null;
  rationale?: string | null;
  persona?: 'personal' | 'work' | null;
  theme?: string | null;
  category?: string | null;
  storyId?: string;
  taskId?: string;
  aiScore?: number | null;
  aiReason?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toInputValue = (date: Date) => format(date, "yyyy-MM-dd'T'HH:mm");

const stripUndefinedDeep = (value: any): any => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => stripUndefinedDeep(entry))
      .filter((entry) => entry !== undefined);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).reduce<Record<string, any>>((acc, [key, entry]) => {
      const cleaned = stripUndefinedDeep(entry);
      if (cleaned !== undefined) acc[key] = cleaned;
      return acc;
    }, {});
  }
  return value === undefined ? undefined : value;
};

export const buildCalendarComposerInitialValues = (
  input: CalendarComposerPrefillInput,
): Partial<BlockFormState> => {
  const base = new Date();
  base.setMinutes(0, 0, 0);
  base.setHours(base.getHours() + 1);

  const fallbackDuration = Number(input.estimateMin || 0)
    || (Number(input.points || 0) * 60)
    || 60;
  const durationMin = Math.max(15, Math.min(240, Math.round(fallbackDuration)));
  const start = input.startMs ? new Date(input.startMs) : base;
  const end = input.endMs
    ? new Date(input.endMs)
    : new Date(start.getTime() + durationMin * 60 * 1000);
  const persona = (input.persona || 'personal') as 'personal' | 'work';

  return {
    title: String(input.title || DEFAULT_BLOCK_FORM.title).trim() || DEFAULT_BLOCK_FORM.title,
    start: toInputValue(start),
    end: toInputValue(end),
    syncToGoogle: true,
    rationale: String(input.rationale || '').trim(),
    persona,
    theme: String(input.theme || DEFAULT_BLOCK_FORM.theme || 'General'),
    category: (input.category || (persona === 'work' ? 'Work (Main Gig)' : 'Wellbeing')) as any,
    storyId: input.storyId,
    taskId: input.taskId,
    aiScore: Number.isFinite(Number(input.aiScore)) ? Number(input.aiScore) : null,
    aiReason: String(input.aiReason || '').trim() || null,
  };
};

const FALLBACK_THEME_COLORS: Record<string, string> = {
  Health: '#22c55e',
  Growth: '#3b82f6',
  Wealth: '#eab308',
  Tribe: '#8b5cf6',
  Home: '#f97316',
  'Work (Main Gig)': '#0f172a',
  'Side Gig': '#14b8a6',
  'Work Shift': '#0f172a',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface NewCalendarEventModalProps {
  show: boolean;
  onHide: () => void;
  /** Values to seed the form with when the modal opens. */
  initialValues?: Partial<BlockFormState>;
  /** Story list used by the "link to story" autocomplete. */
  stories?: Story[];
  /** Called after a successful save so callers can react (e.g. show a toast). */
  onSaved?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const NewCalendarEventModal: React.FC<NewCalendarEventModalProps> = ({
  show,
  onHide,
  initialValues,
  stories = [],
  onSaved,
}) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { themes: globalThemes } = useGlobalThemes();

  // Derive the default theme from global themes list (mirrors UnifiedPlannerPage logic).
  const legacyThemeNameById = useMemo(() => {
    const map = new Map<number, string>();
    (Object.entries(LEGACY_THEME_MAP) as Array<[string, number]>).forEach(([legacyName, themeId]) => {
      if (!map.has(themeId)) map.set(themeId, legacyName);
    });
    return map;
  }, []);

  const themeOptions = useMemo(() => {
    const isLegacyWorkShift = (v?: string | null) => String(v || '').trim().toLowerCase() === 'work shift';
    if (globalThemes.length === 0) {
      return Object.entries(FALLBACK_THEME_COLORS)
        .filter(([v]) => !isLegacyWorkShift(v))
        .map(([value, color]) => ({ value, label: value, color }));
    }
    return globalThemes
      .filter((t) => !isLegacyWorkShift(t.name) && !isLegacyWorkShift(t.label))
      .map((t) => {
        const legacyName = legacyThemeNameById.get(t.id);
        const value = legacyName || t.name || String(t.id);
        return { value, label: t.label || t.name || value, color: t.color || '#0ea5e9' };
      });
  }, [globalThemes, legacyThemeNameById]);

  const blockDefaultTheme = useMemo(
    () => themeOptions[0]?.value ?? DEFAULT_BLOCK_FORM.theme,
    [themeOptions],
  );

  // Form state — seeded from initialValues each time the modal opens.
  const [blockForm, setBlockForm] = useState<BlockFormState>({
    ...DEFAULT_BLOCK_FORM,
    theme: blockDefaultTheme as CalendarBlock['theme'],
  });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: string; message: string } | null>(null);

  // Sync initialValues → form state whenever the modal opens.
  useEffect(() => {
    if (!show) return;
    setFeedback(null);
    setBlockForm({
      ...DEFAULT_BLOCK_FORM,
      theme: blockDefaultTheme as CalendarBlock['theme'],
      persona: currentPersona || 'personal',
      ...initialValues,
    });
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleHide = useCallback(() => {
    setSaving(false);
    onHide();
  }, [onHide]);

  const handleSubmit = useCallback(async () => {
    if (!currentUser) return;
    if (!blockForm.start || !blockForm.end) {
      setFeedback({ variant: 'danger', message: 'Please provide start and end times.' });
      return;
    }

    const start = new Date(blockForm.start);
    const end = new Date(blockForm.end);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setFeedback({ variant: 'danger', message: 'Please provide valid dates.' });
      return;
    }
    if (end <= start) {
      setFeedback({ variant: 'danger', message: 'End time must be after start time.' });
      return;
    }

    setSaving(true);

    const makeDedupeKey = (title: string, startMs: number, endMs: number) => {
      const raw = `${currentUser.uid}:${Math.round(startMs / 60000)}:${Math.round(endMs / 60000)}:${(title || '').slice(0, 24)}`;
      let h = 0;
      for (let i = 0; i < raw.length; i++) h = (h * 33 + raw.charCodeAt(i)) >>> 0;
      return h.toString(36);
    };

    const recurrence = (() => {
      if (blockForm.recurrenceFreq === 'none') return null;
      const parts = [`FREQ=${blockForm.recurrenceFreq.toUpperCase()}`];
      if (blockForm.recurrenceFreq === 'weekly' && blockForm.recurrenceDays.length) {
        parts.push(`BYDAY=${blockForm.recurrenceDays.join(',')}`);
      }
      if (blockForm.recurrenceUntil) {
        const until = new Date(blockForm.recurrenceUntil);
        until.setHours(23, 59, 59, 0);
        parts.push(`UNTIL=${format(until, "yyyyMMdd'T'HHmmss'Z'")}`);
      }
      return {
        freq: blockForm.recurrenceFreq as 'daily' | 'weekly',
        byDay: blockForm.recurrenceDays,
        until: blockForm.recurrenceUntil ? new Date(blockForm.recurrenceUntil).getTime() : null,
        rrule: `RRULE:${parts.join(';')}`,
      };
    })();

    const linkedStory = blockForm.storyId ? stories.find((s) => s.id === blockForm.storyId) : null;
    const payload: Record<string, unknown> = {
      googleEventId: null,
      syncToGoogle: true,
      taskId: blockForm.taskId || null,
      goalId: linkedStory?.goalId || null,
      storyId: blockForm.storyId || null,
      habitId: null,
      subTheme: blockForm.subTheme || null,
      persona: blockForm.persona || currentPersona || 'personal',
      theme: blockForm.theme,
      category: blockForm.category,
      start: start.getTime(),
      end: end.getTime(),
      dedupeKey: makeDedupeKey(blockForm.title, start.getTime(), end.getTime()),
      flexibility: blockForm.flexibility,
      status: 'proposed',
      colorId: null,
      visibility: 'default',
      createdBy: 'user',
      rationale: blockForm.rationale || null,
      version: 1,
      supersededBy: null,
      ownerUid: currentUser.uid,
      title: blockForm.title,
      source: 'manual',
      entryMethod: 'manual_composer',
      isAiGenerated: false,
      updatedAt: Date.now(),
      recurrence: recurrence
        ? { freq: recurrence.freq, byDay: recurrence.byDay, until: recurrence.until }
        : null,
      aiScore: blockForm.aiScore ?? null,
      aiReason: blockForm.aiReason ?? null,
    };

    const extendedProps = {
      private: {
        storyId: blockForm.storyId || null,
        taskId: blockForm.taskId || null,
        aiScore: blockForm.aiScore ?? null,
        aiReason: blockForm.aiReason ?? null,
        blockId: blockForm.id || undefined,
        dedupeKey: payload.dedupeKey,
      },
    };

    const cleanPayload = stripUndefinedDeep(payload);
    const cleanExtendedProps = stripUndefinedDeep(extendedProps);

    try {
      if (blockForm.id) {
        const ref = doc(db, 'calendar_blocks', blockForm.id);
        await updateDoc(ref, cleanPayload);
      } else {
        const ref = collection(db, 'calendar_blocks');
        await addDoc(ref, { ...cleanPayload, createdAt: Date.now(), extendedProperties: cleanExtendedProps });
      }

      onSaved?.();
      handleHide();
    } catch (err) {
      console.error('NewCalendarEventModal: failed to save calendar entry', err);
      pushDiagnosticLog({
        channel: 'ai-planner',
        level: 'error',
        timestamp: Date.now(),
        message: 'Failed to save calendar entry.',
        details: err instanceof Error ? err.message : String(err),
      });
      const code = String((err as any)?.code || '').toLowerCase();
      const message = String((err as any)?.message || '');
      if (code.includes('permission-denied')) {
        setFeedback({ variant: 'danger', message: 'Save blocked by permissions. Please re-sign in and retry.' });
      } else if (message) {
        setFeedback({ variant: 'danger', message: `Unable to save the calendar entry. ${message}` });
      } else {
        setFeedback({ variant: 'danger', message: 'Unable to save the calendar entry. Please try again.' });
      }
    } finally {
      setSaving(false);
    }
  }, [blockForm, currentUser, currentPersona, stories, handleHide, onSaved]);

  return (
    <Modal show={show} onHide={handleHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>{blockForm.id ? 'Edit calendar entry' : 'New calendar entry'}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {feedback && (
          <Alert variant={feedback.variant} onClose={() => setFeedback(null)} dismissible className="py-2">
            {feedback.message}
          </Alert>
        )}
        <Form className="d-flex flex-column gap-3">
          {(blockForm.aiScore != null || blockForm.aiReason) && (
            <div className="d-flex align-items-center gap-2">
              <strong>AI priority:</strong>
              <span className="badge bg-info text-dark">
                {blockForm.aiScore != null ? Math.round(blockForm.aiScore) : '—'}
              </span>
              {blockForm.aiReason && <span className="text-muted small">{blockForm.aiReason}</span>}
            </div>
          )}
          <Form.Group>
            <Form.Label>Title</Form.Label>
            <Form.Control
              value={blockForm.title}
              onChange={(e) => setBlockForm((prev) => ({ ...prev, title: e.target.value }))}
            />
          </Form.Group>
          {stories.length > 0 && (
            <Form.Group>
              <Form.Label>Link to story (optional)</Form.Label>
              <Form.Control
                list="new-cal-event-story-options"
                placeholder="Search story by title..."
                value={blockForm.storyInput || ''}
                onChange={(e) => setBlockForm((prev) => ({ ...prev, storyInput: e.target.value }))}
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  const match = stories.find((s) => s.title === value || s.id === value);
                  setBlockForm((prev) => ({
                    ...prev,
                    storyId: match ? match.id : prev.storyId,
                    storyInput: match ? (match.title || '') : value,
                    title: match ? (match.title || '') : prev.title,
                    theme: match?.theme ? String(match.theme) : prev.theme,
                  }));
                }}
              />
              <datalist id="new-cal-event-story-options">
                {stories.map((s) => (
                  <option key={s.id} value={s.title || ''} />
                ))}
              </datalist>
            </Form.Group>
          )}
          <Row className="g-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label>Start</Form.Label>
                <Form.Control
                  type="datetime-local"
                  value={blockForm.start}
                  onChange={(e) => setBlockForm((prev) => ({ ...prev, start: e.target.value }))}
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>End</Form.Label>
                <Form.Control
                  type="datetime-local"
                  value={blockForm.end}
                  onChange={(e) => setBlockForm((prev) => ({ ...prev, end: e.target.value }))}
                />
              </Form.Group>
            </Col>
          </Row>
          <Form.Group>
            <Form.Label>Notes / rationale</Form.Label>
            <Form.Control
              as="textarea"
              rows={2}
              value={blockForm.rationale}
              onChange={(e) => setBlockForm((prev) => ({ ...prev, rationale: e.target.value }))}
            />
          </Form.Group>
          <Form.Group>
            <Form.Label>Recurrence</Form.Label>
            <Form.Select
              value={blockForm.recurrenceFreq}
              onChange={(e) =>
                setBlockForm((prev) => ({
                  ...prev,
                  recurrenceFreq: e.target.value as BlockFormState['recurrenceFreq'],
                  recurrenceDays: e.target.value === 'weekly' ? prev.recurrenceDays : [],
                }))
              }
            >
              <option value="none">One-time</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly (pick days)</option>
            </Form.Select>
            {blockForm.recurrenceFreq === 'weekly' && (
              <div className="d-flex flex-wrap gap-2 mt-2">
                {['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].map((day) => (
                  <Form.Check
                    inline
                    key={day}
                    type="checkbox"
                    id={`new-cal-rec-${day}`}
                    label={day}
                    checked={blockForm.recurrenceDays.includes(day)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setBlockForm((prev) => ({
                        ...prev,
                        recurrenceDays: checked
                          ? Array.from(new Set([...(prev.recurrenceDays || []), day]))
                          : (prev.recurrenceDays || []).filter((d) => d !== day),
                      }));
                    }}
                  />
                ))}
              </div>
            )}
            <div className="mt-2">
              <Form.Label className="mb-0">Repeat until (optional)</Form.Label>
              <Form.Control
                type="date"
                value={blockForm.recurrenceUntil}
                onChange={(e) => setBlockForm((prev) => ({ ...prev, recurrenceUntil: e.target.value }))}
              />
            </div>
          </Form.Group>
        </Form>
      </Modal.Body>
      <Modal.Footer>
        {blockForm.storyId && (
          <Button
            variant="outline-info"
            onClick={() => window.open(`/stories/${blockForm.storyId}`, '_blank')}
          >
            Open story
          </Button>
        )}
        <Button variant="outline-secondary" onClick={handleHide}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSubmit} disabled={saving}>
          {saving ? <Spinner size="sm" animation="border" /> : 'Save entry'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export { toInputValue };
export default NewCalendarEventModal;
