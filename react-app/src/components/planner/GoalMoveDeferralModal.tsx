/**
 * GoalMoveDeferralModal — "you moved the goal; shall its stories follow?"
 *
 * Moving a goal changes when its work is meant to happen, but its stories keep whatever sprint
 * they were already in. Overnight, functions/alignStoriesToGoalSprints.js silently repoints
 * them. This asks at the moment of the move instead, using that job's own rule (see
 * goalStoryRealignment) so the answer offered here is the answer that will stick.
 *
 * Declining a story writes `sprintAlignmentOverride: true` — the flag the overnight job checks
 * before touching anything. Without it, "leave this one where it is" would last until 02:00
 * and then be quietly undone, which is worse than never asking.
 *
 * Not shown when there is nothing to decide: the caller only opens it if proposeRealignments
 * returns something.
 */
import React, { useEffect, useState } from 'react';
import { Modal, Button, Form, Alert, Spinner } from 'react-bootstrap';
import { ArrowRight } from 'lucide-react';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase';
import { themeVars } from '../../utils/themeVars';
import type { RealignProposal } from '../../utils/goalStoryRealignment';

interface GoalMoveDeferralModalProps {
  show: boolean;
  onClose: () => void;
  goalTitle: string;
  proposals: RealignProposal[];
}

const GoalMoveDeferralModal: React.FC<GoalMoveDeferralModalProps> = ({
  show, onClose, goalTitle, proposals,
}) => {
  /** Story ids to move. Everything is opted IN — following the goal is the expected case. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (show) {
      setSelected(new Set(proposals.map((p) => p.story.id)));
      setError(null);
    }
  }, [show, proposals]);

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const apply = async () => {
    setSaving(true);
    setError(null);
    try {
      // One batch: either the whole decision lands or none of it does. A half-applied
      // realignment is worse than an unapplied one, because the overnight job would then
      // finish the job differently from what was shown.
      const batch = writeBatch(db);
      for (const p of proposals) {
        const ref = doc(db, 'stories', p.story.id);
        if (selected.has(p.story.id)) {
          batch.update(ref, { sprintId: p.toSprintId, updatedAt: serverTimestamp() } as any);
        } else {
          // Declined: pin it so the nightly alignment leaves it alone.
          batch.update(ref, { sprintAlignmentOverride: true, updatedAt: serverTimestamp() } as any);
        }
      }
      await batch.commit();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not update the stories');
    } finally {
      setSaving(false);
    }
  };

  const moveCount = selected.size;
  const keepCount = proposals.length - moveCount;

  return (
    <Modal show={show} onHide={saving ? undefined : onClose} size="lg" centered scrollable>
      <Modal.Header closeButton={!saving}>
        <Modal.Title style={{ fontSize: 18 }}>Move this goal&apos;s stories?</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        <p className="small" style={{ color: themeVars.muted as string }}>
          <strong style={{ color: themeVars.text as string }}>{goalTitle}</strong> has moved.
          {' '}These {proposals.length} {proposals.length === 1 ? 'story is' : 'stories are'} now
          in a sprint that no longer matches it. Unticking one keeps it where it is — and stops
          the overnight alignment moving it later.
        </p>

        {error && <Alert variant="danger" className="py-2 small">{error}</Alert>}

        <div style={{ border: '1px solid var(--line, #e5e7eb)', borderRadius: 6, overflow: 'hidden' }}>
          {proposals.map((p, i) => (
            <label
              key={p.story.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', margin: 0,
                borderTop: i === 0 ? undefined : '1px solid var(--line, #e5e7eb)',
                cursor: saving ? 'default' : 'pointer', fontSize: 13,
              }}
            >
              <Form.Check
                type="checkbox"
                checked={selected.has(p.story.id)}
                disabled={saving}
                onChange={() => toggle(p.story.id)}
                style={{ margin: 0 }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ color: themeVars.muted as string, marginRight: 6, fontSize: 11 }}>
                  {p.story.ref}
                </span>
                {p.story.title}
              </span>
              <span style={{
                display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
                fontSize: 11, color: themeVars.muted as string,
              }}>
                {p.fromLabel}
                <ArrowRight size={12} />
                <span style={{ color: themeVars.text as string, fontWeight: 600 }}>{p.toLabel}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="small mt-2" style={{ color: themeVars.muted as string }}>
          {moveCount} to move{keepCount > 0 ? `, ${keepCount} pinned where they are` : ''}.
        </div>
      </Modal.Body>

      <Modal.Footer>
        {/* "Leave all" is not Cancel: the goal has ALREADY moved by the time this opens, so
            there is nothing to cancel. It pins every story instead, which is a real decision. */}
        <Button variant="outline-secondary" size="sm" disabled={saving} onClick={onClose}>
          Decide later
        </Button>
        <Button variant="primary" size="sm" disabled={saving} onClick={apply}>
          {saving ? <><Spinner animation="border" size="sm" className="me-2" />Applying…</> : 'Apply'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default GoalMoveDeferralModal;
