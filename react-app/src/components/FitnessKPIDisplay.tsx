import React, { useMemo } from 'react';
import { Badge, ProgressBar, Alert } from 'react-bootstrap';
import { Activity, TrendingUp, AlertCircle } from 'lucide-react';

interface KPI {
  name: string;
  target: number;
  unit: string;
  current?: number;
  progress?: number;
  status?: 'on-target' | 'good' | 'ok' | 'behind' | 'no-data' | 'unknown-type';
  lastUpdated?: string;
  timeframe?: string;
  recentWorkoutCount?: number;
}

interface FitnessKPIDisplayProps {
  kpis: KPI[];
  compact?: boolean;
  showLastUpdated?: boolean;
}

const isFitnessKpi = (kpi: KPI): boolean => {
  const name = (kpi.name || '').toLowerCase();
  return (
    name.includes('step') ||
    name.includes('run') ||
    name.includes('walk') ||
    name.includes('cycle') ||
    name.includes('swim') ||
    name.includes('distance') ||
    name.includes('km') ||
    name.includes('mile')
  );
};

const getStatusColor = (status?: string): string => {
  switch (status) {
    case 'on-target':
      return 'success';
    case 'good':
      return 'info';
    case 'ok':
      return 'warning';
    case 'behind':
      return 'danger';
    case 'no-data':
      return 'secondary';
    default:
      return 'light';
  }
};

const getStatusLabel = (status?: string): string => {
  switch (status) {
    case 'on-target':
      return '✓ On Target';
    case 'good':
      return '→ Good Progress';
    case 'ok':
      return '↗ OK';
    case 'behind':
      return '⚠ Behind';
    case 'no-data':
      return 'No Data';
    default:
      return 'Unknown';
  }
};

/**
 * Compact fitness KPI display for goal cards
 */
export const CompactFitnessKPI: React.FC<{ kpi: KPI }> = ({ kpi }) => {
  if (!isFitnessKpi(kpi)) return null;

  const current = kpi.current ?? 0;
  const progress = kpi.progress ?? 0;

  return (
    <div
      style={{
        padding: '8px 12px',
        borderRadius: '8px',
        background: '#f5f5f5',
        marginBottom: '8px',
        fontSize: '13px'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontWeight: '500'
          }}
        >
          <Activity size={14} />
          <span>{kpi.name}</span>
        </div>
        <Badge bg={getStatusColor(kpi.status)} style={{ fontSize: '10px' }}>
          {getStatusLabel(kpi.status)}
        </Badge>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '12px' }}>
        <span style={{ color: '#666' }}>
          {current.toFixed(1)} / {kpi.target} {kpi.unit}
        </span>
        <span style={{ fontWeight: '700', color: '#333' }}>
          {Math.round(progress)}%
        </span>
      </div>
      <ProgressBar
        now={Math.min(progress, 100)}
        variant={getStatusColor(kpi.status)}
        style={{ height: '6px' }}
      />
      {kpi.recentWorkoutCount !== undefined && (
        <div style={{ fontSize: '10px', color: '#999', marginTop: '4px' }}>
          {kpi.recentWorkoutCount} workouts this {kpi.timeframe || 'period'}
        </div>
      )}
    </div>
  );
};

/**
 * Detailed fitness KPI panel for goal details
 */
export const FitnessKPIPanel: React.FC<FitnessKPIDisplayProps> = ({
  kpis = [],
  compact = false,
  showLastUpdated = true
}) => {
  const fitnessKpis = useMemo(() => kpis.filter(isFitnessKpi), [kpis]);

  if (fitnessKpis.length === 0) return null;

  if (compact) {
    return (
      <div>
        {fitnessKpis.map((kpi, idx) => (
          <CompactFitnessKPI key={idx} kpi={kpi} />
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: '12px',
        padding: '16px',
        background: '#fafafa',
        marginTop: '16px'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <Activity size={18} style={{ color: '#0066cc' }} />
        <h6 style={{ marginBottom: 0, fontWeight: '600' }}>Fitness KPIs</h6>
      </div>

      {fitnessKpis.map((kpi, idx) => {
        const current = kpi.current ?? 0;
        const progress = kpi.progress ?? 0;
        const statusColor = getStatusColor(kpi.status);

        return (
          <div
            key={idx}
            style={{
              marginBottom: idx < fitnessKpis.length - 1 ? '12px' : 0,
              paddingBottom: idx < fitnessKpis.length - 1 ? '12px' : 0,
              borderBottom: idx < fitnessKpis.length - 1 ? '1px solid #e5e7eb' : 'none'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '6px'
              }}
            >
              <div style={{ fontWeight: '500', fontSize: '14px' }}>
                {kpi.name}
                {kpi.timeframe && (
                  <span style={{ fontSize: '12px', color: '#666', marginLeft: '6px' }}>
                    ({kpi.timeframe})
                  </span>
                )}
              </div>
              <Badge bg={statusColor}>
                {getStatusLabel(kpi.status)}
              </Badge>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '13px',
                color: '#666',
                marginBottom: '6px'
              }}
            >
              <span>
                {current.toFixed(1)} / {kpi.target} {kpi.unit}
              </span>
              <span style={{ fontWeight: '600', color: '#333' }}>
                {Math.round(progress)}%
              </span>
            </div>

            <ProgressBar
              now={Math.min(progress, 100)}
              variant={statusColor}
              style={{ height: '8px', marginBottom: '6px' }}
            />

            <div style={{ fontSize: '12px', color: '#999' }}>
              {kpi.recentWorkoutCount !== undefined && (
                <div>
                  📊 {kpi.recentWorkoutCount} workouts recorded
                </div>
              )}
              {showLastUpdated && kpi.lastUpdated && (
                <div>
                  🔄 Updated: {new Date(kpi.lastUpdated).toLocaleDateString()}
                </div>
              )}
            </div>
          </div>
        );
      })}

      <Alert variant="info" style={{ marginTop: '12px', marginBottom: 0, fontSize: '12px' }}>
        <TrendingUp size={14} style={{ display: 'inline', marginRight: '6px' }} />
        KPIs auto-sync with your Strava and HealthKit workouts daily.
      </Alert>
    </div>
  );
};

/**
 * Quick KPI status indicator (shows count of fitness KPIs on target)
 */
export const FitnessKPIQuickStatus: React.FC<{ kpis: KPI[] }> = ({ kpis = [] }) => {
  const fitnessKpis = useMemo(() => kpis.filter(isFitnessKpi), [kpis]);

  if (fitnessKpis.length === 0) return null;

  const onTarget = fitnessKpis.filter(k => k.status === 'on-target').length;
  const behind = fitnessKpis.filter(k => k.status === 'behind').length;

  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
      <Activity size={14} style={{ color: '#0066cc' }} />
      {onTarget > 0 && (
        <Badge bg="success" style={{ fontSize: '11px' }}>
          {onTarget} on target
        </Badge>
      )}
      {behind > 0 && (
        <Badge bg="danger" style={{ fontSize: '11px' }}>
          {behind} behind
        </Badge>
      )}
    </div>
  );
};

export default FitnessKPIPanel;
