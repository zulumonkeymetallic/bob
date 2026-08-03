import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Form, ListGroup, Modal, Spinner } from 'react-bootstrap';
import { collection, deleteField, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Bot, Check, ExternalLink, FileText, RotateCcw, Server, X } from 'lucide-react';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  DelegationEngine,
  DelegationTier,
  describeRouting,
  isAwaitingReview,
} from '../utils/delegationRouting';

/**
 * DelegateToAiModal — one surface for delegating work to an AI and reviewing what comes back.
 *
 * This replaces two features that did the same job badly in parallel:
 *
 *   - the `flaggedToAi` toggle on the edit modals, which queued work with no way to say what
 *     you wanted, which engine should run it, or what to do with the result; and
 *   - ResearchDocModal, which had its own provider/model dropdowns (offering gemini-1.5-flash
 *     and gpt-4o-mini — models the pipeline does not use), wrote briefs to a Firestore
 *     collection the client could not even read, put nothing in Drive, and had no review step.
 *
 * The unified flow: pick an engine, state the ask, and the work is queued. Whichever engine
 * runs it files a Google Doc in the entity's own Drive folder, attaches the link to the item,
 * and moves it into the delegation review state. From here that result is either accepted or
 * rejected with commentary, and a rejection feeds straight back into a rewritten prompt.
 *
 * ON "REVIEW": this is `aiDelegationStatus`, NOT a `status` lane. Stories and tasks use
 * different status scales and neither has a Review value — writing 2 on a task closes it. The
 * chip below says "Review" because that is what the state means to a human; the underlying
 * write is `aiDelegationStatus: 'human_review'`, which is the only review signal in BOB.
 */

export type DelegateEntityType = 'story' | 'task' | 'goal';

interface DelegateToAiModalProps {
  show: boolean;
  onHide: () => void;
  entityType: DelegateEntityType;
  entityId: string | null | undefined;
  /** Used for the initial render; the modal then tracks the live document itself. */
  entity?: any;
}

type ResearchDoc = {
  id: string;
  title?: string;
  docMd?: string;
  driveDocUrl?: string;
  researchPrompt?: string;
  model?: string;
  engine?: string;
  revision?: number;
  source?: string;
  createdAt?: any;
};

const COLLECTIONS: Record<DelegateEntityType, string> = {
  story: 'stories',
  task: 'tasks',
  goal: 'goals',
};

/** research_docs stores the entity id under a per-type field, matching how it is queried. */
const DOC_ID_FIELD: Record<DelegateEntityType, string> = {
  story: 'storyId',
  task: 'taskId',
  goal: 'goalId',
};

const toMillis = (value: any): number => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
};

const ENGINE_OPTIONS: Array<{ id: DelegationEngine; label: string; blurb: string; icon: React.ReactNode }> = [
  {
    id: 'gemini',
    label: 'Gemini (cloud)',
    blurb: 'Runs in Cloud Functions on Vertex. Works whether or not the Mac is awake, and is reachable from China.',
    icon: <Bot size={15} />,
  },
  {
    id: 'hermes',
    label: 'Hermes (Mac)',
    blurb: 'Runs locally on the Mac via run_delegation_cycle.py. Only progresses while that machine is awake and idle.',
    icon: <Server size={15} />,
  },
];

const STATE_CHIPS: Record<string, { label: string; bg: string }> = {
  queued: { label: 'Queued', bg: 'secondary' },
  in_progress: { label: 'Running', bg: 'info' },
  human_review: { label: 'Review', bg: 'warning' },
  revision_requested: { label: 'Revision requested', bg: 'primary' },
  rejected: { label: 'Declined by AI', bg: 'danger' },
  blocked: { label: 'Blocked', bg: 'danger' },
  failed: { label: 'Failed', bg: 'danger' },
};

const DelegateToAiModal: React.FC<DelegateToAiModalProps> = ({ show, onHide, entityType, entityId, entity }) => {
  const { currentUser } = useAuth();
  const [live, setLive] = useState<any>(entity || null);
  const [docs, setDocs] = useState<ResearchDoc[]>([]);
  const [engine, setEngine] = useState<DelegationEngine>('gemini');
  const [prompt, setPrompt] = useState('');
  const [tier, setTier] = useState<DelegationTier | 'auto'>('auto');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showRejectBox, setShowRejectBox] = useState(false);

  const collectionName = COLLECTIONS[entityType];

  // Track the live document so the pipeline's progress shows without reopening the modal.
  useEffect(() => {
    if (!show || !entityId) return;
    const unsub = onSnapshot(doc(db, collectionName, entityId), (snap) => {
      if (snap.exists()) setLive({ id: snap.id, ...snap.data() });
    }, (err) => setError(err?.message || 'Could not read this item'));
    return () => unsub();
  }, [show, entityId, collectionName]);

  // Every AI document produced for this entity. No orderBy — that would need a composite
  // index this project does not define; the list is small, so it is sorted below.
  useEffect(() => {
    if (!show || !entityId || !currentUser?.uid) return;
    const q = query(
      collection(db, 'research_docs'),
      where('ownerUid', '==', currentUser.uid),
      where(DOC_ID_FIELD[entityType], '==', entityId),
    );
    const unsub = onSnapshot(q, (snap) => {
      setDocs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    }, () => setDocs([]));
    return () => unsub();
  }, [show, entityId, entityType, currentUser?.uid]);

  // Seed the form from whatever the item already carries, once per opening.
  useEffect(() => {
    if (!show) return;
    const source = live || entity || {};
    setPrompt(String(source.aiDelegationPrompt || source.title || ''));
    setEngine(String(source.aiDelegationEngine || '') === 'hermes' ? 'hermes' : 'gemini');
    setTier((source.aiDelegationType as DelegationTier) || 'auto');
    setFeedback('');
    setShowRejectBox(false);
    setError(null);
    setNotice(null);
    // Intentionally keyed on `show` alone: re-seeding on every live snapshot would wipe
    // whatever is being typed the moment the pipeline touches the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  const item = live || entity || {};
  const delegationState = String(item.aiDelegationStatus || '');
  const awaitingReview = isAwaitingReview(item);
  const docLink = item.aiDelegationDocumentLink || item.documentLink || null;
  const previousDocLink = item.aiDelegationPreviousDocumentLink || null;
  const revision = Number(item.aiDelegationRevision || 0);
  const queued = item.flaggedToAi === true;

  const sortedDocs = useMemo(
    () => [...docs].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)),
    [docs],
  );

  const routing = useMemo(
    () => describeRouting(prompt, engine, tier, false),
    [prompt, engine, tier],
  );

  const writeDoc = useCallback(async (updates: Record<string, any>) => {
    if (!entityId) throw new Error('No item selected');
    await updateDoc(doc(db, collectionName, entityId), { ...updates, updatedAt: serverTimestamp() });
  }, [collectionName, entityId]);

  const runNow = useCallback(async () => {
    // Hermes has no callable to poke — it polls Firestore on its own schedule.
    if (engine === 'hermes') return 'Queued for Hermes. It will be picked up on the Mac\'s next delegation cycle.';
    // entityId scopes the cycle to this item — without it the callable works the whole queue
    // and the user waits on up to five unrelated documents.
    const res: any = await httpsCallable(functions, 'runAiDelegationNow')({ limit: 1, entityId });
    const mine = (res?.data?.results || [])[0];
    if (mine?.status === 'error') throw new Error(mine.reason || 'Delegation failed');
    if (mine?.status === 'rejected') return `The pipeline declined this: ${mine.reason}`;
    if (mine?.status === 'completed') return 'Done — the document is filed in Drive and this item is now in Review.';
    if (mine?.status === 'skipped') return `Skipped: ${mine.reason}`;
    return 'Delegation cycle run, but this item was not picked up. Check it is still flagged.';
  }, [engine, entityId]);

  const handleDelegate = async (immediate: boolean) => {
    setBusy(immediate ? 'run' : 'queue');
    setError(null);
    setNotice(null);
    try {
      await writeDoc({
        flaggedToAi: true,
        aiDelegationEngine: engine,
        aiDelegationPrompt: prompt.trim(),
        // 'auto' means "let the classifier decide" — the field must be absent for the server
        // to fall through to classifyDelegationTask rather than honouring a stale override.
        aiDelegationType: tier === 'auto' ? deleteField() : tier,
        aiDelegationStatus: 'queued',
        aiDelegatedAt: Date.now(),
      });
      setNotice(immediate
        ? await runNow()
        : 'Queued. The nightly cycle picks this up at 02:30, or run it now from here.');
    } catch (err: any) {
      setError(err?.message || 'Could not delegate this item');
    } finally {
      setBusy(null);
    }
  };

  const handleApprove = async () => {
    setBusy('approve');
    setError(null);
    try {
      await writeDoc({
        aiDelegationStatus: null,
        aiDelegationReviewedAt: serverTimestamp(),
      });
      setNotice('Accepted. The document stays attached; the item is out of review.');
      setShowRejectBox(false);
    } catch (err: any) {
      setError(err?.message || 'Could not mark this reviewed');
    } finally {
      setBusy(null);
    }
  };

  const handleReject = async (immediate: boolean) => {
    const commentary = feedback.trim();
    if (!commentary) {
      setError('Say what is wrong with it — the commentary is what the revised prompt is built from.');
      return;
    }
    setBusy(immediate ? 'reject-run' : 'reject');
    setError(null);
    setNotice(null);
    try {
      await writeDoc({
        // Consumed by resolveWorkingPrompt on the next run, which rewrites the research
        // prompt around it before doing any research.
        aiDelegationFeedback: commentary,
        aiDelegationStatus: 'revision_requested',
        flaggedToAi: true,
        aiDelegationEngine: engine,
      });
      setFeedback('');
      setShowRejectBox(false);
      setNotice(immediate
        ? await runNow()
        : 'Rejected. The prompt will be rewritten around your commentary on the next cycle.');
    } catch (err: any) {
      setError(err?.message || 'Could not record the rejection');
    } finally {
      setBusy(null);
    }
  };

  const handleCancelDelegation = async () => {
    setBusy('cancel');
    setError(null);
    try {
      await writeDoc({ flaggedToAi: false, aiDelegationStatus: null });
      setNotice('Removed from the delegation queue.');
    } catch (err: any) {
      setError(err?.message || 'Could not cancel');
    } finally {
      setBusy(null);
    }
  };

  const chip = STATE_CHIPS[delegationState];
  const working = busy !== null;

  return (
    <Modal show={show} onHide={onHide} size="lg" centered fullscreen="sm-down" scrollable>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.05rem' }}>
          Delegate to AI
          {item.ref && <span className="text-muted ms-2" style={{ fontSize: '0.85rem' }}>{item.ref}</span>}
        </Modal.Title>
      </Modal.Header>

      <Modal.Body>
        <div className="d-flex align-items-center gap-2 mb-3 flex-wrap">
          {chip && <Badge bg={chip.bg}>{chip.label}</Badge>}
          {queued && !chip && <Badge bg="secondary">Queued</Badge>}
          {revision > 0 && <Badge bg="light" text="dark">Revision {revision}</Badge>}
          {item.aiDelegationModel && (
            <span className="text-muted" style={{ fontSize: 12 }}>{item.aiDelegationModel}</span>
          )}
          {!chip && !queued && <span className="text-muted" style={{ fontSize: 12 }}>Not delegated</span>}
        </div>

        {error && <Alert variant="danger" className="py-2" style={{ fontSize: 13 }}>{error}</Alert>}
        {notice && <Alert variant="success" className="py-2" style={{ fontSize: 13 }}>{notice}</Alert>}

        {/* ── Review panel ────────────────────────────────────────────────────
            Comes first when there is something waiting: that is the reason the
            modal was opened, and burying it under the compose form means
            scrolling past a form you do not want to touch. */}
        {awaitingReview && (
          <div className="mb-4 p-3" style={{ border: '1px solid var(--bs-warning)', borderRadius: 8 }}>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <strong style={{ fontSize: 14 }}>Waiting on your review</strong>
              {docLink && (
                <a href={docLink} target="_blank" rel="noreferrer" className="d-inline-flex align-items-center gap-1" style={{ fontSize: 13 }}>
                  Open the document <ExternalLink size={13} />
                </a>
              )}
            </div>
            {item.aiDelegationNote && (
              <div className="text-muted mb-2" style={{ fontSize: 13 }}>{item.aiDelegationNote}</div>
            )}
            {previousDocLink && (
              <div className="mb-2" style={{ fontSize: 12 }}>
                <a href={previousDocLink} target="_blank" rel="noreferrer" className="text-muted">Previous revision</a>
              </div>
            )}

            {!showRejectBox ? (
              <div className="d-flex gap-2 flex-wrap">
                <Button variant="success" size="sm" onClick={handleApprove} disabled={working}>
                  {busy === 'approve' ? <Spinner animation="border" size="sm" /> : <Check size={14} className="me-1" />}
                  Accept
                </Button>
                <Button variant="outline-danger" size="sm" onClick={() => setShowRejectBox(true)} disabled={working}>
                  <X size={14} className="me-1" />
                  Reject with commentary
                </Button>
              </div>
            ) : (
              <>
                <Form.Label style={{ fontSize: 13, fontWeight: 600 }}>What is wrong with it?</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={4}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="e.g. Too generic — I need actual named suppliers with prices, not a framework for choosing one."
                  style={{ fontSize: 13 }}
                />
                <div className="text-muted mt-1 mb-2" style={{ fontSize: 12 }}>
                  This is fed to the model, which rewrites the research prompt around it before
                  researching again. Revisions always run on the top-tier model.
                </div>
                <div className="d-flex gap-2 flex-wrap">
                  <Button variant="danger" size="sm" onClick={() => handleReject(true)} disabled={working}>
                    {busy === 'reject-run' ? <Spinner animation="border" size="sm" /> : <RotateCcw size={14} className="me-1" />}
                    Reject and revise now
                  </Button>
                  <Button variant="outline-secondary" size="sm" onClick={() => handleReject(false)} disabled={working}>
                    {busy === 'reject' ? <Spinner animation="border" size="sm" /> : 'Reject, revise tonight'}
                  </Button>
                  <Button variant="link" size="sm" onClick={() => { setShowRejectBox(false); setError(null); }} disabled={working}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Engine ──────────────────────────────────────────────────────── */}
        <Form.Label style={{ fontSize: 13, fontWeight: 600 }}>Engine</Form.Label>
        <div className="d-flex gap-2 mb-3 flex-wrap">
          {ENGINE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setEngine(opt.id)}
              disabled={working}
              style={{
                flex: '1 1 220px',
                textAlign: 'left',
                padding: '10px 12px',
                borderRadius: 8,
                cursor: 'pointer',
                border: `2px solid ${engine === opt.id ? 'var(--bs-primary)' : 'var(--bs-border-color, #dee2e6)'}`,
                background: engine === opt.id ? 'rgba(13,110,253,0.06)' : 'transparent',
                color: 'inherit',
              }}
            >
              <div className="d-flex align-items-center gap-2" style={{ fontWeight: 600, fontSize: 13 }}>
                {opt.icon}{opt.label}
              </div>
              <div className="text-muted mt-1" style={{ fontSize: 12, lineHeight: 1.35 }}>{opt.blurb}</div>
            </button>
          ))}
        </div>

        {/* ── The ask ─────────────────────────────────────────────────────── */}
        <Form.Label style={{ fontSize: 13, fontWeight: 600 }}>What should it produce?</Form.Label>
        <Form.Control
          as="textarea"
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the document you want back. Defaults to the item's title if left as-is."
          disabled={working}
          style={{ fontSize: 13 }}
        />

        <div className="d-flex align-items-end gap-3 mt-2 mb-3 flex-wrap">
          <div style={{ minWidth: 200 }}>
            <Form.Label style={{ fontSize: 12, fontWeight: 600 }}>Model routing</Form.Label>
            <Form.Select
              size="sm"
              value={tier}
              onChange={(e) => setTier(e.target.value as DelegationTier | 'auto')}
              disabled={working}
            >
              <option value="auto">Auto — best model for the ask</option>
              <option value="simple">Force: simple (fast)</option>
              <option value="research">Force: research</option>
              <option value="analysis">Force: analysis</option>
            </Form.Select>
          </div>
          <div className="text-muted flex-grow-1" style={{ fontSize: 12, paddingBottom: 6 }}>
            {routing.summary}
          </div>
        </div>

        <div className="d-flex gap-2 flex-wrap mb-4">
          <Button variant="primary" size="sm" onClick={() => handleDelegate(true)} disabled={working || !entityId}>
            {busy === 'run' ? <Spinner animation="border" size="sm" /> : <Bot size={14} className="me-1" />}
            {queued ? 'Update and run now' : 'Delegate and run now'}
          </Button>
          <Button variant="outline-primary" size="sm" onClick={() => handleDelegate(false)} disabled={working || !entityId}>
            {busy === 'queue' ? <Spinner animation="border" size="sm" /> : 'Queue for tonight'}
          </Button>
          {queued && (
            <Button variant="outline-secondary" size="sm" onClick={handleCancelDelegation} disabled={working}>
              {busy === 'cancel' ? <Spinner animation="border" size="sm" /> : 'Remove from queue'}
            </Button>
          )}
        </div>

        {/* ── Documents ───────────────────────────────────────────────────── */}
        <div className="d-flex justify-content-between align-items-center mb-2">
          <strong style={{ fontSize: 13 }}>Documents</strong>
          <Badge bg="secondary">{sortedDocs.length}</Badge>
        </div>
        <ListGroup style={{ maxHeight: 240, overflowY: 'auto' }}>
          {sortedDocs.map((d) => (
            <ListGroup.Item key={d.id} className="d-flex justify-content-between align-items-start gap-2">
              <div style={{ minWidth: 0 }}>
                <div className="d-flex align-items-center gap-2">
                  <FileText size={14} />
                  <span style={{ fontSize: 13, fontWeight: 500, overflowWrap: 'anywhere' }}>{d.title || 'Research document'}</span>
                </div>
                <div className="text-muted" style={{ fontSize: 11 }}>
                  {[d.model, d.engine, d.revision ? `rev ${d.revision}` : null].filter(Boolean).join(' · ') || d.source || '—'}
                </div>
              </div>
              {d.driveDocUrl && (
                <a href={d.driveDocUrl} target="_blank" rel="noreferrer" className="flex-shrink-0" title="Open in Google Drive">
                  <ExternalLink size={14} />
                </a>
              )}
            </ListGroup.Item>
          ))}
          {sortedDocs.length === 0 && (
            <ListGroup.Item className="text-muted" style={{ fontSize: 13 }}>
              {docLink
                ? <>No indexed documents yet — <a href={docLink} target="_blank" rel="noreferrer">the attached document</a> was produced before indexing existed.</>
                : 'Nothing produced yet.'}
            </ListGroup.Item>
          )}
        </ListGroup>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" size="sm" onClick={onHide}>Close</Button>
      </Modal.Footer>
    </Modal>
  );
};

export default DelegateToAiModal;
