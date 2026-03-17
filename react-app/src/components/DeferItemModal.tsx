import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { normalizePlannerSchedulingError } from '../utils/plannerScheduling';

type ItemType = 'task' | 'story';

interface DeferralOption {
  key: string;
  dateMs: number;
  label: string;
  rationale: string;
  source?: string;
  utilizationPercent?: number;
}

interface DeferItemModalProps {
  show: boolean;
  onHide: () => void;
  itemType: ItemType;
  itemId: string;
  itemTitle: string;
  focusContext?: {
    isFocusAligned?: boolean;
    activeFocusGoals?: Array<{
      id: string;
      title?: string | null;
      focusRootGoalIds?: string[];
      focusLeafGoalIds?: string[];
      goalIds?: string[];
    }>;
  };
  onApply: (payload: { dateMs: number; rationale: string; source: string }) => Promise<void>;
}

const toInputDate = (ms: number) => {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const startOfDayMs = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const DeferItemModal: React.FC<DeferItemModalProps> = ({
  show,
  onHide,
  itemType,
  itemId,
  itemTitle,
  focusContext,
  onApply,
}) => {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<DeferralOption[]>([]);
  const [topOptions, setTopOptions] = useState<DeferralOption[]>([]);
  const [moreOptions, setMoreOptions] = useState<DeferralOption[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [customDate, setCustomDate] = useState<string>('');
  const [showMoreSuggestions, setShowMoreSuggestions] = useState(false);
  const hasFocusPressure = !focusContext?.isFocusAligned && (focusContext?.activeFocusGoals?.length || 0) > 0;

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    console.info('[DeferItemModal] opened', { itemType, itemId, itemTitle });

    const loadOptions = async () => {
      setLoading(true);
      setError(null);
      try {
        const callable = httpsCallable(functions, 'suggestDeferralOptions');
        const resp: any = await callable({
          itemType,
          itemId,
          horizonDays: 21,
          focusContext,
        });
        const next = Array.isArray(resp?.data?.options) ? resp.data.options : [];
        const top = Array.isArray(resp?.data?.topOptions) ? resp.data.topOptions : next.slice(0, 3);
        const more = Array.isArray(resp?.data?.moreOptions) ? resp.data.moreOptions : next.slice(3);
        if (cancelled) return;
        console.info('[DeferItemModal] suggestions_loaded', {
          itemType,
          itemId,
          options: next.length,
          topOptions: top.length,
          moreOptions: more.length,
        });
        setOptions(next);
        setTopOptions(top);
        setMoreOptions(more);
        setSelectedKey(top[0]?.key || next[0]?.key || 'custom');
        setShowMoreSuggestions(false);
      } catch (err: any) {
        if (cancelled) return;
        console.error('[DeferItemModal] suggestions_failed', { itemType, itemId, err });
        setError(normalizePlannerSchedulingError(err).message || 'Could not generate defer suggestions.');
        setOptions([]);
        setTopOptions([]);
        setMoreOptions([]);
        setSelectedKey('custom');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadOptions();
    return () => {
      cancelled = true;
    };
  }, [show, itemId, itemType, itemTitle, focusContext]);

  const selectedOption = useMemo(
    () => options.find((opt) => opt.key === selectedKey) || null,
    [options, selectedKey]
  );

  const handleApply = async () => {
    setError(null);
    let dateMs: number | null = null;
    let rationale = '';
    let source = 'custom';

    if (selectedKey === 'custom') {
      if (!customDate) {
        setError('Choose a custom defer date.');
        return;
      }
      const parsed = Date.parse(`${customDate}T12:00:00`);
      if (Number.isNaN(parsed)) {
        setError('Custom date is invalid.');
        return;
      }
      dateMs = startOfDayMs(parsed);
      rationale = 'Custom date selected by user.';
    } else if (selectedOption) {
      dateMs = startOfDayMs(Number(selectedOption.dateMs));
      rationale = selectedOption.rationale || selectedOption.label;
      source = selectedOption.source || 'capacity_forecast';
    }

    if (!dateMs || Number.isNaN(dateMs)) {
      setError('Select a valid defer target.');
      return;
    }

    setApplying(true);
    console.info('[DeferItemModal] apply_clicked', {
      itemType,
      itemId,
      itemTitle,
      selectedKey,
      dateMs,
      source,
      rationale,
    });
    try {
      await onApply({ dateMs, rationale, source });
      onHide();
    } catch (err: any) {
      console.error('[DeferItemModal] apply_failed', { itemType, itemId, err });
      setError(normalizePlannerSchedulingError(err).message || 'Failed to defer this item.');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: 16 }}>Defer intelligently</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="mb-2" style={{ fontSize: 13 }}>
          <strong>{itemTitle || `Untitled ${itemType}`}</strong>
        </div>
        <p className="text-muted small mb-3">
          Suggestions are ranked to reduce near-term overload using sprint windows and calendar utilization.
        </p>
        {hasFocusPressure && (
          <Alert variant="info" className="py-2 small">
            This item is outside your active focus goals. Deferring it can free capacity for focus work.
          </Alert>
        )}

        {error && <Alert variant="warning" className="py-2">{error}</Alert>}

        {loading ? (
          <div className="d-flex align-items-center gap-2 text-muted small">
            <Spinner animation="border" size="sm" />
            Loading defer suggestions...
          </div>
        ) : (
          <>
            {topOptions.map((opt) => (
              <Form.Check
                key={opt.key}
                type="radio"
                name="defer-option"
                id={`defer-option-${opt.key}`}
                checked={selectedKey === opt.key}
                onChange={() => setSelectedKey(opt.key)}
                className="mb-2"
                label={
                  <span>
                    <strong>{opt.label}</strong>
                    <span className="text-muted"> ({new Date(opt.dateMs).toLocaleDateString()})</span>
                    <div className="text-muted small">{opt.rationale}</div>
                  </span>
                }
              />
            ))}

            {moreOptions.length > 0 && (
              <div className="mt-2 mb-2">
                <Button
                  variant="link"
                  size="sm"
                  className="p-0"
                  onClick={() => setShowMoreSuggestions((prev) => !prev)}
                >
                  {showMoreSuggestions
                    ? 'Hide additional suggestions'
                    : `Show ${moreOptions.length} more suggestion${moreOptions.length === 1 ? '' : 's'}`}
                </Button>
              </div>
            )}

            {showMoreSuggestions && moreOptions.map((opt) => (
              <Form.Check
                key={opt.key}
                type="radio"
                name="defer-option"
                id={`defer-option-${opt.key}`}
                checked={selectedKey === opt.key}
                onChange={() => setSelectedKey(opt.key)}
                className="mb-2"
                label={
                  <span>
                    <strong>{opt.label}</strong>
                    <span className="text-muted"> ({new Date(opt.dateMs).toLocaleDateString()})</span>
                    <div className="text-muted small">{opt.rationale}</div>
                  </span>
                }
              />
            ))}

            <Form.Check
              type="radio"
              name="defer-option"
              id="defer-option-custom"
              checked={selectedKey === 'custom'}
              onChange={() => setSelectedKey('custom')}
              className="mt-3"
              label="Pick a custom date"
            />

            {selectedKey === 'custom' && (
              <Form.Control
                type="date"
                className="mt-2"
                value={customDate}
                min={toInputDate(Date.now())}
                onChange={(e) => setCustomDate(e.target.value)}
              />
            )}
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" size="sm" onClick={onHide} disabled={applying}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleApply} disabled={loading || applying}>
          {applying ? <Spinner animation="border" size="sm" className="me-1" /> : null}
          Apply defer
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default DeferItemModal;
