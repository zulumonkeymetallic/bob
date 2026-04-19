/**
 * metrics/shared.tsx
 *
 * Shared helpers, interfaces, and components for the metrics widget family.
 * All exports are named — no default export.
 */

import React from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Tooltip,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import { Badge } from 'react-bootstrap';

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function toMs(v: any): number {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (v?.toMillis) return v.toMillis();
  if (v?.seconds) return v.seconds * 1000;
  const p = new Date(v);
  return isNaN(p.getTime()) ? 0 : p.getTime();
}

export function num(src: any, ...keys: string[]): number | null {
  for (const k of keys) {
    const n = Number(src?.[k]);
    if (isFinite(n)) return n;
  }
  return null;
}

export function fmtKm(m: number) {
  return `${(m / 1000).toFixed(1)} km`;
}

export function fmtHours(h: number) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return mm === 0 ? `${hh}h` : `${hh}h ${mm}m`;
}

export function shortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function trendIcon(data: number[], className = '') {
  if (data.length < 3) return <Minus size={14} className={`text-muted ${className}`} />;
  const recent = data.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const prev = data.slice(-6, -3).reduce((a, b) => a + b, 0) / Math.max(data.slice(-6, -3).length, 1);
  const pct = prev === 0 ? 0 : ((recent - prev) / prev) * 100;
  if (pct > 3) return <TrendingUp size={14} className={`text-success ${className}`} />;
  if (pct < -3) return <TrendingDown size={14} className={`text-danger ${className}`} />;
  return <Minus size={14} className={`text-muted ${className}`} />;
}

// ─── Range selector ───────────────────────────────────────────────────────────

export const RANGE_OPTIONS = [
  { label: '7d',  days: 7  },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
] as const;

export type RangeKey = typeof RANGE_OPTIONS[number]['days'];

// ─── MetricCard ───────────────────────────────────────────────────────────────

export interface MetricCardProps {
  icon: React.ReactNode;
  title: string;
  value: string | number | null;
  unit?: string;
  subtitle?: string;
  trend?: number[];
  trendColor?: string;
  badge?: { text: string; variant: string };
  isDark: boolean;
  action?: React.ReactNode;
  fullWidth?: boolean;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  icon, title, value, unit, subtitle, trend, trendColor = '#3b82f6', badge, isDark, action,
}) => {
  const bg = isDark ? '#1e2433' : '#ffffff';
  const border = isDark ? '#2d3748' : '#e2e8f0';
  const muted = isDark ? '#9ca3af' : '#6b7280';

  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 12,
        padding: '16px 18px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: trendColor }}>{icon}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {title}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {badge && <Badge bg={badge.variant} style={{ fontSize: 10 }}>{badge.text}</Badge>}
          {action}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: isDark ? '#f1f5f9' : '#1e293b', lineHeight: 1 }}>
          {value ?? '—'}
        </span>
        {unit && <span style={{ fontSize: 13, color: muted, fontWeight: 500 }}>{unit}</span>}
        {trend && trend.length > 1 && trendIcon(trend)}
      </div>

      {subtitle && <div style={{ fontSize: 12, color: muted }}>{subtitle}</div>}

      {trend && trend.length > 2 && (
        <div style={{ marginTop: 4, flex: 1, minHeight: 40 }}>
          <ResponsiveContainer width="100%" height={40}>
            <AreaChart data={trend.map((v, i) => ({ i, v }))} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`grad-${title.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={trendColor} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke={trendColor}
                strokeWidth={2}
                fill={`url(#grad-${title.replace(/\s/g, '')})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

// ─── SportCard ────────────────────────────────────────────────────────────────

export interface SportCardProps {
  icon: React.ReactNode;
  sport: string;
  ytdM: number;
  rangeM: number;
  rangeLabel: string;
  weekM: number;
  color: string;
  barData: Array<{ label: string; km: number }>;
  isDark: boolean;
}

export const SportCard: React.FC<SportCardProps> = ({
  icon, sport, ytdM, rangeM, rangeLabel, weekM, color, barData, isDark,
}) => {
  const bg = isDark ? '#1e2433' : '#ffffff';
  const border = isDark ? '#2d3748' : '#e2e8f0';
  const muted = isDark ? '#9ca3af' : '#6b7280';

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ color }}>{icon}</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: isDark ? '#f1f5f9' : '#1e293b' }}>{sport}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: muted }}>YTD</span>
        <span style={{ fontSize: 18, fontWeight: 700, color }}>{fmtKm(ytdM)}</span>
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: muted, textTransform: 'uppercase' }}>{rangeLabel}</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: isDark ? '#f1f5f9' : '#1e293b' }}>{fmtKm(rangeM)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: muted, textTransform: 'uppercase' }}>This week</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: isDark ? '#f1f5f9' : '#1e293b' }}>{fmtKm(weekM)}</div>
        </div>
      </div>
      {barData.length > 1 && (
        <ResponsiveContainer width="100%" height={52}>
          <BarChart data={barData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <Bar dataKey="km" fill={color} radius={[3, 3, 0, 0] as any} isAnimationActive={false} />
            <Tooltip
              contentStyle={{ background: bg, border: `1px solid ${border}`, borderRadius: 6, fontSize: 11 }}
              formatter={(v: number) => [`${v.toFixed(1)} km`, sport]}
              labelFormatter={(l) => l}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};

// ─── ThemeRing ────────────────────────────────────────────────────────────────

export interface ThemeRingProps {
  theme: { id: number; label: string; emoji: string; color: string };
  progressPct: number;
  isDark: boolean;
}

export const ThemeRing: React.FC<ThemeRingProps> = ({ theme, progressPct, isDark }) => {
  const clamped = Math.min(100, Math.max(0, progressPct));
  const bg = isDark ? '#1e2433' : '#ffffff';
  const border = isDark ? '#2d3748' : '#e2e8f0';
  const muted = isDark ? '#9ca3af' : '#6b7280';

  const data = [
    { value: clamped },
    { value: Math.max(0, 100 - clamped) },
  ];

  return (
    <div style={{
      background: bg, border: `1px solid ${border}`, borderRadius: 12,
      padding: '12px 10px', textAlign: 'center', height: '100%',
    }}>
      <div style={{ fontSize: 18, marginBottom: 4 }}>{theme.emoji}</div>
      <ResponsiveContainer width="100%" height={64}>
        <PieChart>
          <Pie
            data={data}
            cx="50%" cy="50%"
            innerRadius={24} outerRadius={32}
            startAngle={90} endAngle={-270}
            dataKey="value"
            strokeWidth={0}
            isAnimationActive={false}
          >
            <Cell fill={theme.color} />
            <Cell fill={isDark ? '#374151' : '#e5e7eb'} />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 16, fontWeight: 700, color: theme.color, marginTop: -4 }}>
        {Math.round(clamped)}%
      </div>
      <div style={{ fontSize: 10, color: muted, fontWeight: 600, textTransform: 'uppercase' }}>
        {theme.label}
      </div>
    </div>
  );
};

// ─── Range selector button group ──────────────────────────────────────────────

export const RangeSelector: React.FC<{
  rangeDays: RangeKey;
  onChange: (d: RangeKey) => void;
  isDark: boolean;
}> = ({ rangeDays, onChange, isDark }) => (
  <div style={{ display: 'flex', gap: 6 }}>
    {RANGE_OPTIONS.map((opt) => (
      <button
        key={opt.days}
        onClick={() => onChange(opt.days as RangeKey)}
        style={{
          padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer',
          fontSize: 11, fontWeight: 600,
          background: rangeDays === opt.days ? '#3b82f6' : (isDark ? '#1e2433' : '#e2e8f0'),
          color: rangeDays === opt.days ? '#fff' : (isDark ? '#9ca3af' : '#64748b'),
          transition: 'background 0.15s',
        }}
      >
        {opt.label}
      </button>
    ))}
  </div>
);
