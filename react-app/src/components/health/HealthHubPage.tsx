/**
 * HealthHubPage — /health and /health/:tab
 *
 * The single health surface. Tabs: Coach | Metrics | Workouts | Zones.
 *
 * Everything health-related redirects here — /fitness, /fitness/full, /workouts,
 * /running-results, /parkrun-results, and the fitness half of /coach. `/coach` itself
 * stays put and keeps the **Finance** coach, which is not health.
 *
 * ## The coach is rendered once, not copied
 *
 * This hub previously had a Coach tab that was a third copy of `AiCoachPage`, and it was
 * removed for exactly that reason — the same page living at three addresses. Bringing it
 * back means importing the one component and pointing every other route at this tab, so
 * there is still one screen; it simply now has one home rather than its own.
 *
 * Nothing has been deleted in this pass. The point is to get every surface into one place
 * so it can be looked at side by side and pruned deliberately.
 */
import React from 'react';
import { Nav } from 'react-bootstrap';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Activity, Brain, HeartPulse, TrendingUp } from 'lucide-react';
import MetricsPage from '../MetricsPage';
import WorkoutsDashboard from '../WorkoutsDashboard';
import AiCoachPage from '../coach/AiCoachPage';
import ZonesPanel from './ZonesPanel';

type HealthTab = 'coach' | 'metrics' | 'workouts' | 'zones';

const TABS: Array<{ key: HealthTab; label: string; icon: React.ReactNode }> = [
  { key: 'coach',    label: 'Coach',    icon: <Brain size={14} /> },
  { key: 'metrics',  label: 'Metrics',  icon: <TrendingUp size={14} /> },
  { key: 'workouts', label: 'Workouts', icon: <Activity size={14} /> },
  { key: 'zones',    label: 'Zones',    icon: <HeartPulse size={14} /> },
];

const TAB_KEYS = new Set<string>(TABS.map(t => t.key));

/**
 * Coach first on a phone, Metrics first on a desktop.
 *
 * The mobile tab bar no longer has its own Coach entry — Fitness points here — so landing
 * on Coach keeps it one tap from the bottom bar, which is what it was before.
 */
const defaultTab = (): HealthTab =>
  (typeof window !== 'undefined' && window.innerWidth < 768) ? 'coach' : 'metrics';

const HealthHubPage: React.FC = () => {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  // An unrecognised tab is a stale bookmark, not a blank screen.
  if (tab && !TAB_KEYS.has(tab)) return <Navigate to="/health" replace />;

  const activeTab: HealthTab = (tab as HealthTab) || defaultTab();

  const handleTab = (key: HealthTab) => {
    navigate(`/health/${key}`, { replace: true });
  };

  return (
    <div className="d-flex flex-column" style={{ height: '100%', minHeight: 0 }}>
      <div className="border-bottom px-3 pt-2" style={{ flexShrink: 0, background: 'var(--bs-body-bg)' }}>
        <Nav variant="tabs" className="border-0 flex-nowrap" style={{ overflowX: 'auto' }}>
          {TABS.map(({ key, label, icon }) => (
            <Nav.Item key={key}>
              <Nav.Link
                active={activeTab === key}
                onClick={() => handleTab(key)}
                className="d-flex align-items-center gap-1 text-nowrap"
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
        {activeTab === 'coach'    && <AiCoachPage />}
        {activeTab === 'metrics'  && <MetricsPage />}
        {activeTab === 'workouts' && <WorkoutsDashboard />}
        {activeTab === 'zones'    && <div className="p-3"><ZonesPanel /></div>}
      </div>
    </div>
  );
};

export default HealthHubPage;
