import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Nav, Tab } from 'react-bootstrap';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import ChoiceManager from './ChoiceManager';

interface ThemeColors {
  Health: string;
  Growth: string;
  Wealth: string;
  Tribe: string;
  Home: string;
}

const SettingsPage: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const { currentUser } = useAuth();
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState(false);
  const [steamConnected, setSteamConnected] = useState(false);
  const [monzoConnected, setMonzoConnected] = useState(false);
  const [monzoAccounts, setMonzoAccounts] = useState<Array<{ id: string; description?: string }>>([]);
  const [monzoAccountId, setMonzoAccountId] = useState<string>('');
  const [notifications, setNotifications] = useState(true);
  const [autoSync, setAutoSync] = useState(false);
  
  // Theme colors from Firebase
  const [themeColors, setThemeColors] = useState<ThemeColors>({
    Health: '#e53e3e', // Red
    Growth: '#3182ce', // Blue  
    Wealth: '#38a169', // Green
    Tribe: '#805ad5', // Purple
    Home: '#d69e2e'   // Orange/Yellow
  });

  // Load settings from localStorage and Firebase
  useEffect(() => {
    const savedSettings = localStorage.getItem('bobSettings');
    if (savedSettings) {
      const settings = JSON.parse(savedSettings);
      setNotifications(settings.notifications ?? true);
      setAutoSync(settings.autoSync ?? false);
      setGoogleCalendarConnected(settings.googleCalendarConnected ?? false);
      setSteamConnected(settings.steamConnected ?? false);
      setMonzoConnected(settings.monzoConnected ?? false);
      setMonzoAccountId(settings.monzoAccountId ?? '');
    }

    // Load theme colors from Firebase
    if (currentUser) {
      const loadThemeColors = async () => {
        try {
          const docRef = doc(db, 'theme_colors', currentUser.uid);
          const docSnap = await getDoc(docRef);
          
          if (docSnap.exists()) {
            const colors = docSnap.data() as ThemeColors;
            setThemeColors(colors);
          }
        } catch (error) {
          console.error('Error loading theme colors:', error);
        }
      };
      
      loadThemeColors();
    }
  }, [currentUser]);

  const saveSettings = () => {
    const settings = {
      notifications,
      autoSync,
      googleCalendarConnected,
      steamConnected,
      monzoConnected,
      monzoAccountId
    };
    localStorage.setItem('bobSettings', JSON.stringify(settings));
  };

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    saveSettings();
  };

  const handleColorChange = async (themeName: keyof ThemeColors, color: string) => {
    const newColors = { ...themeColors, [themeName]: color };
    setThemeColors(newColors);
    
    // Save to Firebase
    if (currentUser) {
      try {
        const docRef = doc(db, 'theme_colors', currentUser.uid);
        await setDoc(docRef, {
          ...newColors,
          updatedAt: serverTimestamp(),
          ownerUid: currentUser.uid
        });
        console.log('Theme colors saved successfully');
      } catch (error) {
        console.error('Error saving theme colors:', error);
      }
    }
  };

  const handleGoogleCalendarConnect = async () => {
    console.log('Google Calendar OAuth flow will be implemented here');
    setGoogleCalendarConnected(!googleCalendarConnected);
    saveSettings();
  };

  const handleSteamConnect = async () => {
    try {
      // Minimal integration: trigger server-side sync if available
      const syncSteam = httpsCallable(functions, 'syncSteam');
      await syncSteam();
      setSteamConnected(true);
    } catch (e) {
      console.warn('Steam sync failed or not configured', (e as any)?.message);
      setSteamConnected(!steamConnected);
    } finally {
      saveSettings();
    }
  };

  const handleNotificationToggle = () => {
    setNotifications(!notifications);
    saveSettings();
  };

  const handleAutoSyncToggle = () => {
    setAutoSync(!autoSync);
    saveSettings();
  };

  // Monzo handlers
  const handleMonzoConnect = async () => {
    if (!currentUser) return;
    try {
      const nonce = Math.random().toString(36).slice(2);
      const url = `${window.location.origin}/api/monzo/start?uid=${currentUser.uid}&nonce=${nonce}`;
      const popup = window.open(url, 'monzo-oauth', 'width=500,height=700');
      const check = setInterval(() => {
        if (popup?.closed) { clearInterval(check); setMonzoConnected(true); saveSettings(); }
      }, 800);
    } catch (e) {
      console.warn('Monzo connect failed', (e as any)?.message);
    }
  };

  const handleMonzoListAccounts = async () => {
    try {
      const callable = httpsCallable(functions, 'monzoListAccounts');
      const res: any = await callable({});
      const accounts = (res?.data?.accounts || []).map((a: any) => ({ id: a.id, description: a.description || a.type }));
      setMonzoAccounts(accounts);
      if (!monzoAccountId && accounts[0]) { setMonzoAccountId(accounts[0].id); saveSettings(); }
    } catch (e) {
      console.warn('Monzo list accounts failed', (e as any)?.message);
    }
  };

  const handleMonzoSync = async () => {
    if (!monzoAccountId) { alert('Select a Monzo account first'); return; }
    try {
      const callable = httpsCallable(functions, 'monzoSyncTransactions');
      const res: any = await callable({ accountId: monzoAccountId });
      alert(`Synced ${res?.data?.count || 0} transactions`);
    } catch (e) {
      alert('Monzo sync failed: ' + ((e as any)?.message || 'unknown'));
    }
  };

  return (
    <Container fluid className="py-4">
      <h2 className="mb-4">Settings</h2>
      
      <Tab.Container defaultActiveKey="general">
        <Row>
          <Col sm={3}>
            <Nav variant="pills" className="flex-column">
              <Nav.Item>
                <Nav.Link eventKey="general">General</Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="themes">Theme & Colors</Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="choices">Choice Management</Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="integrations">Integrations</Nav.Link>
              </Nav.Item>
            </Nav>
          </Col>
          <Col sm={9}>
            <Tab.Content>
              
              {/* General Settings */}
              <Tab.Pane eventKey="general">
                <div className="card">
                  <div className="card-header">
                    <h4 className="mb-0">General Settings</h4>
                  </div>
                  <div className="card-body">
                    {/* Theme Settings */}
                    <div className="settings-section mb-4">
                      <h5 className="mb-3">Theme & Appearance</h5>
                      <div className="mb-3">
                        <label className="form-label">Light/Dark Mode</label>
                        <select 
                          className="form-select"
                          value={theme}
                          onChange={(e) => handleThemeChange(e.target.value as 'light' | 'dark' | 'system')}
                        >
                          <option value="light">Light Mode</option>
                          <option value="dark">Dark Mode</option>
                          <option value="system">System Preference</option>
                        </select>
                        <div className="form-text">
                          Choose your preferred light/dark mode setting
                        </div>
                      </div>
                    </div>

                    {/* Notification Settings */}
                    <div className="settings-section mb-4">
                      <h5 className="mb-3">Notifications</h5>
                      <div className="form-check form-switch mb-3">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="notifications"
                          checked={notifications}
                          onChange={handleNotificationToggle}
                        />
                        <label className="form-check-label" htmlFor="notifications">
                          Enable Notifications
                        </label>
                        <div className="form-text">
                          Receive browser notifications for important updates
                        </div>
                      </div>
                    </div>

                    {/* Auto Sync */}
                    <div className="settings-section mb-4">
                      <h5 className="mb-3">Data Synchronization</h5>
                      <div className="form-check form-switch mb-3">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="autoSync"
                          checked={autoSync}
                          onChange={handleAutoSyncToggle}
                        />
                        <label className="form-check-label" htmlFor="autoSync">
                          Auto Sync
                        </label>
                        <div className="form-text">
                          Automatically sync data across devices
                        </div>
                      </div>
                    </div>

                    {/* Profile Information */}
                    <div className="settings-section mb-4">
                      <h5 className="mb-3">Profile</h5>
                      <div className="mb-3">
                        <strong>Email:</strong> {currentUser?.email || 'Not signed in'}
                      </div>
                      <div className="mb-3">
                        <strong>User ID:</strong> <code>{currentUser?.uid || 'N/A'}</code>
                      </div>
                    </div>
                  </div>
                </div>
              </Tab.Pane>

              {/* Theme & Colors */}
              <Tab.Pane eventKey="themes">
                <div className="card">
                  <div className="card-header">
                    <h4 className="mb-0">Theme & Color Settings</h4>
                  </div>
                  <div className="card-body">
                    <div className="mb-3">
                      <label className="form-label">Color Themes</label>
                      <div className="row g-2">
                        {Object.entries(themeColors).map(([themeName, color]) => (
                          <div key={themeName} className="col-md-6">
                            <div className="d-flex align-items-center gap-2">
                              <label htmlFor={`color-${themeName}`} className="form-label mb-0">{themeName}</label>
                              <input
                                type="color"
                                className="form-control form-control-color"
                                id={`color-${themeName}`}
                                value={color}
                                onChange={(e) => handleColorChange(themeName as keyof ThemeColors, e.target.value)}
                                title={`Choose ${themeName} color`}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="form-text">
                        Customize colors for your goal themes
                      </div>
                    </div>
                  </div>
                </div>
              </Tab.Pane>

              {/* Choice Management */}
              <Tab.Pane eventKey="choices">
                <ChoiceManager />
              </Tab.Pane>

              {/* Integrations */}
              <Tab.Pane eventKey="integrations">
                <div className="card">
                  <div className="card-header">
                    <h4 className="mb-0">External Integrations</h4>
                  </div>
                  <div className="card-body">
                    {/* Monzo */}
                    <div className="d-flex justify-content-between align-items-center mb-3 p-3 border rounded">
                      <div>
                        <h6 className="mb-1">Monzo Bank</h6>
                        <small className="text-muted">Connect and import transactions for budgeting</small>
                        {monzoConnected && (
                          <div>
                            <span className="badge bg-success mt-1">Connected</span>
                          </div>
                        )}
                      </div>
                      <div className="d-flex flex-column align-items-end gap-2">
                        <button className={`btn ${monzoConnected ? 'btn-outline-danger' : 'btn-outline-primary'}`} onClick={handleMonzoConnect}>
                          {monzoConnected ? 'Reconnect' : 'Connect'}
                        </button>
                        {monzoConnected && (
                          <div className="d-flex gap-2 align-items-center">
                            <select className="form-select form-select-sm" value={monzoAccountId} onChange={(e) => { setMonzoAccountId(e.target.value); saveSettings(); }} style={{ minWidth: 220 }}>
                              <option value="">Select account…</option>
                              {monzoAccounts.map(a => (<option key={a.id} value={a.id}>{a.description || a.id}</option>))}
                            </select>
                            <button className="btn btn-outline-secondary btn-sm" onClick={handleMonzoListAccounts}>List Accounts</button>
                            <button className="btn btn-outline-success btn-sm" onClick={handleMonzoSync}>Sync Now</button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Google Calendar */}
                    <div className="d-flex justify-content-between align-items-center mb-3 p-3 border rounded">
                      <div>
                        <h6 className="mb-1">Google Calendar</h6>
                        <small className="text-muted">
                          Sync your tasks and deadlines with Google Calendar
                        </small>
                        {googleCalendarConnected && (
                          <div>
                            <span className="badge bg-success mt-1">Connected</span>
                          </div>
                        )}
                      </div>
                      <button
                        className={`btn ${googleCalendarConnected ? 'btn-outline-danger' : 'btn-outline-primary'}`}
                        onClick={handleGoogleCalendarConnect}
                      >
                        {googleCalendarConnected ? 'Disconnect' : 'Connect'}
                      </button>
                    </div>

                    {/* Steam Library */}
                    <div className="d-flex justify-content-between align-items-center mb-3 p-3 border rounded">
                      <div>
                        <h6 className="mb-1">Steam Library</h6>
                        <small className="text-muted">
                          Import games from your Steam library to personal backlog
                        </small>
                        {steamConnected && (
                          <div>
                            <span className="badge bg-success mt-1">Connected</span>
                          </div>
                        )}
                      </div>
                      <button
                        className={`btn ${steamConnected ? 'btn-outline-danger' : 'btn-outline-primary'}`}
                        onClick={handleSteamConnect}
                      >
                        {steamConnected ? 'Disconnect' : 'Connect'}
                      </button>
                    </div>
                  </div>
                </div>
              </Tab.Pane>

            </Tab.Content>
          </Col>
        </Row>
      </Tab.Container>
    </Container>
  );
};

export default SettingsPage;
