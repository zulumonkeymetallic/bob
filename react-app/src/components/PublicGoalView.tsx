import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { Goal } from '../types';
import { Container, Card, Spinner, Alert, ProgressBar, Row, Col } from 'react-bootstrap';
import './PublicGoalView.css';

interface KpiDisplayData {
  name: string;
  current: number;
  target: number;
  unit: string;
  progress: number;
  status: string;
}

const PublicGoalView: React.FC = () => {
  const { shareCode } = useParams<{ shareCode: string }>();
  const navigate = useNavigate();
  const [goal, setGoal] = useState<Goal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kpis, setKpis] = useState<KpiDisplayData[]>([]);

  const themeNames: { [key: number]: string } = {
    1: 'Health',
    2: 'Growth',
    3: 'Wealth',
    4: 'Tribe',
    5: 'Home',
  };

  const getThemeColor = (theme: number): string => {
    const colors: { [key: number]: string } = {
      1: '#198754', // Green (Health)
      2: '#0d6efd', // Blue (Growth)
      3: '#ffc107', // Yellow (Wealth)
      4: '#6f42c1', // Purple (Tribe)
      5: '#fd7e14', // Orange (Home)
    };
    return colors[theme] || '#6c757d';
  };

  const getStatusBadge = (progress: number): { color: string; label: string } => {
    if (progress >= 100) return { color: 'success', label: '✓ On Target' };
    if (progress >= 80) return { color: 'info', label: '→ Good Progress' };
    if (progress >= 50) return { color: 'warning', label: '↗ OK' };
    return { color: 'danger', label: '⚠ Behind' };
  };

  useEffect(() => {
    const fetchGoal = async () => {
      if (!shareCode) {
        setError('Invalid share code');
        setLoading(false);
        return;
      }

      try {
        const goalsRef = collection(db, 'goals');
        const q = query(goalsRef, where('shareCode', '==', shareCode), where('isPublished', '==', true));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
          setError('Goal not found or not published');
          setLoading(false);
          return;
        }

        const goalData = querySnapshot.docs[0].data() as Goal;
        setGoal(goalData);

        // Extract KPI data - support both old kpis format and new kpisV2
        const kpiArray = (goalData as any).kpisV2 || goalData.kpis || [];
        const extractedKpis: KpiDisplayData[] = kpiArray.map((kpi: any) => ({
          name: kpi.name,
          current: kpi.current ?? 0,
          target: kpi.target,
          unit: kpi.unit,
          progress: kpi.progress ?? 0,
          status: kpi.status ?? 'no-data',
        }));
        setKpis(extractedKpis);
      } catch (err) {
        console.error('Error fetching published goal:', err);
        setError('Failed to load goal. Please check the share link.');
      } finally {
        setLoading(false);
      }
    };

    fetchGoal();
  }, [shareCode]);

  if (loading) {
    return (
      <Container className="d-flex justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
        <div className="text-center">
          <Spinner animation="border" role="status" className="mb-3" />
          <p>Loading shared goal...</p>
        </div>
      </Container>
    );
  }

  if (error || !goal) {
    return (
      <Container className="d-flex justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
        <div style={{ maxWidth: '500px', width: '100%' }}>
          <Alert variant="warning">
            <Alert.Heading>Goal Not Found</Alert.Heading>
            <p>{error || 'This shared goal is no longer available.'}</p>
            <button className="btn btn-primary mt-3" onClick={() => navigate('/')}>
              Back to Home
            </button>
          </Alert>
        </div>
      </Container>
    );
  }

  const themeColor = getThemeColor(goal.theme);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', padding: '40px 20px' }}>
      <Container style={{ maxWidth: '700px' }}>
        {/* Header */}
        <div style={{ marginBottom: '30px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: themeColor,
              }}
            />
            <span style={{ fontSize: '12px', color: '#6c757d', textTransform: 'uppercase', fontWeight: '600' }}>
              {themeNames[goal.theme] || 'Goal'} • Shared Goal
            </span>
          </div>
          <h1 style={{ fontSize: '32px', fontWeight: 'bold', marginBottom: '12px', lineHeight: '1.2' }}>
            {goal.title}
          </h1>
        </div>

        {/* Goal Description */}
        {goal.description && (
          <Card className="mb-4" style={{ border: '1px solid #e9ecef' }}>
            <Card.Body>
              <p style={{ color: '#495057', margin: 0, fontSize: '15px', lineHeight: '1.6' }}>
                {goal.description}
              </p>
            </Card.Body>
          </Card>
        )}

        {/* KPIs Section */}
        {kpis.length > 0 && (
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Progress</h3>
            <div style={{ display: 'grid', gap: '16px' }}>
              {kpis.map((kpi, idx) => {
                const statusInfo = getStatusBadge(kpi.progress);
                return (
                  <Card key={idx} style={{ border: '1px solid #e9ecef' }}>
                    <Card.Body>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <h5 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>{kpi.name}</h5>
                        <span
                          className={`badge bg-${statusInfo.color}`}
                          style={{
                            fontSize: '11px',
                            padding: '4px 8px',
                            fontWeight: '500',
                          }}
                        >
                          {statusInfo.label}
                        </span>
                      </div>

                      {/* Progress Bar */}
                      <ProgressBar
                        now={Math.min(kpi.progress, 100)}
                        style={{ height: '8px', marginBottom: '8px' }}
                        className={`bg-${statusInfo.color}`}
                      />

                      {/* Stats */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#6c757d' }}>
                        <span>
                          {kpi.current.toLocaleString()} / {kpi.target.toLocaleString()} {kpi.unit}
                        </span>
                        <span style={{ fontWeight: '600', color: '#212529' }}>{kpi.progress}%</span>
                      </div>
                    </Card.Body>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* No KPIs Message */}
        {kpis.length === 0 && (
          <Card style={{ border: '1px solid #e9ecef', backgroundColor: '#f8f9fa' }}>
            <Card.Body style={{ textAlign: 'center', color: '#6c757d', padding: '32px 20px' }}>
              <p style={{ margin: 0, fontSize: '14px' }}>No KPI progress data yet</p>
            </Card.Body>
          </Card>
        )}

        {/* Footer */}
        <div style={{ marginTop: '40px', textAlign: 'center', color: '#6c757d', fontSize: '12px' }}>
          <p style={{ margin: '0 0 16px 0' }}>
            This shared goal was published on{' '}
            {goal.publishedAt
              ? new Date(goal.publishedAt.toDate?.() || goal.publishedAt).toLocaleDateString()
              : 'a recent date'}
          </p>
          <button
            className="btn btn-outline-secondary btn-sm"
            onClick={() => navigate('/')}
            style={{ fontSize: '13px' }}
          >
            Back to Home
          </button>
        </div>
      </Container>
    </div>
  );
};

export default PublicGoalView;
