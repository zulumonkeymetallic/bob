import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Spinner } from 'react-bootstrap';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import type { JournalEntry } from '../types';

interface JournalInsightsCardProps {
  compact?: boolean;
}

function timestampToMillis(value: any): number {
  if (value == null) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (value?.seconds != null) {
    return (Number(value.seconds) * 1000) + Math.round((Number(value.nanoseconds || 0) || 0) / 1e6);
  }
  return 0;
}

function resolveJournalMillis(entry: JournalEntry): number {
  if (entry?.journalDateKey) {
    const parsed = Date.parse(`${entry.journalDateKey}T12:00:00`);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return timestampToMillis(entry?.updatedAt || entry?.createdAt);
}

function sentimentBadgeVariant(sentiment?: string | null): { bg: string; text?: 'dark' } {
  const normalized = String(sentiment || '').trim().toLowerCase();
  if (normalized === 'positive') return { bg: 'success' };
  if (normalized === 'negative') return { bg: 'danger' };
  if (normalized === 'neutral') return { bg: 'secondary' };
  return { bg: 'warning', text: 'dark' };
}

const JournalInsightsCard: React.FC<JournalInsightsCardProps> = ({ compact = false }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser?.uid) {
      setJournals([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError(null);

    const journalsQuery = query(
      collection(db, 'journals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );

    const unsubscribe = onSnapshot(
      journalsQuery,
      (snapshot) => {
        const rows = snapshot.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }) as JournalEntry)
          .sort((a, b) => resolveJournalMillis(a) - resolveJournalMillis(b));
        setJournals(rows);
        setLoading(false);
      },
      (snapshotError) => {
        setError(snapshotError?.message || 'Failed to load journal analytics.');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser?.uid, currentPersona]);

  const analyticsJournals = useMemo(
    () => journals.filter((entry) => entry.entryMetadata && (
      typeof entry.entryMetadata.moodScore === 'number'
      || typeof entry.entryMetadata.stressLevel === 'number'
      || typeof entry.entryMetadata.energyLevel === 'number'
    )),
    [journals]
  );

  const latestEntry = analyticsJournals.length ? analyticsJournals[analyticsJournals.length - 1] : null;

  const trendData = useMemo(
    () => analyticsJournals.slice(-14).map((entry) => ({
      label: entry.journalDateKey
        ? new Date(`${entry.journalDateKey}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        : new Date(resolveJournalMillis(entry)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      mood: entry.entryMetadata?.moodScore ?? null,
      stress: entry.entryMetadata?.stressLevel ?? null,
      energy: entry.entryMetadata?.energyLevel ?? null,
    })),
    [analyticsJournals]
  );

  const sentimentData = useMemo(() => {
    const counts = new Map<string, number>();
    analyticsJournals.slice(-30).forEach((entry) => {
      const sentiment = String(entry.entryMetadata?.sentiment || 'mixed').trim().toLowerCase();
      counts.set(sentiment, (counts.get(sentiment) || 0) + 1);
    });
    return ['negative', 'neutral', 'mixed', 'positive']
      .map((sentiment) => ({
        sentiment,
        count: counts.get(sentiment) || 0,
      }))
      .filter((item) => item.count > 0);
  }, [analyticsJournals]);

  return (
    <Card className="shadow-sm border-0">
      <Card.Header className="d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div>
          <div className="fw-semibold">Journal Signals</div>
          <div className="text-muted small">
            {compact
              ? 'Mood, stress, energy, and sentiment from recent journal entries.'
              : 'Mood, stress, energy, and sentiment from processed journal entries.'}
          </div>
        </div>
        <Button as={Link as any} to="/journals" size="sm" variant="outline-secondary">
          Open Journals
        </Button>
      </Card.Header>
      <Card.Body>
        {loading ? (
          <div className="text-center py-4">
            <Spinner animation="border" size="sm" />
          </div>
        ) : error ? (
          <Alert variant="warning" className="mb-0">{error}</Alert>
        ) : !analyticsJournals.length ? (
          <div className="text-muted small">
            No journal metadata yet. Process a journal-style transcript and the dashboard will chart it here.
          </div>
        ) : (
          <>
            {latestEntry?.entryMetadata && (
              <div className="d-flex flex-wrap gap-2 mb-3">
                {typeof latestEntry.entryMetadata.moodScore === 'number' && (
                  <Badge bg="light" text="dark">Mood {latestEntry.entryMetadata.moodScore}</Badge>
                )}
                {typeof latestEntry.entryMetadata.stressLevel === 'number' && (
                  <Badge bg="light" text="dark">Stress {latestEntry.entryMetadata.stressLevel}</Badge>
                )}
                {typeof latestEntry.entryMetadata.energyLevel === 'number' && (
                  <Badge bg="light" text="dark">Energy {latestEntry.entryMetadata.energyLevel}</Badge>
                )}
                {latestEntry.entryMetadata.sentiment && (
                  <Badge
                    bg={sentimentBadgeVariant(latestEntry.entryMetadata.sentiment).bg}
                    text={sentimentBadgeVariant(latestEntry.entryMetadata.sentiment).text}
                  >
                    {latestEntry.entryMetadata.sentiment}
                  </Badge>
                )}
                {latestEntry.entryMetadata.cognitiveState && (
                  <Badge bg="info">{latestEntry.entryMetadata.cognitiveState}</Badge>
                )}
              </div>
            )}

            {!!latestEntry?.entryMetadata?.primaryThemes?.length && (
              <div className="text-muted small mb-2">
                Themes: {latestEntry.entryMetadata.primaryThemes.join(', ')}
              </div>
            )}

            <div style={{ width: '100%', height: compact ? 150 : 220 }}>
              <ResponsiveContainer>
                <LineChart data={trendData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis domain={[-5, 10]} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="mood" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  <Line type="monotone" dataKey="stress" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  <Line type="monotone" dataKey="energy" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {!compact && !!sentimentData.length && (
              <div style={{ width: '100%', height: 180, marginTop: 8 }}>
                <ResponsiveContainer>
                  <BarChart data={sentimentData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="sentiment" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export default JournalInsightsCard;
