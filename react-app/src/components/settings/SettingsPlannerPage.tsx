import React, { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, Row } from 'react-bootstrap';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { db, functions } from '../../firebase';

interface PlannerPrefs {
  nightlyMaintenanceEnabled: boolean;
  dailySummaryEnabled: boolean;
  dataQualityEmailEnabled: boolean;
}

const SettingsPlannerPage: React.FC = () => {
  const { currentUser } = useAuth();
  const [prefs, setPrefs] = useState<PlannerPrefs>({
    nightlyMaintenanceEnabled: true,
    dailySummaryEnabled: true,
    dataQualityEmailEnabled: true,
  });
  const [loadingPrefs, setLoadingPrefs] = useState(false);
  const [prefsMessage, setPrefsMessage] = useState('');
  const [prefsError, setPrefsError] = useState('');

  const [maintenanceStatus, setMaintenanceStatus] = useState('');
  const [maintenanceError, setMaintenanceError] = useState('');
  const [maintenanceRunning, setMaintenanceRunning] = useState(false);

  // Email-related actions moved to Email settings page
  const [normalizeStatus, setNormalizeStatus] = useState('');
  const [normalizeError, setNormalizeError] = useState('');
  const [normalizeRunning, setNormalizeRunning] = useState(false);

  useEffect(() => {
    const loadPrefs = async () => {
      if (!currentUser) return;
      setLoadingPrefs(true);
      setPrefsError('');
      try {
        const snap = await getDoc(doc(db, 'profiles', currentUser.uid));
        if (snap.exists()) {
          const data = snap.data() as any;
          setPrefs({
            nightlyMaintenanceEnabled: data?.nightlyMaintenanceEnabled !== false,
            dailySummaryEnabled: data?.dailySummaryEnabled !== false,
            dataQualityEmailEnabled: data?.dataQualityEmailEnabled !== false,
          });
        } else {
          setPrefs({ nightlyMaintenanceEnabled: true, dailySummaryEnabled: true, dataQualityEmailEnabled: true });
        }
      } catch (error: any) {
        console.error('[settings-planner] load prefs failed', error);
        setPrefsError(error?.message || 'Failed to load planner preferences');
      } finally {
        setLoadingPrefs(false);
      }
    };

    loadPrefs();
  }, [currentUser]);

  useEffect(() => {
    if (!prefsMessage) return;
    const timer = setTimeout(() => setPrefsMessage(''), 2500);
    return () => clearTimeout(timer);
  }, [prefsMessage]);

  useEffect(() => {
    if (!prefsError) return;
    const timer = setTimeout(() => setPrefsError(''), 4000);
    return () => clearTimeout(timer);
  }, [prefsError]);

  const updatePreference = async (patch: Partial<PlannerPrefs>) => {
    if (!currentUser) return;
    const previous = prefs;
    const next = { ...previous, ...patch };
    setPrefs(next);
    try {
      await setDoc(doc(db, 'profiles', currentUser.uid), {
        nightlyMaintenanceEnabled: next.nightlyMaintenanceEnabled,
        dailySummaryEnabled: next.dailySummaryEnabled,
        dataQualityEmailEnabled: next.dataQualityEmailEnabled,
      }, { merge: true });
      setPrefsMessage('Preferences updated');
    } catch (error: any) {
      console.error('[settings-planner] update prefs failed', error);
      setPrefsError(error?.message || 'Failed to save preferences');
      setPrefs(previous); // revert optimistic update
    }
  };

  const handleRunMaintenance = async () => {
    if (!currentUser) return;
    setMaintenanceRunning(true);
    setMaintenanceStatus('');
    setMaintenanceError('');
    try {
      const callable = httpsCallable(functions, 'runNightlyMaintenanceNow');
      const response: any = await callable({ sendSummary: false });
      const payload = response?.data ?? response;
      const summary = payload?.maintenance?.summary || payload?.maintenanceSummary;
      if (summary?.priority && typeof summary.priority.updated === 'number') {
        setMaintenanceStatus(`AI reprioritised ${summary.priority.updated} tasks and adjusted ${summary.dueDates?.adjustedTop || 0} due dates.`);
      } else {
        setMaintenanceStatus('AI reprioritisation completed');
      }
    } catch (error: any) {
      console.error('[settings-planner] maintenance trigger failed', error);
      setMaintenanceError(error?.message || 'Failed to run AI reprioritisation');
    } finally {
      setMaintenanceRunning(false);
    }
  };

  // removed: handleSendDailySummary, handleSendDataQuality, handlePreviewSummary

  const handleNormalizeStatuses = async () => {
    if (!currentUser) return;
    setNormalizeRunning(true);
    setNormalizeStatus('');
    setNormalizeError('');
    try {
      const callable = httpsCallable(functions, 'normalizeStatuses');
      const response: any = await callable({});
      const payload = response?.data ?? response;
      setNormalizeStatus(`Normalized ${payload?.storiesUpdated || 0} stories and ${payload?.tasksUpdated || 0} tasks.`);
    } catch (error: any) {
      console.error('[settings-planner] normalize statuses failed', error);
      setNormalizeError(error?.message || 'Failed to normalize statuses');
    } finally {
      setNormalizeRunning(false);
    }
  };

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-0">Planner & Automation Settings</h2>
          <small className="text-muted">Control AI assistant behaviour and run immediate checks.</small>
        </div>
        <Badge bg={prefs.nightlyMaintenanceEnabled ? 'success' : 'secondary'}>
          {prefs.nightlyMaintenanceEnabled ? 'Automations On' : 'Automations Off'}
        </Badge>
      </div>

      <Card className="mb-4">
        <Card.Body>
          <h5>Automation Preferences</h5>
          <Row className="g-3">
            <Col md={4}>
              <Form.Check
                type="switch"
                id="pref-nightly-maintenance"
                label="Nightly AI maintenance"
                checked={prefs.nightlyMaintenanceEnabled}
                disabled={loadingPrefs}
                onChange={(e) => updatePreference({ nightlyMaintenanceEnabled: e.target.checked })}
              />
              <Form.Text className="text-muted">Disable to skip nightly prioritisation and clean-up.</Form.Text>
            </Col>
            <Col md={4}>
              <Form.Check
                type="switch"
                id="pref-daily-summary"
                label="Daily summary emails"
                checked={prefs.dailySummaryEnabled}
                disabled={loadingPrefs}
                onChange={(e) => updatePreference({ dailySummaryEnabled: e.target.checked })}
              />
              <Form.Text className="text-muted">Controls automatic daily recap delivery.</Form.Text>
            </Col>
            <Col md={4}>
              <Form.Check
                type="switch"
                id="pref-data-quality"
                label="Data quality reports"
                checked={prefs.dataQualityEmailEnabled}
                disabled={loadingPrefs}
                onChange={(e) => updatePreference({ dataQualityEmailEnabled: e.target.checked })}
              />
              <Form.Text className="text-muted">Sends health checks for tasks and goals.</Form.Text>
            </Col>
          </Row>
          <div className="mt-3">
            {loadingPrefs && <span className="text-muted small">Loading preferences…</span>}
            {prefsMessage && <span className="text-success small">{prefsMessage}</span>}
            {prefsError && <Alert variant="danger" className="mb-0 mt-2">{prefsError}</Alert>}
          </div>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <h5>Manual Runs & Diagnostics</h5>
          <div className="d-flex flex-wrap gap-2">
            <Button variant="primary" onClick={handleRunMaintenance} disabled={maintenanceRunning}>
              {maintenanceRunning ? 'Running…' : 'Run AI Reprioritisation Now'}
            </Button>
            {/* Email actions moved to Email settings */}
            <Button variant="outline-danger" onClick={handleNormalizeStatuses} disabled={normalizeRunning}>
              {normalizeRunning ? 'Normalizing…' : 'Normalize Story/Task Statuses'}
            </Button>
          </div>

          <div className="mt-3 d-flex flex-column gap-1">
            {maintenanceStatus && <span className="text-success small">{maintenanceStatus}</span>}
            {maintenanceError && <span className="text-danger small">{maintenanceError}</span>}
            {/* removed email statuses */}
            {normalizeStatus && <span className="text-success small">{normalizeStatus}</span>}
            {normalizeError && <span className="text-danger small">{normalizeError}</span>}
          </div>
        </Card.Body>
      </Card>
    </div>
  );
};

export default SettingsPlannerPage;
