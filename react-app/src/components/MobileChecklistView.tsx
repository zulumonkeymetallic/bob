import React, { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import ChecklistPanel from './ChecklistPanel';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';

const MobileChecklistView: React.FC = () => {
  const { currentUser } = useAuth();
  const [summary, setSummary] = useState<any | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    if (!currentUser) {
      setSummary(null);
      setSummaryLoading(false);
      return;
    }
    setSummaryLoading(true);
    const summariesRef = collection(db, 'daily_summaries');
    const q = query(
      summariesRef,
      where('ownerUid', '==', currentUser.uid),
      orderBy('generatedAt', 'desc'),
      limit(1),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const doc = snapshot.docs[0]?.data() as any;
        setSummary(doc?.summary || null);
        setSummaryLoading(false);
      },
      () => setSummaryLoading(false),
    );
    return () => unsubscribe();
  }, [currentUser]);

  if (!currentUser) {
    return <div className="p-3">Please sign in to view your checklist.</div>;
  }

  const briefing = summary?.dailyBriefing || null;
  const dailyChecklist = summary?.dailyChecklist || null;

  return (
    <div className="container py-3" style={{ maxWidth: 720 }}>
      <h4 className="mb-3">Today</h4>
      {summaryLoading && (
        <div className="text-muted small mb-3">Syncing the latest briefing&hellip;</div>
      )}
      {briefing ? (
        <div className="mb-3 p-3 border rounded" style={{ background: '#f3f4ff' }}>
          {briefing.headline && <div className="fw-semibold mb-1">{briefing.headline}</div>}
          {briefing.body && <div className="mb-1" style={{ fontSize: 14 }}>{briefing.body}</div>}
          {briefing.checklist && (
            <div className="text-muted" style={{ fontSize: 13 }}>{briefing.checklist}</div>
          )}
        </div>
      ) : null}
      {!briefing && !summaryLoading && (
        <div className="mb-3" style={{ fontSize: 13, color: '#6b7280' }}>
          Daily briefing will appear here once nightly maintenance runs.
        </div>
      )}
      <ChecklistPanel dailyChecklist={dailyChecklist} />
    </div>
  );
};

export default MobileChecklistView;
