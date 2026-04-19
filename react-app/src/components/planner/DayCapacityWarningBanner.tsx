import React, { useEffect, useState } from 'react';
import { Alert, Button, ProgressBar } from 'react-bootstrap';
import { AlertTriangle, ChevronDown, ChevronUp, X } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db } from '../../firebase';
import { functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import './DayCapacityWarningBanner.css';

interface CapacityWarning {
  type: string;
  date: string;
  totalCapacity: number;
  totalDemand: number;
  shortfall: number;
  utilizationPercent: number;
  overCapacityBlocks: Array<{
    blockId: string;
    title: string;
    excess: number;
    itemsToDefer: any[];
  }>;
  message: string;
  createdAt: any;
}

const DayCapacityWarningBanner: React.FC = () => {
  const { currentUser } = useAuth();
  const [warning, setWarning] = useState<CapacityWarning | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isDismissed, setIsDismissed] = useState(false);
  const [applyingDeferrals, setApplyingDeferrals] = useState(false);
  const [applyResult, setApplyResult] = useState<string | null>(null);

  const buildSuggestedItems = () => {
    const allItems = (warning?.overCapacityBlocks || []).flatMap((block) => block.itemsToDefer || []);
    const unique = new Map<string, { sourceType: string; sourceId: string }>();
    for (const item of allItems) {
      const sourceType = String(item?.sourceType || '').toLowerCase();
      const sourceId = String(item?.sourceId || '').trim();
      if (!sourceId || (sourceType !== 'task' && sourceType !== 'story')) continue;
      unique.set(`${sourceType}:${sourceId}`, { sourceType, sourceId });
    }
    return Array.from(unique.values());
  };

  const applySuggestedDeferrals = async () => {
    const items = buildSuggestedItems();
    if (!items.length) {
      setApplyResult('No deferrable task/story items found in suggestions.');
      return;
    }
    setApplyingDeferrals(true);
    setApplyResult(null);
    try {
      const fn = httpsCallable(functions, 'applyCapacityDeferrals');
      const res: any = await fn({
        reason: 'capacity_overbooked_today',
        daysAhead: 1,
        items,
      });
      const updated = Number(res?.data?.updated || 0);
      setApplyResult(`Applied deferrals to ${updated} items.`);
    } catch (error: any) {
      setApplyResult(`Failed to apply deferrals: ${error?.message || 'Unknown error'}`);
    } finally {
      setApplyingDeferrals(false);
    }
  };

  useEffect(() => {
    if (!currentUser?.uid) {
      setWarning(null);
      return;
    }

    // Subscribe to capacity warning for today
    const unsubscribe = onSnapshot(
      doc(db, 'users', currentUser.uid, 'planner_alerts', 'capacity-warning'),
      (docSnap) => {
        const data = docSnap.data() as CapacityWarning | undefined;
        if (data) {
          // Check if warning is for today
          const today = new Date().toISOString().split('T')[0];
          if (data.date === today && !isDismissed) {
            setWarning(data);
          } else {
            setWarning(null);
          }
        } else {
          setWarning(null);
        }
      },
      (error) => {
        console.error('[DayCapacityWarningBanner] Error loading warning:', error?.message);
      }
    );

    return () => unsubscribe();
  }, [currentUser?.uid, isDismissed]);

  if (!warning || isDismissed) {
    return null;
  }

  const progressVariant = warning.utilizationPercent > 100 ? 'danger' : warning.utilizationPercent > 80 ? 'warning' : 'success';

  return (
    <Alert
      variant="warning"
      className="day-capacity-warning-banner d-flex align-items-start gap-3 mb-3"
      style={{
        borderLeft: `4px solid ${warning.utilizationPercent > 100 ? '#dc3545' : '#ffc107'}`,
        backgroundColor: warning.utilizationPercent > 100 ? '#ffe5e5' : '#fff8e5',
      }}
    >
      <div className="flex-shrink-0 mt-1">
        <AlertTriangle
          size={20}
          color={warning.utilizationPercent > 100 ? '#dc3545' : '#ffc107'}
        />
      </div>

      <div className="flex-grow-1">
        <div className="d-flex align-items-center justify-content-between mb-2">
          <div>
            <h6 className="mb-1" style={{ color: warning.utilizationPercent > 100 ? '#dc3545' : '#d9a60f' }}>
              {warning.utilizationPercent > 100 ? '🚨 Capacity Overbooked' : '⚠️ Capacity Warning'}
            </h6>
            <p className="mb-2 small text-muted">
              {warning.utilizationPercent > 100
                ? `You have ${warning.shortfall.toFixed(1)} points of work beyond your planned capacity.`
                : `Your calendar is ${warning.utilizationPercent}% full today.`}
            </p>
          </div>
          <button
            className="btn-close btn-close-custom flex-shrink-0"
            onClick={() => setIsDismissed(true)}
            aria-label="Dismiss"
            style={{ cursor: 'pointer' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Capacity Bar */}
        <div className="mb-2">
          <div className="d-flex justify-content-between align-items-center mb-1">
            <small className="text-muted">Daily Capacity</small>
            <small className="fw-bold">
              {warning.totalDemand.toFixed(1)} / {warning.totalCapacity.toFixed(1)} points ({warning.utilizationPercent}%)
            </small>
          </div>
          <ProgressBar
            now={Math.min(warning.utilizationPercent, 100)}
            max={100}
            variant={progressVariant}
            style={{ height: '6px' }}
            className="capacity-progress-bar"
          />
          {warning.utilizationPercent > 100 && (
            <small className="d-block text-danger mt-1">
              ↑ {warning.shortfall.toFixed(1)} points over capacity
            </small>
          )}
        </div>

        {/* Recommendation */}
        {warning.message && (
          <p className="small text-secondary mb-3" style={{ fontStyle: 'italic' }}>
            💡 {warning.message}
          </p>
        )}

        {/* Over-Capacity Blocks */}
        {warning.overCapacityBlocks && warning.overCapacityBlocks.length > 0 && (
          <div className="mt-3">
            <button
              className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-2"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              {warning.overCapacityBlocks.length} Over-Capacity Block{warning.overCapacityBlocks.length !== 1 ? 's' : ''}
            </button>

            {isExpanded && (
              <div className="over-capacity-blocks mt-2 ps-3">
                {warning.overCapacityBlocks.map((block, idx) => (
                  <div key={idx} className="mb-2">
                    <small className="d-block fw-bold text-truncate">{block.title}</small>
                    <small className="text-muted d-block">Excess: {block.excess.toFixed(2)} points</small>
                    {block.itemsToDefer && block.itemsToDefer.length > 0 && (
                      <small className="text-secondary d-block">
                        Consider deferring: {block.itemsToDefer.map((item) => item.title).join(', ')}
                      </small>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="d-flex gap-2 mt-3">
          <Button
            size="sm"
            variant="warning"
            onClick={applySuggestedDeferrals}
            disabled={applyingDeferrals}
          >
            {applyingDeferrals ? 'Applying…' : 'Apply suggested deferrals'}
          </Button>
          <Button
            size="sm"
            variant="outline-warning"
            onClick={() => {
              // Link to planner to review/extend blocks
              window.location.pathname = '/planner';
            }}
          >
            Review Blocks
          </Button>
          <Button
            size="sm"
            variant="outline-danger"
            onClick={() => {
              // Link to tasks/chores filtered by today
              window.location.pathname = '/tasks?due=today';
            }}
          >
            Review Items
          </Button>
        </div>
        {applyResult && (
          <small className="d-block mt-2 text-muted">{applyResult}</small>
        )}
      </div>
    </Alert>
  );
};

export default DayCapacityWarningBanner;
