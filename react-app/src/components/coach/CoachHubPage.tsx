/**
 * CoachHubPage — /coach and /coach/:tab
 * Unified tabbed hub combining AI Coach + Finance Coach.
 * Tab: ai (default) | finance
 */
import React from 'react';
import { Nav } from 'react-bootstrap';
import { useNavigate, useParams } from 'react-router-dom';
import { Brain, TrendingUp } from 'lucide-react';
import AiCoachPage from './AiCoachPage';
import FinanceCoachPage from '../finance/FinanceCoachPage';
import WorkSurfaceNav from '../common/WorkSurfaceNav';

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
    navigate(key === 'ai' ? '/coach' : '/coach/finance', { replace: true });
  };

  return (
    <div className="d-flex flex-column" style={{ height: '100%', minHeight: 0 }}>
      <div className="border-bottom px-3 pt-2" style={{ flexShrink: 0, background: 'var(--bs-body-bg)' }}>
        <WorkSurfaceNav />
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
        {activeTab === 'ai'      && <AiCoachPage />}
        {activeTab === 'finance' && <FinanceCoachPage />}
      </div>
    </div>
  );
};

export default CoachHubPage;
