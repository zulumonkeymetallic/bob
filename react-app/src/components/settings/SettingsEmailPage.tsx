import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Col, Form, Row } from 'react-bootstrap';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../../contexts/AuthContext';
import { functions } from '../../firebase';

const SettingsEmailPage: React.FC = () => {
  const { currentUser } = useAuth();
  const [emailFromAddress, setEmailFromAddress] = useState('');
  const [senderName, setSenderName] = useState('');
  const [emailConfigLoading, setEmailConfigLoading] = useState(false);
  const [emailConfigSaving, setEmailConfigSaving] = useState(false);
  const [emailConfigMessage, setEmailConfigMessage] = useState('');
  const [emailConfigError, setEmailConfigError] = useState('');

  const [dailySummaryStatus, setDailySummaryStatus] = useState('');
  const [dailySummaryError, setDailySummaryError] = useState('');
  const [dailySummaryRunning, setDailySummaryRunning] = useState(false);

  const [dataQualityStatus, setDataQualityStatus] = useState('');
  const [dataQualityError, setDataQualityError] = useState('');
  const [dataQualityRunning, setDataQualityRunning] = useState(false);

  const [testEmailStatus, setTestEmailStatus] = useState('');
  const [testEmailError, setTestEmailError] = useState('');
  const [testEmailRunning, setTestEmailRunning] = useState(false);

  useEffect(() => {
    const loadConfig = async () => {
      setEmailConfigLoading(true);
      setEmailConfigError('');
      try {
        const callable = httpsCallable(functions, 'getEmailSettings');
        const response: any = await callable({});
        const payload = response?.data ?? response;
        const data = payload?.settings || {};
        setEmailFromAddress(data?.from ?? '');
        setSenderName(data?.senderName ?? '');
      } catch (error: any) {
        console.error('[settings-email] failed to load config', error);
        setEmailConfigError(error?.message || 'Failed to load email configuration');
      } finally {
        setEmailConfigLoading(false);
      }
    };

    loadConfig();
  }, [currentUser]);

  useEffect(() => {
    if (!emailConfigMessage) return;
    const timer = setTimeout(() => setEmailConfigMessage(''), 3000);
    return () => clearTimeout(timer);
  }, [emailConfigMessage]);

  useEffect(() => {
    if (!emailConfigError) return;
    const timer = setTimeout(() => setEmailConfigError(''), 5000);
    return () => clearTimeout(timer);
  }, [emailConfigError]);

  useEffect(() => {
    if (!dailySummaryStatus) return;
    const timer = setTimeout(() => setDailySummaryStatus(''), 3000);
    return () => clearTimeout(timer);
  }, [dailySummaryStatus]);

  useEffect(() => {
    if (!dailySummaryError) return;
    const timer = setTimeout(() => setDailySummaryError(''), 5000);
    return () => clearTimeout(timer);
  }, [dailySummaryError]);

  useEffect(() => {
    if (!dataQualityStatus) return;
    const timer = setTimeout(() => setDataQualityStatus(''), 3000);
    return () => clearTimeout(timer);
  }, [dataQualityStatus]);

  useEffect(() => {
    if (!dataQualityError) return;
    const timer = setTimeout(() => setDataQualityError(''), 5000);
    return () => clearTimeout(timer);
  }, [dataQualityError]);

  useEffect(() => {
    if (!testEmailStatus) return;
    const timer = setTimeout(() => setTestEmailStatus(''), 3000);
    return () => clearTimeout(timer);
  }, [testEmailStatus]);

  useEffect(() => {
    if (!testEmailError) return;
    const timer = setTimeout(() => setTestEmailError(''), 5000);
    return () => clearTimeout(timer);
  }, [testEmailError]);

  const handleSaveEmailConfig = async () => {
    if (!currentUser) return;
    setEmailConfigSaving(true);
    setEmailConfigMessage('');
    setEmailConfigError('');
    try {
      const callable = httpsCallable(functions, 'saveEmailSettings');
      await callable({ from: emailFromAddress, senderName });
      setEmailConfigMessage('Email settings saved');
    } catch (error: any) {
      console.error('[settings-email] failed to save config', error);
      const msg = error?.message || 'Failed to save email configuration';
      setEmailConfigError(msg);
    } finally {
      setEmailConfigSaving(false);
    }
  };

  const handleSendDailySummary = async () => {
    if (!currentUser) return;
    setDailySummaryRunning(true);
    setDailySummaryStatus('');
    setDailySummaryError('');
    try {
      const callable = httpsCallable(functions, 'sendDailySummaryNow');
      await callable({});
      setDailySummaryStatus('Daily summary queued for delivery');
    } catch (error: any) {
      console.error('[settings-email] daily summary trigger failed', error);
      setDailySummaryError(error?.message || 'Failed to trigger daily summary');
    } finally {
      setDailySummaryRunning(false);
    }
  };

  const handleSendDataQuality = async () => {
    if (!currentUser) return;
    setDataQualityRunning(true);
    setDataQualityStatus('');
    setDataQualityError('');
    try {
      const callable = httpsCallable(functions, 'sendDataQualityNow');
      await callable({});
      setDataQualityStatus('Data quality report queued for delivery');
    } catch (error: any) {
      console.error('[settings-email] data quality trigger failed', error);
      setDataQualityError(error?.message || 'Failed to trigger data quality report');
    } finally {
      setDataQualityRunning(false);
    }
  };

  const handleSendTestEmail = async () => {
    if (!currentUser) return;
    setTestEmailRunning(true);
    setTestEmailStatus('');
    setTestEmailError('');
    try {
      const callable = httpsCallable(functions, 'sendTestEmail');
      const response: any = await callable({});
      const payload = response?.data ?? response;
      const messageId = payload?.messageId || payload?.result?.messageId || 'sent';
      setTestEmailStatus(`Test email sent (message ${messageId}).`);
    } catch (error: any) {
      console.error('[settings-email] test email failed', error);
      setTestEmailError(error?.message || 'Failed to send test email');
    } finally {
      setTestEmailRunning(false);
    }
  };

  const isConfigured = Boolean(emailFromAddress);

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-0">Email & Notifications</h2>
          <small className="text-muted">Manage sender and trigger email diagnostics.</small>
        </div>
        <Badge bg={isConfigured ? 'success' : 'secondary'}>
          {isConfigured ? 'Configured' : 'Not Configured'}
        </Badge>
      </div>

      {/* Sender configuration */}
      <Card className="mb-4">
        <Card.Body>
          <h5>Sender</h5>
          <Row className="g-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label>From Address</Form.Label>
                <Form.Control
                  value={emailFromAddress}
                  onChange={(e) => setEmailFromAddress(e.target.value)}
                  placeholder="noreply@example.com"
                  disabled={emailConfigLoading || emailConfigSaving}
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Sender Name (optional)</Form.Label>
                <Form.Control
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder="BOB Notifications"
                  disabled={emailConfigLoading || emailConfigSaving}
                />
              </Form.Group>
            </Col>
          </Row>
          <div className="d-flex flex-wrap gap-2 mt-3">
            <Button variant="primary" onClick={handleSaveEmailConfig} disabled={emailConfigLoading || emailConfigSaving}>
              {emailConfigSaving ? 'Saving…' : 'Save Sender'}
            </Button>
            <Button variant="outline-primary" onClick={handleSendTestEmail} disabled={testEmailRunning}>
              {testEmailRunning ? 'Sending…' : 'Send Test Email'}
            </Button>
          </div>
          <div className="mt-3">
            {emailConfigLoading && <span className="text-muted small">Loading sender…</span>}
            {emailConfigMessage && <div className="text-success small">{emailConfigMessage}</div>}
            {emailConfigError && <div className="text-danger small">{emailConfigError}</div>}
            {testEmailStatus && <div className="text-success small">{testEmailStatus}</div>}
            {testEmailError && <div className="text-danger small">{testEmailError}</div>}
          </div>
        </Card.Body>
      </Card>

      {/* Manual runs & diagnostics */}
      <Card>
        <Card.Body>
          <h5>Manual Runs & Diagnostics</h5>
          <div className="d-flex flex-wrap gap-2">
            <Button variant="outline-secondary" onClick={handleSendDailySummary} disabled={dailySummaryRunning}>
              {dailySummaryRunning ? 'Triggering…' : 'Send Daily Summary Now'}
            </Button>
            <Button variant="outline-secondary" onClick={handleSendDataQuality} disabled={dataQualityRunning}>
              {dataQualityRunning ? 'Triggering…' : 'Send Data Quality Now'}
            </Button>
          </div>
          <div className="mt-3">
            {dailySummaryStatus && <div className="text-success small">{dailySummaryStatus}</div>}
            {dailySummaryError && <div className="text-danger small">{dailySummaryError}</div>}
            {dataQualityStatus && <div className="text-success small">{dataQualityStatus}</div>}
            {dataQualityError && <div className="text-danger small">{dataQualityError}</div>}
          </div>
        </Card.Body>
      </Card>
    </div>
  );
};

export default SettingsEmailPage;
