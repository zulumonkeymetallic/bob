import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { DatabaseMigration } from '../utils/databaseMigration';
import { Modal, Button, ProgressBar, Alert } from 'react-bootstrap';

interface MigrationManagerProps {
  children: React.ReactNode;
}

export const MigrationManager: React.FC<MigrationManagerProps> = ({ children }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [showMigrationModal, setShowMigrationModal] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState(0);
  const [migrationStatus, setMigrationStatus] = useState<'checking' | 'needed' | 'running' | 'complete' | 'error'>('checking');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (currentUser && currentPersona) {
      checkAndRunMigration();
    }
  }, [currentUser, currentPersona]);

  const checkAndRunMigration = async () => {
    if (!currentUser || !currentPersona) return;

    try {
      setMigrationStatus('checking');
      
      // Migration is completed - skip check and mark as complete
      console.log('🎯 Migration system bypassed - database migration completed');
      setMigrationStatus('complete');
      
      // Legacy code for reference - migration check disabled
      // const needsMigration = await DatabaseMigration.checkMigrationNeeded(currentUser.uid, currentPersona);
      
      // if (needsMigration) {
      //   setMigrationStatus('needed');
      //   setShowMigrationModal(true);
      // } else {
      //   setMigrationStatus('complete');
      // }
    } catch (error) {
      console.error('Error checking migration status:', error);
      setMigrationStatus('error');
      setErrorMessage('Failed to check migration status');
    }
  };

  const runMigration = async () => {
    if (!currentUser || !currentPersona) return;

    try {
      setMigrationStatus('running');
      setMigrationProgress(25);
      
      await DatabaseMigration.migrateAllData(currentUser.uid, currentPersona);
      
      setMigrationProgress(100);
      setMigrationStatus('complete');
      
      setTimeout(() => {
        setShowMigrationModal(false);
        // Refresh the page to load data with new integer values
        window.location.reload();
      }, 2000);
      
    } catch (error) {
      console.error('Migration failed:', error);
      setMigrationStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Migration failed');
    }
  };

  const skipMigration = () => {
    setShowMigrationModal(false);
    // Store in localStorage that user skipped migration
    localStorage.setItem('migrationSkipped', 'true');
  };

  if (migrationStatus === 'checking') {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ height: '100vh' }}>
        <div className="text-center">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="mt-2">Checking data compatibility...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
      
      <Modal 
        show={showMigrationModal} 
        onHide={() => {}} 
        backdrop="static" 
        keyboard={false}
        centered
      >
        <Modal.Header>
          <Modal.Title>Data Migration Required</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {migrationStatus === 'needed' && (
            <>
              <Alert variant="info">
                <h6>System Upgrade Detected</h6>
                <p>BOB has been upgraded to use a more efficient data structure. A one-time migration is required to convert your existing data to the new format.</p>
                <ul>
                  <li>✅ Improved performance</li>
                  <li>✅ Better data consistency</li>
                  <li>✅ ServiceNow-style choice management</li>
                </ul>
                <p className="mb-0"><strong>This process is safe and will not lose any data.</strong></p>
              </Alert>
            </>
          )}
          
          {migrationStatus === 'running' && (
            <>
              <p>Migrating your data to the new format...</p>
              <ProgressBar now={migrationProgress} label={`${migrationProgress}%`} />
              <p className="mt-2 text-muted small">Please wait, this may take a few moments.</p>
            </>
          )}
          
          {migrationStatus === 'complete' && (
            <Alert variant="success">
              <h6>Migration Complete!</h6>
              <p>Your data has been successfully migrated. The page will refresh automatically.</p>
            </Alert>
          )}
          
          {migrationStatus === 'error' && (
            <Alert variant="danger">
              <h6>Migration Error</h6>
              <p>{errorMessage}</p>
              <p>You can continue using BOB, but some features may not work correctly until migration is completed.</p>
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          {migrationStatus === 'needed' && (
            <>
              <Button variant="outline-secondary" onClick={skipMigration}>
                Skip for now
              </Button>
              <Button variant="primary" onClick={runMigration}>
                Run Migration
              </Button>
            </>
          )}
          
          {migrationStatus === 'error' && (
            <>
              <Button variant="outline-secondary" onClick={skipMigration}>
                Continue anyway
              </Button>
              <Button variant="primary" onClick={runMigration}>
                Retry Migration
              </Button>
            </>
          )}
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default MigrationManager;
