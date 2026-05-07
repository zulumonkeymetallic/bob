import React, { useEffect, useState } from 'react';
import { Alert, Button, Badge, Col } from 'react-bootstrap';
import { Plane, Calendar, Target, TrendingDown } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

interface CountdownBannerProps {
  goalId?: string;
  targetDate: Date;
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  color?: 'primary' | 'warning' | 'danger' | 'success' | 'info';
  showProgress?: boolean;
}

const CountdownBanner: React.FC<CountdownBannerProps> = ({
  goalId,
  targetDate,
  title = 'China Trip Countdown',
  subtitle,
  icon = <Plane size={20} />,
  color = 'warning',
  showProgress = true,
}) => {
  const { currentUser } = useAuth();
  const [daysLeft, setDaysLeft] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [goalData, setGoalData] = useState<any>(null);
  const [isDismissed, setIsDismissed] = useState<boolean>(() => {
    const dismissed = localStorage.getItem('countdown-banner-dismissed');
    return dismissed === 'true';
  });

  // Update countdown every minute
  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      setCurrentTime(now);
      const diff = targetDate.getTime() - now.getTime();
      const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
      setDaysLeft(days > 0 ? days : 0);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [targetDate]);

  // Fetch goal data if goalId is provided
  useEffect(() => {
    if (!currentUser || !goalId) return;
    
    const goalRef = doc(db, 'goals', goalId);
    const unsub = onSnapshot(goalRef, (docSnap) => {
      if (docSnap.exists()) {
        setGoalData(docSnap.data());
      }
    });
    
    return () => unsub();
  }, [currentUser, goalId]);

  const handleDismiss = () => {
    setIsDismissed(true);
    localStorage.setItem('countdown-banner-dismissed', 'true');
  };

  const handleReopen = () => {
    setIsDismissed(false);
    localStorage.removeItem('countdown-banner-dismissed');
  };

  if (isDismissed) {
    return (
      <Alert variant="info" className="border-0 shadow-sm mb-3">
        <div className="d-flex justify-content-between align-items-center">
          <span className="small">
            <Button 
              variant="link" 
              onClick={handleReopen}
              className="p-0 text-decoration-none"
            >
              Reopen countdown banner
            </Button>
          </span>
        </div>
      </Alert>
    );
  }

  // Calculate progress percentage (if showing progress)
  const progressPercent = showProgress ? Math.min(100, Math.max(0, (daysLeft / 180) * 100)) : 0;

  // Dynamic styling based on days left
  const urgencyLevel = daysLeft <= 30 ? 'danger' : daysLeft <= 60 ? 'warning' : 'info';

  return (
    <Alert 
      variant={urgencyLevel} 
      className="border-0 shadow-md position-sticky top-0 z-index-100 mb-3"
      style={{ backdropFilter: 'blur(10px)', backgroundColor: `rgba(var(--bs-${urgencyLevel}-rgb), 0.95)` }}
    >
      <div className="row align-items-center g-3">
        {/* Icon and Days Left */}
        <Col xs={12} sm={4}>
          <div className="d-flex align-items-center gap-2">
            <div className={`p-2 rounded-circle bg-${urgencyLevel}-subtle text-${urgencyLevel}`}>
              {icon}
            </div>
            <div>
              <div className="h4 mb-0 fw-bold">
                {daysLeft} <span className="fs-6 fw-normal text-muted">days</span>
              </div>
              <div className="small text-muted">until {targetDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}</div>
            </div>
          </div>
        </Col>

        {/* Title and Subtitle */}
        <Col xs={12} sm={4}>
          <div>
            <h6 className="fw-bold mb-1">{title}</h6>
            {subtitle && <div className="small text-muted">{subtitle}</div>}
            {showProgress && (
              <div className="mt-2">
                <div className="d-flex justify-content-between small mb-1">
                  <span>Progress timeline</span>
                  <span>{progressPercent.toFixed(0)}% remaining</span>
                </div>
                <div className="progress" style={{ height: '6px' }}>
                  <div 
                    className={`progress-bar bg-${urgencyLevel}`} 
                    role="progressbar" 
                    style={{ width: `${progressPercent}%` }}
                    aria-valuenow={progressPercent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  />
                </div>
              </div>
            )}
          </div>
        </Col>

        {/* Goal Status Badges (if goal data available) */}
        <Col xs={12} sm={4}>
          <div className="d-flex flex-wrap gap-2 justify-content-sm-end">
            {goalData && goalData.title && (
              <Badge bg={goalData.priority === 'high' ? 'danger' : 'secondary'} pill>
                {goalData.priority || 'Normal'} Priority
              </Badge>
            )}
            {goalData && goalData.ref && (
              <Badge bg="dark" pill>
                {goalData.ref}
              </Badge>
            )}
            {showProgress && daysLeft <= 90 && (
              <Badge bg="danger" className="pulse-animation">
                <Target size={12} className="me-1" />
                Critical Phase
              </Badge>
            )}
            {daysLeft <= 30 && (
              <Badge bg="warning text-dark" className="animate-bounce">
                <TrendingDown size={12} className="me-1" />
                Final Stretch!
              </Badge>
            )}
          </div>
        </Col>

        {/* Dismiss Button */}
        <div className="col-12 mt-2">
          <div className="d-flex justify-content-end">
            <Button 
              variant="outline-{urgencyLevel}" 
              size="sm" 
              onClick={handleDismiss}
              className="btn-sm px-3"
            >
              Dismiss for now
            </Button>
          </div>
        </div>
      </div>
    </Alert>
  );
};

export default CountdownBanner;
