/**
 * CoachHubPage — /coach/:tab
 *
 * The **finance** coach. The fitness coach moved into the health hub
 * (`/health/coach`), so that it sits beside the metrics it talks about rather than in a
 * separate section — `/coach`, `/coach/ai` and `/ai-coach` all redirect there.
 *
 * The fitness tab is kept here as a link into the hub rather than a second render of
 * `AiCoachPage`. One coach screen, one address; this is a signpost for existing
 * bookmarks and muscle memory.
 */
import React from 'react';
import { Nav } from 'react-bootstrap';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Brain, TrendingUp } from 'lucide-react';
import FinanceCoachPage from '../finance/FinanceCoachPage';

type CoachTab = 'ai' | 'finance';

const TABS: Array<{ key: CoachTab; label: string; icon: React.ReactNode }> = [
  { key: 'ai',      label: 'Fitness Coach', icon: <Brain size={14} /> },
  { key: 'finance', label: 'Finance Coach', icon: <TrendingUp size={14} /> },
];

const CoachHubPage: React.FC = () => {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  const activeTab: CoachTab = tab === 'finance' ? 'finance' : 'ai';

  const handleTab = (key: CoachTab) => {
    navigate(key === 'ai' ? '/health/coach' : '/coach/finance', { replace: true });
  };

  return (
    <div className="d-flex flex-column" style={{ height: '100%', minHeight: 0 }}>
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
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {/* `ai` is unreachable in practice — /coach/ai redirects to /health/coach before
            this renders. Kept as a graceful landing rather than a blank pane if a route
            ever changes underneath it. */}
        {activeTab === 'ai'      && <Navigate to="/health/coach" replace />}
        {activeTab === 'finance' && <FinanceCoachPage />}
      </div>
    </div>
  );
};

export default CoachHubPage;
