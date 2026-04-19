import React from 'react';
import { Card, ProgressBar, Badge, Row, Col } from 'react-bootstrap';
import { 
  Heart, Zap, TrendingUp, DollarSign, Clock, CheckCircle, 
  Target, Footprints, Bike, Dumbbell, ShoppingBasket, Leaf,
  BookOpen, AlertCircle, Flame
} from 'lucide-react';
import { Kpi, KpiStatus } from '../types/KpiTypes';

/**
 * Generic KPI Display Component
 * Displays any KPI type with appropriate iconography and formatting
 */

interface UnifiedKpiDisplayProps {
  kpi: Kpi;
  compact?: boolean;
  showDescription?: boolean;
  onEdit?: (kpi: Kpi) => void;
  onDelete?: (kpiId: string) => void;
}

/**
 * Get icon for KPI type
 */
function getKpiIcon(type: string, size: number = 24) {
  const iconProps = { size, className: 'me-2' };

  switch (type) {
    // Fitness
    case 'fitness_steps':
      return <Footprints {...iconProps} />;
    case 'fitness_running':
    case 'fitness_cycling':
    case 'fitness_swimming':
    case 'fitness_walking':
    case 'fitness_workouts':
      return <Zap {...iconProps} />;

    // Progress
    case 'story_points':
      return <Target {...iconProps} />;
    case 'tasks_completed':
      return <CheckCircle {...iconProps} />;

    // Financial
    case 'savings_target':
      return <DollarSign {...iconProps} />;
    case 'budget_tracking':
      return <ShoppingBasket {...iconProps} />;

    // Time & Habits
    case 'time_tracked':
      return <Clock {...iconProps} />;
    case 'habit_streak':
      return <Flame {...iconProps} />;

    default:
      return <Target {...iconProps} />;
  }
}

/**
 * Get status badge properties
 */
function getStatusBadge(status?: KpiStatus): { variant: string; label: string } {
  switch (status) {
    case 'on-target':
      return { variant: 'success', label: '✓ On Target' };
    case 'good':
      return { variant: 'info', label: '→ Good' };
    case 'ok':
      return { variant: 'warning', label: '↗ OK' };
    case 'behind':
      return { variant: 'danger', label: '⚠ Behind' };
    case 'no-data':
      return { variant: 'secondary', label: '○ No Data' };
    case 'not-started':
      return { variant: 'light', label: '◯ Not Started' };
    default:
      return { variant: 'secondary', label: '○ Unknown' };
  }
}

/**
 * Format value based on KPI type
 */
function formatKpiValue(current: number | undefined, unit: string, type: string): string {
  if (current === undefined || current === null) return '—';

  // Currency formatting
  if (unit === 'GBP' || unit === 'USD' || unit === 'EUR') {
    const symbol = unit === 'GBP' ? '£' : unit === 'USD' ? '$' : '€';
    return `${symbol}${current.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }

  // Percentage
  if (unit === '%') {
    return `${current}%`;
  }

  // Days (for streaks)
  if (unit === 'days' || unit === 'workouts' || unit === 'tasks' || unit === 'hours' || unit === 'steps') {
    return `${Math.round(current)}`;
  }

  // Decimal (distance)
  if (unit === 'km' || unit === 'miles') {
    return `${current.toFixed(1)}`;
  }

  // Default: round to 1 decimal
  return `${current.toFixed(1)}`;
}

/**
 * Compact KPI Card (inline display, ~120px width)
 */
export const CompactUnifiedKpi: React.FC<UnifiedKpiDisplayProps> = ({
  kpi,
  onEdit,
  onDelete
}) => {
  const statusBadge = getStatusBadge(kpi.status);
  const progress = kpi.progress ?? 0;

  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '12px',
        minHeight: '140px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: '#f9fafb',
        cursor: onEdit ? 'pointer' : 'default'
      }}
      onClick={() => onEdit?.(kpi)}
    >
      {/* Header with icon and name */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
        <div style={{ color: '#6b7280', flexShrink: 0 }}>
          {getKpiIcon(kpi.type, 18)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#111827', lineHeight: 1.4 }}>
            {kpi.name}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: '8px' }}>
        <ProgressBar
          now={Math.min(progress, 100)}
          variant={statusBadge.variant}
          style={{ height: '6px', backgroundColor: '#e5e7eb' }}
        />
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '14px', fontWeight: 700, color: '#111827' }}>
          {formatKpiValue(kpi.current, kpi.unit, kpi.type)} / {formatKpiValue(kpi.target, kpi.unit, kpi.type)}
        </span>
        <Badge bg={statusBadge.variant} style={{ fontSize: '10px' }}>
          {progress}%
        </Badge>
      </div>

      {/* Timeframe and status */}
      <div
        style={{
          fontSize: '11px',
          color: '#6b7280',
          marginTop: '6px',
          textTransform: 'capitalize'
        }}
      >
        {kpi.timeframe} • {statusBadge.label}
      </div>
    </div>
  );
};

/**
 * Detailed KPI Panel (full width display with all details)
 */
export const DetailedUnifiedKpi: React.FC<UnifiedKpiDisplayProps> = ({
  kpi,
  showDescription = true,
  onEdit,
  onDelete
}) => {
  const statusBadge = getStatusBadge(kpi.status);
  const progress = kpi.progress ?? 0;

  return (
    <Card style={{ marginBottom: '16px' }}>
      <Card.Body>
        <Row className="align-items-start">
          {/* Left: Icon and basic info */}
          <Col md={6}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '12px' }}>
              <div style={{ color: '#6b7280', flexShrink: 0, marginTop: '2px' }}>
                {getKpiIcon(kpi.type, 28)}
              </div>
              <div>
                <h5 style={{ margin: 0, marginBottom: '4px' }}>{kpi.name}</h5>
                {showDescription && kpi.description && (
                  <p style={{ margin: 0, fontSize: '14px', color: '#6b7280' }}>
                    {kpi.description}
                  </p>
                )}
                <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '6px' }}>
                  <span style={{ marginRight: '12px' }}>📊 {kpi.timeframe}</span>
                  <span>🏷️ {kpi.type}</span>
                </div>
              </div>
            </div>
          </Col>

          {/* Right: Progress and status */}
          <Col md={6}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>
                {progress}%
              </div>
              <Badge bg={statusBadge.variant} style={{ fontSize: '12px', marginBottom: '8px' }}>
                {statusBadge.label}
              </Badge>
            </div>
          </Col>
        </Row>

        {/* Progress bar */}
        <div style={{ marginBottom: '12px' }}>
          <ProgressBar
            now={Math.min(progress, 100)}
            variant={statusBadge.variant}
            style={{ height: '8px' }}
          />
        </div>

        {/* Stats grid */}
        <Row style={{ marginBottom: '12px' }}>
          <Col xs={6} sm={3}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>
                Current
              </div>
              <div style={{ fontSize: '18px', fontWeight: 700 }}>
                {formatKpiValue(kpi.current, kpi.unit, kpi.type)}
              </div>
              <div style={{ fontSize: '10px', color: '#9ca3af' }}>{kpi.unit}</div>
            </div>
          </Col>
          <Col xs={6} sm={3}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>
                Target
              </div>
              <div style={{ fontSize: '18px', fontWeight: 700 }}>
                {formatKpiValue(kpi.target, kpi.unit, kpi.type)}
              </div>
              <div style={{ fontSize: '10px', color: '#9ca3af' }}>{kpi.unit}</div>
            </div>
          </Col>
          <Col xs={6} sm={3}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>
                Timeframe
              </div>
              <div style={{ fontSize: '14px', fontWeight: 600, textTransform: 'capitalize' }}>
                {kpi.timeframe}
              </div>
            </div>
          </Col>
          <Col xs={6} sm={3}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>
                Last Updated
              </div>
              <div style={{ fontSize: '12px', color: '#6b7280' }}>
                {kpi.lastUpdated ? new Date(kpi.lastUpdated.toDate?.()).toLocaleDateString() : '—'}
              </div>
            </div>
          </Col>
        </Row>

        {/* Action buttons */}
        {(onEdit || onDelete) && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            {onEdit && (
              <button
                onClick={() => onEdit(kpi)}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                Edit
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(kpi.id)}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  backgroundColor: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                Delete
              </button>
            )}
          </div>
        )}
      </Card.Body>
    </Card>
  );
};

/**
 * Quick Status Summary (shows count of statuses)
 */
interface KpiQuickStatusProps {
  kpis: Kpi[];
}

export const UnifiedKpiQuickStatus: React.FC<KpiQuickStatusProps> = ({ kpis }) => {
  const statusCounts = {
    'on-target': kpis.filter(k => k.status === 'on-target').length,
    'good': kpis.filter(k => k.status === 'good').length,
    'ok': kpis.filter(k => k.status === 'ok').length,
    'behind': kpis.filter(k => k.status === 'behind').length,
    'no-data': kpis.filter(k => k.status === 'no-data').length
  };

  return (
    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
      {statusCounts['on-target'] > 0 && (
        <Badge bg="success">✓ {statusCounts['on-target']} On Target</Badge>
      )}
      {statusCounts['good'] > 0 && (
        <Badge bg="info">→ {statusCounts['good']} Good</Badge>
      )}
      {statusCounts['ok'] > 0 && (
        <Badge bg="warning">↗ {statusCounts['ok']} OK</Badge>
      )}
      {statusCounts['behind'] > 0 && (
        <Badge bg="danger">⚠ {statusCounts['behind']} Behind</Badge>
      )}
      {statusCounts['no-data'] > 0 && (
        <Badge bg="secondary">○ {statusCounts['no-data']} No Data</Badge>
      )}
    </div>
  );
};
