import React from 'react';
import { Toast, Button } from 'react-bootstrap';
import { RefreshCw, X } from 'lucide-react';

interface VersionInfo {
  version: string;
  build: string;
  builtAt: string;
}

interface UpdateAvailableToastProps {
  show: boolean;
  currentVersion: VersionInfo | null;
  newVersion: VersionInfo | null;
  onReload: () => void;
  onDismiss: () => void;
}

export const UpdateAvailableToast: React.FC<UpdateAvailableToastProps> = ({
  show,
  currentVersion,
  newVersion,
  onReload,
  onDismiss
}) => {
  if (!show || !newVersion) return null;

  return (
    <div style={{ 
      position: 'fixed', 
      top: '20px', 
      right: '20px', 
      zIndex: 9999,
      maxWidth: '400px'
    }}>
      <Toast 
        show={show} 
        onClose={onDismiss}
        className="border-0 shadow-lg"
        style={{ 
          backgroundColor: 'var(--bs-primary)',
          color: 'var(--on-accent)'
        }}
      >
        <Toast.Header 
          closeButton={false}
          className="border-0 text-white"
          style={{ backgroundColor: 'var(--bs-primary)' }}
        >
          <RefreshCw className="me-2" size={16} />
          <strong className="me-auto">New Version Available</strong>
          <Button
            variant="link"
            size="sm"
            className="text-white p-0 border-0"
            onClick={onDismiss}
            style={{ 
              textDecoration: 'none',
              opacity: 0.8
            }}
          >
            <X size={16} />
          </Button>
        </Toast.Header>
        <Toast.Body className="text-white">
          <div className="mb-3">
            <div className="fw-semibold mb-1">BOB has been updated!</div>
            <div className="small opacity-75">
              Version {newVersion.version} ({newVersion.build}) is ready
            </div>
          </div>
          <div className="d-flex gap-2">
            <Button
              variant="light"
              size="sm"
              onClick={onReload}
              className="flex-fill fw-semibold"
            >
              <RefreshCw size={14} className="me-1" />
              Reload Now
            </Button>
            <Button
              variant="outline-light"
              size="sm"
              onClick={onDismiss}
              className="px-3"
            >
              Later
            </Button>
          </div>
          <div className="mt-2 small opacity-50">
            Any unsaved work will be preserved
          </div>
        </Toast.Body>
      </Toast>
    </div>
  );
};
