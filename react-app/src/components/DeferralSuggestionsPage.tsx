import React from 'react';
import { Container, Row, Col } from 'react-bootstrap';
import { CalendarClock, CheckCircle2 } from 'lucide-react';
import DeferralRecommendationBanner from './DeferralRecommendationBanner';
import PlannerCapacityBanner from './planner/PlannerCapacityBanner';
import { useDeferralCandidates } from '../hooks/useDeferralCandidates';

const DeferralSuggestionsPage: React.FC = () => {
  const { candidates, overCapacityMoves, scheduleWarnings, loading, currentSprint } = useDeferralCandidates();
  const hasSuggestions = candidates.length > 0 || overCapacityMoves.length > 0 || scheduleWarnings.length > 0;

  return (
    <Container fluid style={{ padding: '24px', backgroundColor: 'var(--bg)', minHeight: '100%' }}>
      <Row className="mb-4">
        <Col>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <CalendarClock size={22} />
            <h2 style={{ margin: 0, fontSize: '28px', fontWeight: 700, color: 'var(--text)' }}>
              Deferral suggestions
            </h2>
          </div>
          <p className="text-muted mb-0 mt-1">
            Stories and tasks in the current sprint that aren't a top-3, manually pinned, or focus-goal priority —
            candidates to move out so the sprint fits capacity.
          </p>
        </Col>
      </Row>

      <Row className="mb-3">
        <Col>
          <PlannerCapacityBanner />
        </Col>
      </Row>

      <Row>
        <Col>
          {!loading && currentSprint && !hasSuggestions ? (
            <div className="text-center text-muted" style={{ padding: '48px 0' }}>
              <CheckCircle2 size={28} style={{ marginBottom: 8 }} />
              <div>Nothing to defer — the current sprint is within capacity and priorities look clean.</div>
            </div>
          ) : (
            <DeferralRecommendationBanner hideOwnDismiss />
          )}
        </Col>
      </Row>
    </Container>
  );
};

export default DeferralSuggestionsPage;
