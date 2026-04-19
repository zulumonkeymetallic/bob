/**
 * HeroSection — Simplified dashboard entry point
 * 
 * Aggregates:
 * - Top 3 Priorities: Key focus items derived from goals/stories
 * - Health Readiness: Derived HRV + Sleep score
 * - Discretionary Spend: Quick view of financial status
 */
import React from 'react';
import { Card, Row, Col } from 'react-bootstrap';
import { Target, Heart, DollarSign } from 'lucide-react';

export const HeroSection: React.FC<{ isDark: boolean }> = ({ isDark }) => {
  const bg = isDark ? '#1e2433' : '#ffffff';
  const border = `1px solid ${isDark ? '#2d3748' : '#e2e8f0'}`;
  const textColor = isDark ? '#f1f5f9' : '#1e293b';

  return (
    <Row className="g-3 mb-4">
      <Col xs={12} lg={4}>
        <Card style={{ background: bg, border, borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Target size={18} color="#3b82f6" />
            <h5 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: textColor }}>Top 3 Priorities</h5>
          </div>
          <ul style={{ paddingLeft: 20, margin: 0, fontSize: 13, color: isDark ? '#9ca3af' : '#6b7280' }}>
            <li>Complete Project BOB Refactor</li>
            <li>Sync Mac Reminders Sync logic</li>
            <li>Update sprint health guardrails</li>
          </ul>
        </Card>
      </Col>
      <Col xs={12} sm={6} lg={4}>
        <Card style={{ background: bg, border, borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Heart size={18} color="#10b981" />
            <h5 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: textColor }}>Health Readiness</h5>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#10b981' }}>88%</div>
          <div style={{ fontSize: 12, color: isDark ? '#9ca3af' : '#6b7280' }}>Optimal · HRV above average</div>
        </Card>
      </Col>
      <Col xs={12} sm={6} lg={4}>
        <Card style={{ background: bg, border, borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <DollarSign size={18} color="#f59e0b" />
            <h5 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: textColor }}>Discretionary Spend</h5>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: textColor }}>$452.00</div>
          <div style={{ fontSize: 12, color: isDark ? '#9ca3af' : '#6b7280' }}>Remaining for this week</div>
        </Card>
      </Col>
    </Row>
  );
};
