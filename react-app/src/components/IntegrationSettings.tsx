import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Button, Card, Col, Collapse, Form, ListGroup, Row, Spinner, Table } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { db, functions, firebaseConfig } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { collection, doc, onSnapshot, query, limit, where, updateDoc } from 'firebase/firestore';
import CalendarSyncManager from './CalendarSyncManager';
import { formatDistanceToNow } from 'date-fns';

interface ProfileData {
  googleCalendarLastSyncAt?: any;
  googleCalendarEventCount?: number;
  monzoConnected?: boolean;
  monzoLastSyncAt?: any;
  stravaConnected?: boolean;
  stravaLastSyncAt?: any;
  stravaAutoSync?: boolean;
  autoEnrichStravaHR?: boolean;
  traktUser?: string;
  traktLastSyncAt?: any;
  steamId?: string;
  steamLastSyncAt?: any;
}

interface MonzoTransactionPreview {
  transactionId: string;
  description: string;
  amount: number;
  createdISO: string | null;
  categoryType?: string | null;
}

const defaultTotals = { mandatory: 0, optional: 0, savings: 0, income: 0 };

const formatCurrency = (value: number | undefined | null) => {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  return amount.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
};

const formatTimestamp = (value: any) => {
  if (!value) return '—';
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

const relativeTime = (value: any) => {
  if (!value) return 'never';
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'never';
  return formatDistanceToNow(date, { addSuffix: true });
};

type IntegrationSection = 'google' | 'monzo' | 'strava' | 'steam' | 'trakt' | 'hardcover' | 'all';

interface IntegrationSettingsProps {
  section?: IntegrationSection;
}

const IntegrationSettings: React.FC<IntegrationSettingsProps> = ({ section = 'all' }) => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileData | null>(null);

  const [googleConnected, setGoogleConnected] = useState<boolean>(false);
  const [googleEvents, setGoogleEvents] = useState<any[]>([]);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showCalendarManager, setShowCalendarManager] = useState(false);

  const [monzoTotals, setMonzoTotals] = useState<typeof defaultTotals>(defaultTotals);
  const [monzoTransactions, setMonzoTransactions] = useState<MonzoTransactionPreview[]>([]);
  const [monzoMessage, setMonzoMessage] = useState<string | null>(null);
  const [monzoLoading, setMonzoLoading] = useState(false);
  const [monzoWebhookAccountId, setMonzoWebhookAccountId] = useState('');

  const [stravaActivities, setStravaActivities] = useState<any[]>([]);
  const [stravaMessage, setStravaMessage] = useState<string | null>(null);
  const [stravaLoading, setStravaLoading] = useState(false);

  const [steamGames, setSteamGames] = useState<any[]>([]);
  const [steamMessage, setSteamMessage] = useState<string | null>(null);
  const [steamLoading, setSteamLoading] = useState(false);
  const [steamIdInput, setSteamIdInput] = useState('');

  const [traktHistory, setTraktHistory] = useState<any[]>([]);
  const [traktMessage, setTraktMessage] = useState<string | null>(null);
  const [traktLoading, setTraktLoading] = useState(false);
  const [traktUserInput, setTraktUserInput] = useState('');

  // Hardcover
  const [hardcoverBooks, setHardcoverBooks] = useState<any[]>([]);
  const [hardcoverMessage, setHardcoverMessage] = useState<string | null>(null);
  const [hardcoverLoading, setHardcoverLoading] = useState(false);
  const [hardcoverTokenInput, setHardcoverTokenInput] = useState('');
  const popupTimersRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      popupTimersRef.current.forEach((id) => clearInterval(id));
      popupTimersRef.current = [];
    };
  }, []);

  const trackPopupTimer = (timerId: number) => {
    popupTimersRef.current.push(timerId);
  };

  const clearPopupTimer = (timerId: number) => {
    clearInterval(timerId);
    popupTimersRef.current = popupTimersRef.current.filter((id) => id !== timerId);
  };


  useEffect(() => {
    if (!currentUser) return;
    const unsub = onSnapshot(doc(db, 'profiles', currentUser.uid), (snap) => {
      const data = snap.data() as ProfileData | undefined;
      setProfile(data || null);
      if (data?.steamId) setSteamIdInput(data.steamId);
      if (data?.traktUser) setTraktUserInput(data.traktUser);
      if ((data as any)?.hardcoverToken) setHardcoverTokenInput((data as any).hardcoverToken);
    });
    return () => unsub();
  }, [currentUser]);

  // Derived flags
  const stravaConnected = !!profile?.stravaConnected;
  const monzoConnected = !!profile?.monzoConnected;
  const monzoLastSync = profile?.monzoLastSyncAt;
  const steamLastSync = profile?.steamLastSyncAt;
  const traktLastSync = profile?.traktLastSyncAt;
  const googleLastSync = profile?.googleCalendarLastSyncAt;
  const stravaLastSync = profile?.stravaLastSyncAt;
  const hardcoverLastSync = (profile as any)?.hardcoverLastSyncAt;

  useEffect(() => {
    if (!currentUser) return;

    const unsubscribeSummary = onSnapshot(doc(db, 'monzo_budget_summary', currentUser.uid), (snap) => {
      const data = snap.data() as any;
      if (data?.totals) setMonzoTotals(data.totals);
      if (Array.isArray(data?.categories)) {
        // No action – categories handled in Finance hub; keep totals only here.
      }
    });

    const txQuery = query(
      collection(db, 'monzo_transactions'),
      where('ownerUid', '==', currentUser.uid),
      limit(10)
    );
    const unsubscribeTx = onSnapshot(txQuery, (snap) => {
      const rows = snap.docs.map((docSnap) => {
        const data = docSnap.data() as any;
        return {
          transactionId: data.transactionId,
          description: data.description || data.defaultCategoryLabel || 'Transaction',
          amount: Number(data.amount ?? (data.amountMinor || 0) / 100),
          createdISO: data.createdISO || null,
          categoryType: data.userCategoryType || data.defaultCategoryType || 'optional',
        };
      });
      rows.sort((a, b) => {
        const aTime = a.createdISO ? new Date(a.createdISO).getTime() : 0;
        const bTime = b.createdISO ? new Date(b.createdISO).getTime() : 0;
        return bTime - aTime;
      });
      setMonzoTransactions(rows.slice(0, 5));
    });

    const stravaQuery = query(
      collection(db, 'metrics_workouts'),
      where('ownerUid', '==', currentUser.uid),
      limit(5)
    );
    const unsubscribeStrava = onSnapshot(stravaQuery, (snap) => {
      const rows = snap.docs.map((docSnap) => docSnap.data());
      rows.sort((a, b) => (b.startDate || 0) - (a.startDate || 0));
      setStravaActivities(rows.slice(0, 5));
    });

    const steamQuery = query(
      collection(db, 'steam'),
      where('ownerUid', '==', currentUser.uid),
      limit(5)
    );
    const unsubscribeSteam = onSnapshot(steamQuery, (snap) => {
      const rows = snap.docs.map((docSnap) => docSnap.data());
      rows.sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0));
      setSteamGames(rows.slice(0, 5));
    });

    const traktQuery = query(
      collection(db, 'trakt'),
      where('ownerUid', '==', currentUser.uid),
      limit(5)
    );
    const unsubscribeTrakt = onSnapshot(traktQuery, (snap) => {
      const rows = snap.docs.map((docSnap) => docSnap.data());
      rows.sort((a, b) => {
        const aDate = a.watched_at ? new Date(a.watched_at).getTime() : 0;
        const bDate = b.watched_at ? new Date(b.watched_at).getTime() : 0;
        return bDate - aDate;
      });
      setTraktHistory(rows.slice(0, 5));
    });

    const hardcoverQuery = query(
      collection(db, 'hardcover'),
      where('ownerUid', '==', currentUser.uid),
      limit(5)
    );
    const unsubscribeHardcover = onSnapshot(hardcoverQuery, (snap) => {
      const rows = snap.docs.map((docSnap) => docSnap.data());
      rows.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
      setHardcoverBooks(rows.slice(0, 5));
    });

    return () => {
      unsubscribeSummary();
      unsubscribeTx();
      unsubscribeStrava();
      unsubscribeSteam();
      unsubscribeTrakt();
      unsubscribeHardcover();
    };
  }, [currentUser]);

  useEffect(() => {
    const loadStatus = async () => {
      if (!currentUser) return;
      try {
        const calendarStatus = httpsCallable(functions, 'calendarStatus');
        const res = await calendarStatus({});
        const data = res.data as any;
        setGoogleConnected(!!data?.connected);
      } catch (err) {
        console.error('calendarStatus failed', err);
        setGoogleConnected(false);
      }
    };
    loadStatus();
  }, [currentUser]);

  const connectGoogle = () => {
    if (!profile || !currentUser) return;
    const nonce = Math.random().toString(36).slice(2);
    const region = 'europe-west2';
    const projectId = firebaseConfig.projectId;
    const url = `https://${region}-${projectId}.cloudfunctions.net/oauthStart?uid=${currentUser.uid}&nonce=${nonce}`;
    const popup = window.open(url, 'google-oauth', 'width=500,height=600');
    if (popup) {
      const timer = window.setInterval(() => {
        if (popup.closed) {
          clearPopupTimer(timer);
        }
      }, 800);
      trackPopupTimer(timer);
    }
  };

  const testGoogle = async () => {
    if (!currentUser) return;
    setGoogleLoading(true);
    try {
      const fn = httpsCallable(functions, 'listUpcomingEvents');
      const res = await fn({ maxResults: 5 });
      const data = (res.data as any)?.items || [];
      setGoogleEvents(data);
    } catch (err: any) {
      console.error('Google test failed', err);
      setGoogleEvents([]);
    } finally {
      setGoogleLoading(false);
    }
  };

  const connectMonzo = () => {
    if (!currentUser) return;
    const nonce = Math.random().toString(36).slice(2);
    const url = `${window.location.origin}/api/monzo/start?uid=${currentUser.uid}&nonce=${nonce}`;
    const popup = window.open(url, 'monzo-oauth', 'width=480,height=720');
    if (popup) {
      const timer = window.setInterval(() => {
        if (popup.closed) {
          clearPopupTimer(timer);
        }
      }, 800);
      trackPopupTimer(timer);
    }
  };

  const syncMonzo = async () => {
    if (!currentUser) return;
    setMonzoLoading(true);
    setMonzoMessage(null);
    try {
      const fn = httpsCallable(functions, 'syncMonzo');
      const res = await fn({});
      const data = res.data as any;
      setMonzoMessage(`Synced accounts: ${data.accounts || 0}, transactions: ${data.transactions || 0}`);
    } catch (err: any) {
      console.error('syncMonzo failed', err);
      setMonzoMessage(err?.message || 'Monzo sync failed');
    } finally {
      setMonzoLoading(false);
    }
  };

  const revokeMonzo = async () => {
    if (!currentUser) return;
    setMonzoLoading(true);
    setMonzoMessage(null);
    try {
      const fn = httpsCallable(functions, 'revokeMonzoAccess');
      await fn({});
      setMonzoMessage('Monzo access revoked.');
    } catch (err:any) {
      setMonzoMessage(err?.message || 'Failed to revoke access');
    } finally {
      setMonzoLoading(false);
    }
  };

  const deleteFinance = async () => {
    if (!currentUser) return;
    // eslint-disable-next-line no-restricted-globals
    if (!confirm('This will delete your synced finance data (accounts, pots, transactions, analytics). Proceed?')) return;
    setMonzoLoading(true);
    setMonzoMessage(null);
    try {
      const fn = httpsCallable(functions, 'deleteFinanceData');
      await fn({});
      setMonzoMessage('Finance data deleted.');
    } catch (err:any) {
      setMonzoMessage(err?.message || 'Failed to delete finance data');
    } finally {
      setMonzoLoading(false);
    }
  };

  const exportFinance = async () => {
    if (!currentUser) return;
    setMonzoLoading(true);
    setMonzoMessage(null);
    try {
      const fn = httpsCallable(functions, 'exportFinanceData');
      const res:any = await fn({});
      const data = res?.data?.data || {};
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'finance-export.json'; a.click(); URL.revokeObjectURL(url);
      setMonzoMessage('Export generated.');
    } catch (err:any) {
      setMonzoMessage(err?.message || 'Export failed');
    } finally {
      setMonzoLoading(false);
    }
  };

  const connectStrava = () => {
    if (!currentUser) return;
    const nonce = Math.random().toString(36).slice(2);
    const region = 'europe-west2';
    const projectId = firebaseConfig.projectId;
    const url = `https://${region}-${projectId}.cloudfunctions.net/stravaOAuthStart?uid=${currentUser.uid}&nonce=${nonce}`;
    const popup = window.open(url, 'strava-oauth', 'width=480,height=720');
    if (popup) {
      const timer = window.setInterval(() => {
        if (popup.closed) {
          clearPopupTimer(timer);
        }
      }, 800);
      trackPopupTimer(timer);
    }
  };

  const syncStrava = async () => {
    if (!currentUser) return;
    setStravaLoading(true);
    setStravaMessage(null);
    try {
      const fn = httpsCallable(functions, 'syncStrava');
      const res = await fn({});
      const data = res.data as any;
      setStravaMessage(`Imported ${data?.imported || 0} activities`);
    } catch (err: any) {
      console.error('syncStrava failed', err);
      setStravaMessage(err?.message || 'Strava sync failed');
    } finally {
      setStravaLoading(false);
    }
  };

  const syncSteam = async () => {
    if (!currentUser) return;
    setSteamLoading(true);
    setSteamMessage(null);
    try {
      const fn = httpsCallable(functions, 'syncSteam');
      const res = await fn({});
      const data = res.data as any;
      setSteamMessage(`Library updated (${data?.written || 0} games)`);
    } catch (err: any) {
      console.error('syncSteam failed', err);
      setSteamMessage(err?.message || 'Steam sync failed');
    } finally {
      setSteamLoading(false);
    }
  };

  const syncTrakt = async () => {
    if (!currentUser) return;
    setTraktLoading(true);
    setTraktMessage(null);
    try {
      const fn = httpsCallable(functions, 'syncTrakt');
      const res = await fn({});
      const data = res.data as any;
      setTraktMessage(`Imported ${data?.written || 0} history entries`);
    } catch (err: any) {
      console.error('syncTrakt failed', err);
      setTraktMessage(err?.message || 'Trakt sync failed');
    } finally {
      setTraktLoading(false);
    }
  };

  const syncHardcover = async () => {
    if (!currentUser) return;
    setHardcoverLoading(true);
    setHardcoverMessage(null);
    try {
      const fn = httpsCallable(functions, 'syncHardcover');
      const res:any = await fn({});
      const data = res?.data || res;
      setHardcoverMessage(`Imported ${data?.written || 0} books`);
    } catch (err:any) {
      console.error('syncHardcover failed', err);
      setHardcoverMessage(err?.message || 'Hardcover sync failed');
    } finally {
      setHardcoverLoading(false);
    }
  };

  const updateProfile = async (patch: Record<string, any>) => {
    if (!currentUser) return;
    await updateDoc(doc(db, 'profiles', currentUser.uid), patch);
  };


  const show = (name: IntegrationSection) => section === 'all' || section === name;

  return (
    <div className="d-flex flex-column gap-4">
      <div className="d-flex justify-content-between align-items-center">
        <div>
          <h3 className="mb-0">Integrations</h3>
          <small className="text-muted">Connect services and view sync status</small>
        </div>
        <div>
          <Button variant="outline-secondary" size="sm" onClick={() => navigate('/logs/integrations')}>
            <i className="fas fa-stream me-2"></i>
            Integration Logs
          </Button>
        </div>
      </div>
      {show('google') && (
      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <div>
            <h4 className="mb-0">Google Calendar</h4>
            <small>Auto-import hourly + manual sync</small>
          </div>
          <Badge bg={googleConnected ? 'success' : 'secondary'}>
            {googleConnected ? 'Connected' : 'Not Connected'}
          </Badge>
        </Card.Header>
        <Card.Body>
          <Row className="mb-3">
            <Col md={6}>
              <div><strong>Last sync:</strong> {formatTimestamp(googleLastSync)} ({relativeTime(googleLastSync)})</div>
              <div><strong>Stored events:</strong> {profile?.googleCalendarEventCount ?? 0}</div>
            </Col>
            <Col md={6} className="text-md-end mt-3 mt-md-0">
              <Button variant="outline-primary" className="me-2" onClick={connectGoogle}>
                {googleConnected ? 'Reconnect' : 'Connect'}
              </Button>
              <Button variant="primary" onClick={testGoogle} disabled={googleLoading}>
                {googleLoading ? <Spinner size="sm" animation="border" className="me-2" /> : null}
                Fetch Upcoming Events
              </Button>
            </Col>
          </Row>

          {googleEvents.length > 0 && (
            <Table size="sm" responsive className="mb-3">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {googleEvents.map((ev) => (
                  <tr key={ev.id}>
                    <td>{ev.start?.dateTime || ev.start?.date || '—'}</td>
                    <td>{ev.summary || 'Untitled'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          <Button variant="link" onClick={() => setShowCalendarManager((v) => !v)}>
            {showCalendarManager ? 'Hide advanced options' : 'Show advanced options'}
          </Button>
          <Collapse in={showCalendarManager}>
            <div className="mt-3">
              <CalendarSyncManager />
            </div>
          </Collapse>
        </Card.Body>
      </Card>
      )}

      {show('hardcover') && (
      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <div>
            <h4 className="mb-0">Hardcover</h4>
            <small>Two-way sync using personal API token</small>
          </div>
          <Badge bg={(profile as any)?.hardcoverToken ? 'success' : 'secondary'}>
            {(profile as any)?.hardcoverToken ? 'Configured' : 'Not Configured'}
          </Badge>
        </Card.Header>
        <Card.Body>
          <Row className="mb-3">
            <Col md={6}>
              <Form.Label>API Token</Form.Label>
              <Form.Control type="password" value={hardcoverTokenInput} onChange={(e)=>setHardcoverTokenInput(e.target.value)} placeholder="Paste Hardcover API token" />
              <Button className="mt-2" variant="outline-secondary" size="sm" onClick={() => updateProfile({ hardcoverToken: hardcoverTokenInput || null })}>Save Token</Button>
            </Col>
            <Col md={6} className="text-md-end mt-3 mt-md-0">
              <div><strong>Last sync:</strong> {formatTimestamp(hardcoverLastSync)} ({relativeTime(hardcoverLastSync)})</div>
              <Button variant="primary" className="mt-2" onClick={syncHardcover} disabled={hardcoverLoading}>
                {hardcoverLoading ? <Spinner size="sm" animation="border" className="me-2" /> : null}
                Sync Now
              </Button>
            </Col>
          </Row>

          {hardcoverMessage && <Alert variant="info">{hardcoverMessage}</Alert>}

          <h6>Recent Books</h6>
          {hardcoverBooks.length === 0 ? (
            <Alert variant="light">No books synced yet.</Alert>
          ) : (
            <Table size="sm" responsive>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {hardcoverBooks.map((b: any) => (
                  <tr key={b.hardcoverId}>
                    <td>{b.title}</td>
                    <td>{b.status || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
      )}

      {show('monzo') && (
      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <div>
            <h4 className="mb-0">Monzo</h4>
            <small>Auto-refresh nightly + manual sync</small>
          </div>
          <Badge bg={monzoConnected ? 'success' : 'secondary'}>
            {monzoConnected ? 'Connected' : 'Not Connected'}
          </Badge>
        </Card.Header>
        <Card.Body>
          <Row className="mb-3">
            <Col md={6}>
              <div><strong>Last sync:</strong> {formatTimestamp(monzoLastSync)} ({relativeTime(monzoLastSync)})</div>
              <div><strong>Mandatory spend:</strong> {formatCurrency(monzoTotals.mandatory)}</div>
              <div><strong>Savings transfers:</strong> {formatCurrency(monzoTotals.savings)}</div>
            </Col>
            <Col md={6} className="text-md-end mt-3 mt-md-0">
              <Button variant="outline-primary" className="me-2" onClick={connectMonzo}>
                {monzoConnected ? 'Reconnect' : 'Connect'}
              </Button>
              <Button variant="primary" onClick={syncMonzo} disabled={monzoLoading}>
                {monzoLoading ? <Spinner size="sm" animation="border" className="me-2" /> : null}
                Sync Now
              </Button>
            </Col>
          </Row>

          {monzoMessage && <Alert variant="info">{monzoMessage}</Alert>}

          <h6>Recent Transactions</h6>
          {monzoTransactions.length === 0 ? (
            <Alert variant="light">No transactions synced yet.</Alert>
          ) : (
            <Table size="sm" responsive>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th className="text-end">Amount</th>
                </tr>
              </thead>
              <tbody>
                {monzoTransactions.map((tx) => (
                  <tr key={tx.transactionId}>
                    <td>{tx.createdISO ? new Date(tx.createdISO).toLocaleDateString() : '—'}</td>
                    <td>{tx.description}</td>
                    <td><Badge bg="light" text="dark">{tx.categoryType}</Badge></td>
                    <td className="text-end">{formatCurrency(Math.abs(tx.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          <hr />
          <h6>Advanced Actions</h6>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <Form.Control
              size="sm"
              placeholder="Account ID for webhook"
              value={monzoWebhookAccountId}
              onChange={(e)=>setMonzoWebhookAccountId(e.target.value)}
              style={{ maxWidth: 280 }}
            />
            <Button variant="outline-secondary" size="sm" onClick={async ()=>{
              setMonzoLoading(true); setMonzoMessage(null);
              try { const fn = httpsCallable(functions, 'monzoRegisterWebhook'); const target = `${window.location.origin}/api/monzo/webhook`; await fn({ accountId: monzoWebhookAccountId.trim(), url: target }); setMonzoMessage('Webhook registered.'); } catch (e:any) { setMonzoMessage(e?.message || 'Webhook registration failed'); } finally { setMonzoLoading(false); }
            }} disabled={monzoLoading}>Register Webhook</Button>
            <Button variant="outline-warning" size="sm" onClick={revokeMonzo} disabled={monzoLoading}>Revoke Access</Button>
            <Button variant="outline-danger" size="sm" onClick={deleteFinance} disabled={monzoLoading}>Delete Finance Data</Button>
            <Button variant="outline-success" size="sm" onClick={exportFinance} disabled={monzoLoading}>Export JSON</Button>
          </div>
        </Card.Body>
      </Card>
      )}

      {show('strava') && (
      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <div>
            <h4 className="mb-0">Strava</h4>
            <small>Auto-refresh daily when auto-sync is enabled</small>
          </div>
          <Badge bg={stravaConnected ? 'success' : 'secondary'}>
            {stravaConnected ? 'Connected' : 'Not Connected'}
          </Badge>
        </Card.Header>
        <Card.Body>
          <Row className="mb-3">
            <Col md={6}>
              <div><strong>Last sync:</strong> {formatTimestamp(stravaLastSync)} ({relativeTime(stravaLastSync)})</div>
              <Form.Check
                type="switch"
                id="strava-auto-sync"
                label="Enable daily auto-sync"
                checked={!!profile?.stravaAutoSync}
                onChange={(e) => updateProfile({ stravaAutoSync: e.target.checked })}
              />
            </Col>
            <Col md={6} className="text-md-end mt-3 mt-md-0">
              <Button variant="outline-primary" className="me-2" onClick={connectStrava}>
                {stravaConnected ? 'Reconnect' : 'Connect'}
              </Button>
              <Button variant="primary" onClick={syncStrava} disabled={stravaLoading}>
                {stravaLoading ? <Spinner size="sm" animation="border" className="me-2" /> : null}
                Sync Now
              </Button>
            </Col>
          </Row>

          {stravaMessage && <Alert variant="info">{stravaMessage}</Alert>}

          <h6>Recent Activities</h6>
          {stravaActivities.length === 0 ? (
            <Alert variant="light">No Strava activities synced yet.</Alert>
          ) : (
            <Table size="sm" responsive>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Name</th>
                  <th>Distance (km)</th>
                  <th>Avg HR</th>
                </tr>
              </thead>
              <tbody>
                {stravaActivities.map((act: any) => (
                  <tr key={act.id || act.stravaActivityId}>
                    <td>{act.utcStartDate ? new Date(act.utcStartDate).toLocaleDateString() : '—'}</td>
                    <td>{act.name || 'Activity'}</td>
                    <td>{act.distance_m ? (act.distance_m / 1000).toFixed(2) : '—'}</td>
                    <td>{act.avgHeartrate || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
      )}

      {show('steam') && (
      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <div>
            <h4 className="mb-0">Steam</h4>
            <small>Auto-refresh daily when SteamID is set</small>
          </div>
          <Badge bg={profile?.steamId ? 'success' : 'secondary'}>
            {profile?.steamId ? 'Configured' : 'Not Configured'}
          </Badge>
        </Card.Header>
        <Card.Body>
          <Row className="mb-3">
            <Col md={6}>
              <Form.Label>SteamID</Form.Label>
              <Form.Control
                value={steamIdInput}
                onChange={(e) => setSteamIdInput(e.target.value)}
                placeholder="Enter your SteamID64"
              />
              <Button
                className="mt-2"
                variant="outline-secondary"
                size="sm"
                onClick={() => updateProfile({ steamId: steamIdInput || null })}
              >
                Save SteamID
              </Button>
            </Col>
            <Col md={6} className="text-md-end mt-3 mt-md-0">
              <div><strong>Last sync:</strong> {formatTimestamp(steamLastSync)} ({relativeTime(steamLastSync)})</div>
              <Button variant="primary" className="mt-2" onClick={syncSteam} disabled={steamLoading || !steamIdInput}>
                {steamLoading ? <Spinner size="sm" animation="border" className="me-2" /> : null}
                Sync Now
              </Button>
            </Col>
          </Row>

          {steamMessage && <Alert variant="info">{steamMessage}</Alert>}

          <h6>Top Games</h6>
          {steamGames.length === 0 ? (
            <Alert variant="light">No games synced yet.</Alert>
          ) : (
            <Table size="sm" responsive>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Playtime (hrs)</th>
                </tr>
              </thead>
              <tbody>
                {steamGames.map((game: any) => (
                  <tr key={game.appid}>
                    <td>{game.name || `App ${game.appid}`}</td>
                    <td>{game.playtime_forever ? (game.playtime_forever / 60).toFixed(1) : '0'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
      )}

      {show('trakt') && (
      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <div>
            <h4 className="mb-0">Trakt</h4>
            <small>Auto-refresh daily when username is set</small>
          </div>
          <Badge bg={profile?.traktUser ? 'success' : 'secondary'}>
            {profile?.traktUser ? 'Configured' : 'Not Configured'}
          </Badge>
        </Card.Header>
        <Card.Body>
          <Row className="mb-3">
            <Col md={6}>
              <Form.Label>Trakt Username</Form.Label>
              <Form.Control
                value={traktUserInput}
                onChange={(e) => setTraktUserInput(e.target.value)}
                placeholder="Enter your trakt.tv username"
              />
              <Button
                className="mt-2"
                variant="outline-secondary"
                size="sm"
                onClick={() => updateProfile({ traktUser: traktUserInput || null })}
              >
                Save Username
              </Button>
            </Col>
            <Col md={6} className="text-md-end mt-3 mt-md-0">
              <div><strong>Last sync:</strong> {formatTimestamp(traktLastSync)} ({relativeTime(traktLastSync)})</div>
              <Button variant="primary" className="mt-2" onClick={syncTrakt} disabled={traktLoading || !traktUserInput}>
                {traktLoading ? <Spinner size="sm" animation="border" className="me-2" /> : null}
                Sync Now
              </Button>
            </Col>
          </Row>

          {traktMessage && <Alert variant="info">{traktMessage}</Alert>}

          <h6>Recent History</h6>
          {traktHistory.length === 0 ? (
            <Alert variant="light">No Trakt history synced yet.</Alert>
          ) : (
            <ListGroup>
              {traktHistory.map((entry: any) => (
                <ListGroup.Item key={entry.id || entry.watched_at}>
                  <div className="d-flex justify-content-between">
                    <div>
                      <div className="fw-semibold">{entry?.show?.title || entry?.movie?.title || 'Item'}</div>
                      <small className="text-muted">{entry?.type || 'episode'} · {entry?.show?.year || entry?.movie?.year || ''}</small>
                    </div>
                    <div>{entry.watched_at ? new Date(entry.watched_at).toLocaleString() : '—'}</div>
                  </div>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
        </Card.Body>
      </Card>
      )}
    </div>
  );
};

export default IntegrationSettings;
