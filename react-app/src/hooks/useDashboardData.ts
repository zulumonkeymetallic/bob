import { useState, useEffect, useRef, useMemo } from 'react';
import { collection, doc, onSnapshot, orderBy, query, where, limit, DocumentData } from 'firebase/firestore';
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
  lastUpdatedISO?: string;
  isStale?: boolean;
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

    // Track last transaction timestamp for staleness check
    const MAX_STALE_HOURS = 24; // Alert if data older than 24h
    
    // Optimize: combine queries where possible
    const txQuery = query(
      collection(db, 'monzo_transactions'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('createdISO', 'desc'),
      limit(100) // Reduced from 200 for performance
    );

    let latestTotals: any = {};
    let latestCategories: any[] = [];
    let currentTransactions: any[] = [];

    const buildData = (transactions: any[]) => {
      // Check for stale data
      const lastTxDate = transactions.length > 0 
        ? new Date(transactions[0].createdISO)
        : null;
      
      const isStale = lastTxDate && ((Date.now() - lastTxDate.getTime()) / (1000 * 60 * 60)) > MAX_STALE_HOURS;
      
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
        lastUpdatedISO: lastTxDate?.toISOString(),
        isStale,
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
        const transactions = txSnap.docs.map(d => ({
          id: d.id,
          transactionId: d.data().transactionId,
          description: d.data().description,
          merchantName: d.data().merchant?.name || null,
          amount: d.data().amount || 0,
          createdISO: d.data().createdISO,
          userCategoryType: d.data().userCategoryType,
          userCategoryLabel: d.data().userCategoryLabel,
          aiBucket: d.data().aiBucket,
          aiCategoryKey: d.data().aiCategoryKey,
          aiCategoryLabel: d.data().aiCategoryLabel,
          defaultCategoryType: d.data().defaultCategoryType,
          defaultCategoryLabel: d.data().defaultCategoryLabel,
          potName: d.data().potName,
          aiAnomalyFlag: d.data().aiAnomalyFlag,
          isSubscription: d.data().isSubscription,
        }));
        
        currentTransactions = transactions;
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
