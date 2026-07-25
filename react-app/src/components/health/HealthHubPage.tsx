/**
 * HealthHubPage — /health and /health/:tab
 * Unified tabbed hub. Tabs: Metrics | Workouts
 * /fitness/full, /workouts, /running-results and /parkrun-results redirect here.
 * /fitness and /coach do NOT — they remain their own routes (MetricsPage / CoachHubPage).
 *
 * The AI Coach lives at /coach (CoachHubPage) and nowhere else. This hub used to render a
 * third copy of AiCoachPage in its own tab; /health/coach now redirects there instead, so
 * there is one coach screen with one URL rather than the same page at three addresses.
 */
import React from 'react';
import { Nav } from 'react-bootstrap';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Activity, TrendingUp } from 'lucide-react';
import MetricsPage from '../MetricsPage';
import WorkoutsDashboard from '../WorkoutsDashboard';

type HealthTab = 'metrics' | 'workouts';

const TABS: Array<{ key: HealthTab; label: string; icon: React.ReactNode }> = [
  { key: 'metrics',  label: 'Metrics',   icon: <TrendingUp size={14} /> },
  { key: 'workouts', label: 'Workouts',  icon: <Activity size={14} /> },
];

const HealthHubPage: React.FC = () => {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  // Preserve existing /health/coach links and bookmarks.
  if (tab === 'coach') return <Navigate to="/coach" replace />;

  const activeTab: HealthTab = tab === 'workouts' ? 'workouts' : 'metrics';

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
      </div>
    </div>
  );
};

export default HealthHubPage;
