/**
 * ShareGoalsPanel — "Make public" toggle for GoalRoadmapV6 and VisualCanvas.
 *
 * Uses a per-profile `canvasShareCode` stored in profiles/{uid}.
 * When published, all user goals get `canvasCode: shareCode` written via batch,
 * making them readable by the Firestore `isCanvasPublished()` rule.
 * Individual goal shareCode/isPublished fields are untouched.
 *
 * Public URL: /public/roadmap/:shareCode
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  getDoc,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { generateShareCode } from '../../utils/shareCodeGenerator';

interface Props {
  uid: string;
}

const ShareGoalsPanel: React.FC<Props> = ({ uid }) => {
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [profileChecked, setProfileChecked] = useState(false);
  /** How the split currently stands, so the panel can say what the link actually exposes. */
  const [sharedCount, setSharedCount] = useState<number | null>(null);
  const [privateCount, setPrivateCount] = useState<number | null>(null);

  // Load existing canvasShareCode from profile
  useEffect(() => {
    if (!uid) return;
    getDoc(doc(db, 'profiles', uid)).then(snap => {
      const code = snap.data()?.canvasShareCode || null;
      setShareCode(code);
      setProfileChecked(true);
    }).catch(() => setProfileChecked(true));
  }, [uid]);

  const publicUrl = shareCode
    ? `${window.location.origin}/public/roadmap/${shareCode}`
    : null;

  /**
   * Publish, or re-publish after marking goals private.
   *
   * `sharePrivate` on a goal holds it back. Sharing used to be all-or-nothing — every goal the
   * user owned got the code — which meant a single private goal made the whole roadmap
   * unshareable. Excluded goals get `canvasCode: null` explicitly rather than merely being
   * skipped: on a re-publish, a goal that WAS public and has since been marked private must
   * have its old code cleared, or the Firestore rule keeps serving it to anyone with the link.
   */
  const handleMakePublic = useCallback(async () => {
    setLoading(true);
    try {
      // Reuse the existing code on a re-publish so links already shared keep working.
      const code = shareCode || generateShareCode();

      const goalsSnap = await getDocs(
        query(collection(db, 'goals'), where('ownerUid', '==', uid))
      );

      const docs = goalsSnap.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = writeBatch(db);
        docs.slice(i, i + 400).forEach((d) => {
          const isPrivate = d.data()?.sharePrivate === true;
          batch.update(d.ref, { canvasCode: isPrivate ? null : code });
        });
        await batch.commit();
      }

      await updateDoc(doc(db, 'profiles', uid), { canvasShareCode: code });
      setShareCode(code);
      setPrivateCount(docs.filter((d) => d.data()?.sharePrivate === true).length);
      setSharedCount(docs.filter((d) => d.data()?.sharePrivate !== true).length);
    } finally {
      setLoading(false);
    }
  }, [uid, shareCode]);

  const handleRevoke = useCallback(async () => {
    if (!shareCode) return;
    setLoading(true);
    try {
      const goalsSnap = await getDocs(
        query(collection(db, 'goals'), where('ownerUid', '==', uid), where('canvasCode', '==', shareCode))
      );
      const docs = goalsSnap.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = writeBatch(db);
        docs.slice(i, i + 400).forEach(d => batch.update(d.ref, { canvasCode: null }));
        await batch.commit();
      }
      await updateDoc(doc(db, 'profiles', uid), { canvasShareCode: null });
      setShareCode(null);
      setSharedCount(null);
      setPrivateCount(null);
    } finally {
      setLoading(false);
    }
  }, [uid, shareCode]);

  /** Current shared/private split, for the panel's summary line. */
  useEffect(() => {
    if (!uid || !open) return;
    getDocs(query(collection(db, 'goals'), where('ownerUid', '==', uid)))
      .then((snap) => {
        const priv = snap.docs.filter((d) => d.data()?.sharePrivate === true).length;
        setPrivateCount(priv);
        setSharedCount(snap.size - priv);
      })
      .catch(() => { /* the counts are informational; failing to load them is not an error */ });
  }, [uid, open]);

  const handleCopy = () => {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!profileChecked) return null;

  return (
    <div className="position-relative">
      <button
        className={`btn btn-sm ${shareCode ? 'btn-success' : 'btn-outline-secondary'}`}
        onClick={() => setOpen(v => !v)}
        title="Share roadmap publicly"
      >
        {shareCode ? '🔗 Public' : '🔗 Share'}
      </button>

      {open && (
        <div
          className="position-absolute end-0 top-100 mt-1 shadow rounded border bg-white p-3"
          style={{ zIndex: 1000, minWidth: 320 }}
        >
          {shareCode ? (
            <>
              <p className="small mb-2 text-success fw-medium">Your roadmap is public</p>
              <div className="d-flex gap-2 mb-2">
                <input
                  type="text"
                  className="form-control form-control-sm"
                  readOnly
                  value={publicUrl || ''}
                />
                <button className="btn btn-sm btn-primary text-nowrap" onClick={handleCopy}>
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              {/* What the link actually exposes, in numbers. "Public" on its own does not tell
                  you whether the goal you meant to hold back is in it. */}
              {sharedCount != null && (
                <p className="small mb-2" style={{ color: 'var(--muted, #6b7280)' }}>
                  {sharedCount} goal{sharedCount === 1 ? '' : 's'} visible
                  {privateCount ? ` · ${privateCount} kept private` : ''}.
                  {privateCount === 0 && ' Mark a goal private in its editor to exclude it.'}
                </p>
              )}
              <div className="d-flex justify-content-between align-items-center gap-2">
                <a
                  href={publicUrl || '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="small"
                >
                  Open ↗
                </a>
                <div className="d-flex gap-2">
                  {/* Re-publishing is how a newly-private goal is withdrawn from a live link:
                      the batch clears its canvasCode. Without this the only way to hide a goal
                      after the fact was to revoke the whole link. */}
                  <button
                    className="btn btn-sm btn-outline-secondary text-nowrap"
                    onClick={handleMakePublic}
                    disabled={loading}
                    title="Re-apply the private flags to this link"
                  >
                    {loading ? <span className="spinner-border spinner-border-sm" /> : 'Re-sync'}
                  </button>
                  <button
                    className="btn btn-sm btn-outline-danger"
                    onClick={handleRevoke}
                    disabled={loading}
                  >
                    Revoke
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="small mb-2 text-muted">
                Make your goal roadmap viewable by anyone with the link — no sign-in, read-only.
                {privateCount
                  ? ` ${privateCount} goal${privateCount === 1 ? '' : 's'} marked private will be excluded.`
                  : ' Goals marked private in their editor are excluded.'}
              </p>
              <button
                className="btn btn-sm btn-primary w-100"
                onClick={handleMakePublic}
                disabled={loading}
              >
                {loading
                  ? <><span className="spinner-border spinner-border-sm me-2" />Publishing…</>
                  : 'Make public'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ShareGoalsPanel;
