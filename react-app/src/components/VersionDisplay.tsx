import React, { useState, useEffect } from 'react';
import { Button, Badge, Popover, OverlayTrigger } from 'react-bootstrap';
import { Clock, RefreshCw, Info } from 'lucide-react';
import { VERSION, BUILD_DATE } from '../version';
import { versionTimeoutService } from '../services/versionTimeoutService';

interface VersionDisplayProps {
  className?: string;
  variant?: 'full' | 'compact' | 'badge-only';
  showSessionInfo?: boolean;
}

const VersionDisplay: React.FC<VersionDisplayProps> = ({ 
  className = '', 
  variant = 'compact',
  showSessionInfo = true 
}) => {
  const [sessionInfo, setSessionInfo] = useState({
    duration: 0,
    timeUntilTimeout: 30,
    version: VERSION
  });
  const [lastUpdateCheck, setLastUpdateCheck] = useState<Date | null>(null);

  useEffect(() => {
    const updateSessionInfo = () => {
      const info = versionTimeoutService.getSessionInfo();
      setSessionInfo(info);
    };

    // Update immediately
    updateSessionInfo();

    // Update every minute
    const interval = setInterval(updateSessionInfo, 60000);

    return () => clearInterval(interval);
  }, []);

  const handleForceCheck = async () => {
    setLastUpdateCheck(new Date());
    await versionTimeoutService.forceVersionCheck();
  };

  const getTimeoutColor = () => {
    if (sessionInfo.timeUntilTimeout <= 5) return 'danger';
    if (sessionInfo.timeUntilTimeout <= 15) return 'warning';
    return 'success';
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

  const versionPopover = (
    <Popover id="version-popover" style={{ maxWidth: '300px' }}>
      <Popover.Header as="h3">
        <Info size={16} className="me-1" />
        App Information
      </Popover.Header>
      <Popover.Body>
        <div className="mb-2">
          <strong>Version:</strong> v{VERSION}
        </div>
        <div className="mb-2">
          <strong>Build Time:</strong><br />
          <small className="text-muted">{BUILD_DATE}</small>
        </div>
        
        {showSessionInfo && (
          <>
            <hr />
            <div className="mb-2">
              <strong>Session Duration:</strong><br />
              <Badge bg="info">{formatDuration(sessionInfo.duration)}</Badge>
            </div>
            <div className="mb-2">
              <strong>Time Until Refresh:</strong><br />
              <Badge bg={getTimeoutColor()}>{formatDuration(sessionInfo.timeUntilTimeout)}</Badge>
            </div>
            <small className="text-muted">
              App automatically refreshes after 30 minutes to ensure you have the latest updates.
            </small>
          </>
        )}
        
        <hr />
        <div className="d-flex gap-2">
          <Button 
            size="sm" 
            variant="outline-primary" 
            onClick={handleForceCheck}
            disabled={lastUpdateCheck && (Date.now() - lastUpdateCheck.getTime()) < 5000}
          >
            <RefreshCw size={14} className="me-1" />
            Check Updates
          </Button>
        </div>
        
        {lastUpdateCheck && (
          <div className="mt-2">
            <small className="text-success">
              ✅ Last checked: {lastUpdateCheck.toLocaleTimeString()}
            </small>
          </div>
        )}
      </Popover.Body>
    </Popover>
  );

  if (variant === 'badge-only') {
    return (
      <OverlayTrigger trigger="click" placement="top" overlay={versionPopover}>
        <Badge 
          bg="secondary" 
          className={`cursor-pointer ${className}`}
          style={{ cursor: 'pointer' }}
        >
          v{VERSION}
        </Badge>
      </OverlayTrigger>
    );
  }

  if (variant === 'full') {
    return (
      <div className={`d-flex align-items-center gap-2 ${className}`}>
        <OverlayTrigger trigger="click" placement="top" overlay={versionPopover}>
          <div 
            className="d-flex align-items-center gap-1 text-muted"
            style={{ cursor: 'pointer', fontSize: '0.85rem' }}
          >
            <Info size={14} />
            <span>v{VERSION}</span>
            {showSessionInfo && (
              <>
                <Clock size={12} className="ms-1" />
                <span className="text-muted">
                  {formatDuration(sessionInfo.timeUntilTimeout)} left
                </span>
              </>
            )}
          </div>
        </OverlayTrigger>
        
        <Button 
          variant="link" 
          size="sm" 
          onClick={handleForceCheck}
          className="p-0 text-muted"
          style={{ fontSize: '0.75rem' }}
          disabled={lastUpdateCheck && (Date.now() - lastUpdateCheck.getTime()) < 5000}
        >
          <RefreshCw size={12} />
        </Button>
      </div>
    );
  }

  // Default compact variant
  return (
    <OverlayTrigger trigger="click" placement="top" overlay={versionPopover}>
      <div 
        className={`text-center ${className}`}
        style={{ 
          fontSize: '0.75rem', 
          color: 'var(--notion-text-gray, #6b7280)',
          cursor: 'pointer',
          padding: '4px 0'
        }}
      >
        <div className="d-flex align-items-center justify-content-center gap-1">
          <span>v{VERSION}</span>
          {showSessionInfo && sessionInfo.timeUntilTimeout <= 10 && (
            <Badge 
              bg={getTimeoutColor()} 
              style={{ fontSize: '0.6rem' }}
            >
              {sessionInfo.timeUntilTimeout}m
            </Badge>
          )}
        </div>
      </div>
    </OverlayTrigger>
  );
};

export default VersionDisplay;
