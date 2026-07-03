/**
 * HealthHubPage — /health and /health/:tab
 * Unified tabbed hub replacing the three scattered health routes.
 * Tabs: Metrics | Workouts | Coach
 * Old routes (/fitness, /coach, /fitness/full) redirect here via App.tsx.
 */
import React from 'react';
import { Nav, Container } from 'react-bootstrap';
import { useNavigate, useParams } from 'react-router-dom';
import { Activity, Brain, TrendingUp } from 'lucide-react';
import MetricsPage from '../MetricsPage';
import WorkoutsDashboard from '../WorkoutsDashboard';
import AiCoachPage from '../coach/AiCoachPage';

type HealthTab = 'metrics' | 'workouts' | 'coach';

const TABS: Array<{ key: HealthTab; label: string; icon: React.ReactNode }> = [
  { key: 'metrics',  label: 'Metrics',   icon: <TrendingUp size={14} /> },
  { key: 'workouts', label: 'Workouts',  icon: <Activity size={14} /> },
  { key: 'coach',    label: 'AI Coach',  icon: <Brain size={14} /> },
];

const HealthHubPage: React.FC = () => {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  const activeTab: HealthTab =
    tab === 'workouts' ? 'workouts' :
    tab === 'coach'    ? 'coach'    :
    'metrics';

  const handleTab = (key: HealthTab) => {
    navigate(key === 'metrics' ? '/health' : `/health/${key}`, { replace: true });
  };

  return (
    <div className="d-flex flex-column" style={{ height: '100%', minHeight: 0 }}>
      {/* Tab bar */}
      <div className="border-bottom px-3 pt-2" style={{ flexShrink: 0, background: 'var(--bs-body-bg)' }}>
        <Nav variant="tabs" className="border-0">
          {TABS.map(({ key, label, icon }) => (
            <Nav.Item key={key}>
              <Nav.Link
                active={activeTab === key}
                onClick={() => handleTab(key)}
                className="d-flex align-items-center gap-1"
                style={{ cursor: 'pointer', fontSize: '0.85rem', paddingBottom: '0.5rem' }}
              >
                {icon}
                {label}
              </Nav.Link>
            </Nav.Item>
          ))}
        </Nav>
      </div>

      {/* Tab content — each child manages its own scroll */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {activeTab === 'metrics'  && <MetricsPage />}
        {activeTab === 'workouts' && <WorkoutsDashboard />}
        {activeTab === 'coach'    && <AiCoachPage />}
      </div>
    </div>
  );
};

export default HealthHubPage;
