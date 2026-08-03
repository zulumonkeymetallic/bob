/**
 * FinanceSummaryWidget — compact Overview dashboard card.
 * Reads the last 30 days of monzo_transactions directly from Firestore.
 * Shows: discretionary spend, top 3 categories, uncategorized count.
 * Navigates to /finance/dashboard on interaction.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Card, Spinner } from 'react-bootstrap';
import { collection, onSnapshot, query, where, orderBy, limit } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { PoundSterling, Tag, AlertCircle } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { resolveTransactionCategory } from '../../utils/financeBuckets';
import BucketDonut, { BucketSlice } from '../finance/BucketDonut';

const fmt = (pence: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Math.abs(pence) / 100);

interface TxRow {
  amountMinor: number;
  userCategoryKey?: string | null;
  userCategoryLabel?: string | null;
  aiCategoryKey?: string | null;
  aiCategoryLabel?: string | null;
  userCategoryType?: string | null;
  aiBucket?: string | null;
  defaultCategoryType?: string | null;
  createdISO?: string | null;
}

const FinanceSummaryWidget: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [txns, setTxns] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);

  const thirtyDaysAgoISO = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }, []);

  useEffect(() => {
    if (!currentUser?.uid) { setLoading(false); return; }
    const q = query(
      collection(db, 'monzo_transactions'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('createdISO', 'desc'),
      limit(500),
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs
        .map((d) => d.data() as TxRow)
        .filter((r) => {
          if ((r.amountMinor ?? 0) >= 0) return false;
          if (!r.createdISO) return false;
          return r.createdISO.slice(0, 10) >= thirtyDaysAgoISO;
        });
      setTxns(rows);
      setLoading(false);
    }, () => { setTxns([]); setLoading(false); });
    return () => unsub();
  }, [currentUser?.uid, thirtyDaysAgoISO]);

  const stats = useMemo(() => {
    let discretionaryPence = 0;
    let mandatoryPence = 0;
    let totalSpendPence = 0;
    let uncategorized = 0;
    const categoryTotals: Record<string, { label: string; pence: number }> = {};
    const bucketTotals: Record<string, number> = {};

    for (const tx of txns) {
      const amt = Math.abs(tx.amountMinor ?? 0);

      // Shared resolver rather than a local precedence chain — this widget used
      // to rank userCategoryType above aiBucket but below nothing else, which
      // disagreed with every other surface.
      const resolved = resolveTransactionCategory(tx);
      if (resolved.bucket === 'bank_transfer') continue;

      totalSpendPence += amt;
      bucketTotals[resolved.bucket] = (bucketTotals[resolved.bucket] || 0) + amt;
      if (resolved.bucketV4 === 'optional') discretionaryPence += amt;
      if (resolved.bucketV4 === 'mandatory') mandatoryPence += amt;

      const catKey = tx.userCategoryKey || tx.aiCategoryKey || null;
      const catLabel = tx.userCategoryLabel || tx.aiCategoryLabel || catKey || 'Uncategorised';
      if (!catKey) {
        uncategorized++;
      } else {
        if (!categoryTotals[catKey]) categoryTotals[catKey] = { label: catLabel, pence: 0 };
        categoryTotals[catKey].pence += amt;
      }
    }

    const topCategories = Object.entries(categoryTotals)
      .sort((a, b) => b[1].pence - a[1].pence)
      .slice(0, 3)
      .map(([key, val]) => ({ key, label: val.label, pence: val.pence }));

    const discretionaryPct = totalSpendPence > 0
      ? Math.round((discretionaryPence / totalSpendPence) * 100)
      : 0;

    const donutData: BucketSlice[] = Object.entries(bucketTotals)
      .map(([bucket, pence]) => ({ bucket, pence }));

    return {
      discretionaryPence,
      mandatoryPence,
      totalSpendPence,
      uncategorized,
      topCategories,
      discretionaryPct,
      donutData,
    };
  }, [txns]);

  return (
    <Card className="shadow-sm border-0 h-100">
      <Card.Header className="d-flex align-items-center justify-content-between">
        <div className="fw-semibold d-flex align-items-center gap-2">
          <PoundSterling size={15} />
          Finance Summary
        </div>
        <span
          className="small text-primary"
          style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
          onClick={() => navigate('/finance/dashboard')}
        >
          Full dashboard
        </span>
      </Card.Header>
      <Card.Body className="p-2">
        {loading ? (
          <div className="d-flex align-items-center gap-2 text-muted small p-1">
            <Spinner size="sm" animation="border" /> Loading…
          </div>
        ) : txns.length === 0 ? (
          <div className="text-muted small p-1">No transactions in the last 30 days.</div>
        ) : (
          <div className="d-flex flex-column gap-2">
            {/* Total spend */}
            <div
              className="d-flex align-items-center justify-content-between"
              style={{ cursor: 'pointer' }}
              onClick={() => navigate('/finance/dashboard')}
            >
              <span className="small text-muted">Total spend (30d)</span>
              <span className="fw-bold">{fmt(stats.totalSpendPence)}</span>
            </div>

            {/* Mandatory vs discretionary. Replaces a bare progress bar that only
                ever showed one number and no comparison. */}
            <BucketDonut
              data={stats.donutData}
              size="sm"
              showLegend
              centreLabel={`${stats.discretionaryPct}%`}
              centreSubLabel="discretionary"
              onSliceClick={() => navigate('/finance/dashboard?tab=spend')}
            />
            <div className="d-flex align-items-center justify-content-between small">
              <span className="text-muted">Mandatory</span>
              <span className="fw-semibold">{fmt(stats.mandatoryPence)}</span>
            </div>
            <div className="d-flex align-items-center justify-content-between small">
              <span className="text-muted">Discretionary</span>
              <span className="fw-semibold">{fmt(stats.discretionaryPence)}</span>
            </div>

            {/* Top categories */}
            {stats.topCategories.length > 0 && (
              <div>
                <div className="d-flex align-items-center gap-1 mb-1">
                  <Tag size={11} className="text-muted" />
                  <span className="small text-muted text-uppercase fw-semibold" style={{ fontSize: '0.65rem', letterSpacing: '0.04em' }}>Top categories</span>
                </div>
                <div className="d-flex flex-column gap-1">
                  {stats.topCategories.map((cat) => (
                    <div
                      key={cat.key}
                      className="d-flex align-items-center justify-content-between"
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/finance/dashboard?tab=spend`)}
                    >
                      <span className="small text-truncate" style={{ maxWidth: '70%' }}>{cat.label}</span>
                      <span className="small text-muted">{fmt(cat.pence)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Uncategorized */}
            {stats.uncategorized > 0 && (
              <div
                className="d-flex align-items-center gap-2"
                style={{ cursor: 'pointer' }}
                onClick={() => navigate('/finance/dashboard')}
              >
                <AlertCircle size={12} className="text-warning flex-shrink-0" />
                <span className="small text-warning">{stats.uncategorized} uncategorised</span>
                <Badge bg="warning" text="dark" pill style={{ fontSize: '0.6rem', marginLeft: 'auto' }}>Classify</Badge>
              </div>
            )}
          </div>
        )}
      </Card.Body>
    </Card>
  );
};

export default FinanceSummaryWidget;
