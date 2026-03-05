import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Row, Spinner } from 'react-bootstrap';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { ArrowDownRight, ArrowUpRight, BrainCircuit, Flame, HeartPulse, PieChart as PieChartIcon, Smile } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
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
  showHeader?: boolean;
  inlineMetric?: boolean;
}

type TrendMeta = {
  direction: 'up' | 'down' | 'flat';
  tone: 'positive' | 'negative' | 'neutral';
  delta: number | null;
  label: string;
};

type MetricSummary = {
  key: string;
  label: string;
  value: string;
  trend: TrendMeta | null;
  accent: string;
};

const PIE_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#ea580c', '#4f46e5'];

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

function sentimentToScore(sentiment?: string | null): number | null {
  const normalized = String(sentiment || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'negative') return -2;
  if (normalized === 'neutral') return 0;
  if (normalized === 'mixed') return 1;
  if (normalized === 'positive') return 2;
  return null;
}

function buildTrend(current: number | null | undefined, previous: number | null | undefined, betterWhen: 'higher' | 'lower'): TrendMeta | null {
  if (!Number.isFinite(Number(current)) || !Number.isFinite(Number(previous))) return null;
  const currentValue = Number(current);
  const previousValue = Number(previous);
  const delta = Number((currentValue - previousValue).toFixed(1));
  if (delta === 0) {
    return {
      direction: 'flat',
      tone: 'neutral',
      delta: 0,
      label: 'No change vs previous note',
    };
  }
  const direction = delta > 0 ? 'up' : 'down';
  const improved = betterWhen === 'higher' ? delta > 0 : delta < 0;
  return {
    direction,
    tone: improved ? 'positive' : 'negative',
    delta: Math.abs(delta),
    label: `${delta > 0 ? '+' : ''}${delta} vs previous note`,
  };
}

function formatMetricValue(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value}` : '-';
}

function formatTrendLabel(trend: TrendMeta | null): string {
  if (!trend) return 'No comparison yet';
  if (trend.direction === 'flat') return trend.label;
  return `${trend.direction === 'up' ? 'Up' : 'Down'} ${trend.delta}`;
}

const trendToneColor: Record<TrendMeta['tone'], string> = {
  positive: '#16a34a',
  negative: '#dc2626',
  neutral: '#64748b',
};

const metricSurfaceStyle = (accent: string): React.CSSProperties => ({
  borderRadius: 16,
  border: `1px solid ${accent}22`,
  background: `linear-gradient(180deg, ${accent}12 0%, rgba(255,255,255,0.98) 100%)`,
  padding: 16,
  height: '100%',
});

const JournalInsightsCard: React.FC<JournalInsightsCardProps> = ({ compact = false, showHeader = true, inlineMetric = false }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const navigate = useNavigate();
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
      || entry.entryMetadata.sentiment
    )),
    [journals]
  );

  const latestEntry = analyticsJournals.length ? analyticsJournals[analyticsJournals.length - 1] : null;
  const previousEntry = analyticsJournals.length > 1 ? analyticsJournals[analyticsJournals.length - 2] : null;

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
    analyticsJournals.slice(-45).forEach((entry) => {
      const sentiment = String(entry.entryMetadata?.sentiment || 'mixed').trim().toLowerCase();
      counts.set(sentiment, (counts.get(sentiment) || 0) + 1);
    });
    return ['negative', 'neutral', 'mixed', 'positive']
      .map((sentiment) => ({ name: sentiment, value: counts.get(sentiment) || 0 }))
      .filter((item) => item.value > 0);
  }, [analyticsJournals]);

  const themeData = useMemo(() => {
    const counts = new Map<string, number>();
    analyticsJournals.slice(-45).forEach((entry) => {
      (entry.entryMetadata?.primaryThemes || []).forEach((theme) => {
        const label = String(theme || '').trim();
        if (!label) return;
        counts.set(label, (counts.get(label) || 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [analyticsJournals]);

  const metricSummaries = useMemo<MetricSummary[]>(() => {
    const latest = latestEntry?.entryMetadata || null;
    const previous = previousEntry?.entryMetadata || null;
    return [
      {
        key: 'mood',
        label: 'Mood',
        value: formatMetricValue(latest?.moodScore),
        trend: buildTrend(latest?.moodScore, previous?.moodScore, 'higher'),
        accent: '#2563eb',
      },
      {
        key: 'energy',
        label: 'Energy',
        value: formatMetricValue(latest?.energyLevel),
        trend: buildTrend(latest?.energyLevel, previous?.energyLevel, 'higher'),
        accent: '#16a34a',
      },
      {
        key: 'stress',
        label: 'Stress',
        value: formatMetricValue(latest?.stressLevel),
        trend: buildTrend(latest?.stressLevel, previous?.stressLevel, 'lower'),
        accent: '#dc2626',
      },
      {
        key: 'sentiment',
        label: 'Sentiment',
        value: String(latest?.sentiment || '-').replace(/^./, (value) => value.toUpperCase()),
        trend: buildTrend(sentimentToScore(latest?.sentiment), sentimentToScore(previous?.sentiment), 'higher'),
        accent: '#7c3aed',
      },
    ];
  }, [latestEntry, previousEntry]);

  const latestThemes = latestEntry?.entryMetadata?.primaryThemes || [];
  const latestSummary = String(latestEntry?.oneLineSummary || '').trim();

  const renderTrend = (trend: TrendMeta | null) => {
    if (!trend) {
      return <span className="text-muted small">No comparison yet</span>;
    }
    if (trend.direction === 'flat') {
      return <span className="text-muted small">{trend.label}</span>;
    }
    const Icon = trend.direction === 'up' ? ArrowUpRight : ArrowDownRight;
    return (
      <span
        className="small d-inline-flex align-items-center gap-1"
        style={{ color: trendToneColor[trend.tone], fontWeight: 600 }}
        title={trend.label}
      >
        <Icon size={14} />
        {formatTrendLabel(trend)}
      </span>
    );
  };

  const handleOpenInsights = () => navigate('/journals/insights');

  const cardProps = compact
    ? {
        role: 'button',
        tabIndex: 0,
        onClick: handleOpenInsights,
        onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleOpenInsights();
          }
        },
        style: { cursor: 'pointer' } as React.CSSProperties,
      }
    : {};

  if (compact && inlineMetric) {
    const themeSummary = latestThemes.length
      ? latestThemes.slice(0, 3).join(', ')
      : 'Open insights for theme and trend detail';
    const sentimentVariant = latestEntry?.entryMetadata?.sentiment
      ? sentimentBadgeVariant(latestEntry.entryMetadata.sentiment)
      : null;

    return (
      <div
        className="d-flex align-items-center gap-2 px-2 py-1 rounded border h-100"
        role="button"
        tabIndex={0}
        style={{
          background: 'var(--bs-body-bg)',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
        onClick={handleOpenInsights}
        onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleOpenInsights();
          }
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.backgroundColor = 'var(--bs-info-bg-subtle)';
          event.currentTarget.style.borderColor = 'var(--bs-info)';
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.backgroundColor = 'var(--bs-body-bg)';
          event.currentTarget.style.borderColor = 'var(--bs-border-color)';
        }}
      >
        <BrainCircuit size={16} className="text-info" />
        <div className="flex-grow-1">
          <div className="text-muted small">Journal Signals</div>
          {loading ? (
            <div className="fw-semibold">Loading journal insights…</div>
          ) : error ? (
            <>
              <div className="fw-semibold">Signals unavailable</div>
              <div className="text-muted small text-truncate">{error}</div>
            </>
          ) : !analyticsJournals.length || !latestEntry?.entryMetadata ? (
            <>
              <div className="fw-semibold">No journal signals yet</div>
              <div className="text-muted small">Process a journal entry to start tracking mood, energy, stress, and sentiment.</div>
            </>
          ) : (
            <>
              <div className="d-flex flex-wrap gap-1 mb-1">
                {metricSummaries.map((metric) => {
                  const indicatorColor = metric.trend ? trendToneColor[metric.trend.tone] : '#64748b';
                  return (
                    <span
                      key={metric.key}
                      className="small d-inline-flex align-items-center gap-1 px-2 py-1 rounded-pill border"
                      style={{
                        borderColor: `${metric.accent}33`,
                        background: `${metric.accent}14`,
                        color: 'var(--bs-body-color)',
                        fontWeight: 600,
                        lineHeight: 1.2,
                      }}
                      title={metric.trend?.label || `${metric.label} has no comparison yet`}
                    >
                      <span>{metric.label} {metric.value}</span>
                      {metric.trend?.direction === 'up' ? (
                        <ArrowUpRight size={12} style={{ color: indicatorColor }} />
                      ) : metric.trend?.direction === 'down' ? (
                        <ArrowDownRight size={12} style={{ color: indicatorColor }} />
                      ) : (
                        <span style={{ color: indicatorColor }}>→</span>
                      )}
                    </span>
                  );
                })}
              </div>
              <div className="text-muted small d-flex align-items-center gap-2 flex-wrap" style={{ lineHeight: 1.35 }}>
                {sentimentVariant && latestEntry.entryMetadata.sentiment ? (
                  <Badge bg={sentimentVariant.bg} text={sentimentVariant.text}>
                    {latestEntry.entryMetadata.sentiment}
                  </Badge>
                ) : null}
                <span style={{ overflowWrap: 'anywhere' }}>{themeSummary}</span>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className="shadow-sm border-0 h-100" {...cardProps}>
      {showHeader && (
        <Card.Header className="d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div>
            <div className="fw-semibold">Journal Signals</div>
            <div className="text-muted small">
              {compact
                ? 'Latest journal trends in a dashboard summary.'
                : 'Mood, stress, energy, sentiment, and recurring themes from processed journal entries.'}
            </div>
          </div>
          {compact ? (
            <Button
              as={Link as any}
              to="/journals/insights"
              size="sm"
              variant="outline-secondary"
              onClick={(event: React.MouseEvent) => event.stopPropagation()}
            >
              Open insights
            </Button>
          ) : (
            <div className="d-flex gap-2">
              <Button as={Link as any} to="/journals/insights" size="sm" variant="primary">
                Insights
              </Button>
              <Button as={Link as any} to="/journals" size="sm" variant="outline-secondary">
                Journal entries
              </Button>
            </div>
          )}
        </Card.Header>
      )}
      <Card.Body>
        {loading ? (
          <div className="text-center py-4">
            <Spinner animation="border" size="sm" />
          </div>
        ) : error ? (
          <Alert variant="warning" className="mb-0">{error}</Alert>
        ) : !analyticsJournals.length || !latestEntry?.entryMetadata ? (
          <div className="text-muted small">
            No journal metadata yet. Process a journal-style transcript and the dashboard will start tracking it here.
          </div>
        ) : compact ? (
          <>
            <div className="d-flex align-items-start justify-content-between gap-3 mb-3">
              <div>
                <div className="fw-semibold">Latest journal snapshot</div>
                <div className="text-muted small">
                  {latestSummary || 'Tap through for charts, themes, and historical movement.'}
                </div>
              </div>
              {latestEntry.entryMetadata.sentiment && (
                <Badge
                  bg={sentimentBadgeVariant(latestEntry.entryMetadata.sentiment).bg}
                  text={sentimentBadgeVariant(latestEntry.entryMetadata.sentiment).text}
                >
                  {latestEntry.entryMetadata.sentiment}
                </Badge>
              )}
            </div>
            <Row className="g-2">
              {metricSummaries.map((metric) => (
                <Col xs={6} key={metric.key}>
                  <div style={metricSurfaceStyle(metric.accent)}>
                    <div className="text-muted text-uppercase small fw-semibold mb-1">{metric.label}</div>
                    <div className="fw-bold fs-4 mb-1">{metric.value}</div>
                    {renderTrend(metric.trend)}
                  </div>
                </Col>
              ))}
            </Row>
            {!!latestThemes.length && (
              <div className="mt-3 d-flex flex-wrap gap-2">
                {latestThemes.slice(0, 5).map((theme) => (
                  <Badge bg="light" text="dark" key={theme}>{theme}</Badge>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <Row className="g-3 mb-3">
              {metricSummaries.map((metric) => (
                <Col md={6} xl={3} key={metric.key}>
                  <div style={metricSurfaceStyle(metric.accent)}>
                    <div className="d-flex align-items-center justify-content-between mb-2">
                      <div className="text-muted text-uppercase small fw-semibold">{metric.label}</div>
                      {metric.key === 'mood' && <Smile size={16} color={metric.accent} />}
                      {metric.key === 'energy' && <HeartPulse size={16} color={metric.accent} />}
                      {metric.key === 'stress' && <Flame size={16} color={metric.accent} />}
                      {metric.key === 'sentiment' && <BrainCircuit size={16} color={metric.accent} />}
                    </div>
                    <div className="fw-bold fs-3 mb-1">{metric.value}</div>
                    {renderTrend(metric.trend)}
                  </div>
                </Col>
              ))}
            </Row>

            <Row className="g-3">
              <Col xl={8}>
                <Card className="h-100 border-0 bg-light">
                  <Card.Body>
                    <div className="fw-semibold mb-1">Signal trends</div>
                    <div className="text-muted small mb-3">Latest 14 journal entries with metadata.</div>
                    <div style={{ width: '100%', height: 280 }}>
                      <ResponsiveContainer>
                        <LineChart data={trendData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
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
                  </Card.Body>
                </Card>
              </Col>
              <Col xl={4}>
                <Card className="h-100 border-0 bg-light">
                  <Card.Body>
                    <div className="d-flex align-items-center gap-2 mb-1">
                      <PieChartIcon size={16} />
                      <div className="fw-semibold">Sentiment mix</div>
                    </div>
                    <div className="text-muted small mb-3">Recent distribution across the last 45 processed entries.</div>
                    <div style={{ width: '100%', height: 280 }}>
                      <ResponsiveContainer>
                        <PieChart>
                          <Pie data={sentimentData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={3}>
                            {sentimentData.map((entry, index) => (
                              <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </Card.Body>
                </Card>
              </Col>
              <Col xl={6}>
                <Card className="h-100 border-0 bg-light">
                  <Card.Body>
                    <div className="d-flex align-items-center gap-2 mb-1">
                      <PieChartIcon size={16} />
                      <div className="fw-semibold">Theme distribution</div>
                    </div>
                    <div className="text-muted small mb-3">Top recurring themes pulled from journal metadata.</div>
                    <div style={{ width: '100%', height: 280 }}>
                      <ResponsiveContainer>
                        <PieChart>
                          <Pie data={themeData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={92} paddingAngle={2}>
                            {themeData.map((entry, index) => (
                              <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </Card.Body>
                </Card>
              </Col>
              <Col xl={6}>
                <Card className="h-100 border-0 bg-light">
                  <Card.Body>
                    <div className="fw-semibold mb-1">Latest journal context</div>
                    <div className="text-muted small mb-3">Current summary, sentiment, and theme tags from the most recent processed entry.</div>
                    {latestSummary && (
                      <div className="mb-3" style={{ lineHeight: 1.6 }}>
                        {latestSummary}
                      </div>
                    )}
                    <div className="d-flex flex-wrap gap-2 mb-3">
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
                    <div className="d-flex flex-wrap gap-2">
                      {latestThemes.length ? latestThemes.map((theme) => (
                        <Badge bg="light" text="dark" key={theme}>{theme}</Badge>
                      )) : (
                        <span className="text-muted small">No themes extracted yet.</span>
                      )}
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            </Row>
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export default JournalInsightsCard;
