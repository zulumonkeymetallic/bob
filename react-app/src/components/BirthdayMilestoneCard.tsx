import React, { useMemo, useState, useEffect } from 'react';
import { Card, ProgressBar, Button } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { Cake, Target, X } from 'lucide-react';

interface BirthdayMilestoneCardProps {
  targetDate: Date; // Sept 22, 2027
  age: number; // 45
  linkedGoalsCount?: number;
}

const BIRTHDAY_BANNER_DISMISS_KEY = 'birthday-banner-dismissed-date';
const SHOW_EVERY_DAYS = 3;

const BirthdayMilestoneCard: React.FC<BirthdayMilestoneCardProps> = ({
  targetDate,
  age,
  linkedGoalsCount = 0
}) => {
  const navigate = useNavigate();
  const [showBanner, setShowBanner] = useState(true);

  // Check if we should show the banner (only every 3 days)
  useEffect(() => {
    const dismissedDate = localStorage.getItem(BIRTHDAY_BANNER_DISMISS_KEY);
    if (dismissedDate) {
      const lastDismissed = new Date(dismissedDate);
      const now = new Date();
      const daysSinceDismiss = Math.floor((now.getTime() - lastDismissed.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceDismiss < SHOW_EVERY_DAYS) {
        setShowBanner(false);
        return;
      }
    }
    setShowBanner(true);
  }, []);

  const handleDismissBanner = () => {
    localStorage.setItem(BIRTHDAY_BANNER_DISMISS_KEY, new Date().toISOString());
    setShowBanner(false);
  };

  const { daysUntil, progress, isToday, isPast } = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysTotal = Math.floor((target.getTime() - new Date(target.getFullYear() - 1, target.getMonth(), target.getDate()).getTime()) / msPerDay);
    const daysLeft = Math.max(0, Math.floor((target.getTime() - today.getTime()) / msPerDay));
    
    const progressPercent = Math.round(((daysTotal - daysLeft) / daysTotal) * 100);

    return {
      daysUntil: daysLeft,
      progress: Math.min(100, Math.max(0, progressPercent)),
      isToday: daysLeft === 0,
      isPast: daysLeft < 0
    };
  }, [targetDate]);

  if (isPast || !showBanner) return null; // Don't show if date has passed or dismissed within 3 days

  const formattedDate = targetDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  return (
    <Card
      className="mb-3"
      style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        border: 'none',
        color: '#fff',
        boxShadow: '0 8px 24px rgba(102, 126, 234, 0.3)'
      }}
    >
      <Card.Body style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '8px',
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backdropFilter: 'blur(10px)',
              flexShrink: 0
            }}
          >
            <Cake size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h5 style={{ margin: 0, fontSize: '14px', fontWeight: '700' }}>
              Turning {age}
            </h5>
            <p style={{ margin: '2px 0 0 0', fontSize: '11px', opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {formattedDate} • {daysUntil} days
            </p>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '20px', fontWeight: '800', lineHeight: 1 }}>
              {daysUntil}
            </div>
          </div>
          <button 
            onClick={handleDismissBanner}
            style={{
              background: 'rgba(255, 255, 255, 0.2)',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
            title="Dismiss for 3 days"
          >
            <X size={16} />
          </button>
        </div>

        {/* Compact progress bar */}
        <div style={{ marginTop: '8px' }}>
          <ProgressBar
            now={progress}
            style={{
              height: '4px',
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              borderRadius: '2px'
            }}
            className="bg-light"
          />
        </div>

        {/* Compact status line */}
        {linkedGoalsCount > 0 && (
          <div style={{ marginTop: '6px', fontSize: '11px', opacity: 0.85, display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Target size={12} />
            <span>{linkedGoalsCount} goal{linkedGoalsCount !== 1 ? 's' : ''}</span>
            <button
              onClick={() => navigate('/focus-goals')}
              style={{
                background: 'rgba(255, 255, 255, 0.15)',
                color: '#fff',
                border: 'none',
                padding: '2px 6px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '10px',
                fontWeight: '600',
                marginLeft: 'auto'
              }}
            >
              View
            </button>
          </div>
        )}

        {/* Birthday message only on the day */}
        {isToday && (
          <div
            style={{
              marginTop: '6px',
              padding: '4px 6px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              borderRadius: '3px',
              fontSize: '10px',
              fontStyle: 'italic',
              borderLeft: '2px solid rgba(255, 255, 255, 0.5)',
              textAlign: 'center'
            }}
          >
            🎉 Happy Birthday! 🎉
          </div>
        )}
      </Card.Body>
    </Card>
  );
};

export default BirthdayMilestoneCard;

