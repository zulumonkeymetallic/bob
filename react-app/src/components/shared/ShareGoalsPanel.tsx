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

  const handleMakePublic = useCallback(async () => {
    setLoading(true);
    try {
      const code = generateShareCode();

      // Load all user goals
      const goalsSnap = await getDocs(
        query(collection(db, 'goals'), where('ownerUid', '==', uid))
      );

      // Batch-update in chunks of 400
      const docs = goalsSnap.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = writeBatch(db);
        docs.slice(i, i + 400).forEach(d => batch.update(d.ref, { canvasCode: code }));
        await batch.commit();
      }

      // Save to profile
      await updateDoc(doc(db, 'profiles', uid), { canvasShareCode: code });
      setShareCode(code);
    } finally {
      setLoading(false);
    }
  }, [uid]);

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
    } finally {
      setLoading(false);
    }
  }, [uid, shareCode]);

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
              <div className="d-flex justify-content-between align-items-center">
                <a
                  href={publicUrl || '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="small"
                >
                  Open ↗
                </a>
                <button
                  className="btn btn-sm btn-outline-danger"
                  onClick={handleRevoke}
                  disabled={loading}
                >
                  {loading ? <span className="spinner-border spinner-border-sm" /> : 'Revoke access'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="small mb-2 text-muted">
                Make your goal roadmap publicly viewable via a shareable link.
                Anyone with the link can view your goals (read-only).
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
