import { useState, useEffect, useRef } from 'react';
import { collection, doc, onSnapshot, orderBy, query, where, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

interface DashboardData {
  currentPeriod: string;
  totalSpend: number;
  totalIncome: number;
  totalSavings: number;
  discretionarySpend: number;
  mandatorySpend: number;
  byCategory: Record<string, number>;
  recentTransactions: any[];
  uncategorizedCount: number;
  pots?: any[];
  goals?: any[];
}

export function useDashboardData() {
  const { currentUser } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const unsubTxRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!currentUser) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // Subscribe to recent transactions
    const txQuery = query(
      collection(db, 'monzo_transactions'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('createdISO', 'desc'),
      limit(200)
    );

    let latestTotals: any = {};
    let latestCategories: any[] = [];

    const buildData = (transactions: any[]) => {
      const uncategorized = transactions.filter(tx =>
        !tx.userCategoryType && !tx.aiCategoryKey && !tx.defaultCategoryType
      ).length;

      const now = new Date();
      const currentPeriod = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

      setData({
        currentPeriod,
        totalSpend: Math.abs(latestTotals.optional || 0) + Math.abs(latestTotals.mandatory || 0),
        totalIncome: Math.abs(latestTotals.income || 0),
        totalSavings: Math.abs(latestTotals.savings || 0),
        discretionarySpend: Math.abs(latestTotals.optional || 0),
        mandatorySpend: Math.abs(latestTotals.mandatory || 0),
        byCategory: latestCategories.reduce((acc: any, cat: any) => {
          acc[cat.label] = Math.abs(cat.amount);
          return acc;
        }, {}),
        recentTransactions: transactions,
        uncategorizedCount: uncategorized,
      });

      setLoading(false);
    };

    // Subscribe to budget summary
    const summaryRef = doc(db, 'monzo_budget_summary', currentUser.uid);
    const unsubSummary = onSnapshot(
      summaryRef,
      (snap) => {
        const summaryData = snap.data();
        latestTotals = summaryData?.totals || {};
        latestCategories = summaryData?.categories || [];
      },
      (err) => {
        console.error('Error fetching summary:', err);
        setError(err.message);
        setLoading(false);
      }
    );

    const unsubTx = onSnapshot(
      txQuery,
      (txSnap) => {
        const transactions = txSnap.docs.map(d => {
          const txData = d.data();
          return {
            id: d.id,
            transactionId: txData.transactionId,
            description: txData.description,
            merchantName: txData.merchant?.name || null,
            amount: txData.amount || 0,
            createdISO: txData.createdISO,
            userCategoryType: txData.userCategoryType,
            userCategoryLabel: txData.userCategoryLabel,
            aiBucket: txData.aiBucket,
            aiCategoryKey: txData.aiCategoryKey,
            aiCategoryLabel: txData.aiCategoryLabel,
            defaultCategoryType: txData.defaultCategoryType,
            defaultCategoryLabel: txData.defaultCategoryLabel,
            potName: txData.potName,
            aiAnomalyFlag: txData.aiAnomalyFlag,
            isSubscription: txData.isSubscription,
          };
        });

        buildData(transactions);
      },
      (err) => {
        console.error('Error fetching transactions:', err);
        setError(err.message);
        setLoading(false);
      }
    );

    unsubTxRef.current = unsubTx;

    return () => {
      unsubSummary();
      unsubTx();
    };
  }, [currentUser]);

  return { data, loading, error };
}
