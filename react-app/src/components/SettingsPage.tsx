import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Form, Modal, Alert, Nav, Tab, Badge } from 'react-bootstrap';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, setDoc, serverTimestamp, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useThemeAwareColors, getContrastTextColor } from '../hooks/useThemeAwareColors';
import { GLOBAL_THEMES, GlobalTheme } from '../constants/globalThemes';
import { Settings, Palette, Database, Wand2, KeyRound, Clipboard, FileCode, Plug } from 'lucide-react';
import AIStoryKPISettings from './AIStoryKPISettings';
import { useThemeDebugger } from '../utils/themeDebugger';
import IntegrationSettings from './IntegrationSettings';
import BudgetSettings from './finance/BudgetSettings';
import { useLocation, useNavigate } from 'react-router-dom';

const SETTINGS_TABS = ['themes', 'database', 'integrations', 'reminders', 'ai', 'system'] as const;
type SettingsTab = typeof SETTINGS_TABS[number];
const DEFAULT_TAB: SettingsTab = 'themes';

const normalizeTab = (value: string | null): SettingsTab => {
  if (value && SETTINGS_TABS.includes(value as SettingsTab)) {
    return value as SettingsTab;
  }
  return DEFAULT_TAB;
};
 

interface GlobalThemeSettings {
  themes: GlobalTheme[];
  customizations: Record<string, any>;
  lastUpdated: any;
}

const SettingsPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { isDark, colors, backgrounds } = useThemeAwareColors();
  const { logThemeInfo, scanPageForInconsistencies, createClickHandler } = useThemeDebugger('SettingsPage');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [migrateSuccess, setMigrateSuccess] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState(0);

  // Global theme management state
  const [globalThemes, setGlobalThemes] = useState<GlobalTheme[]>(GLOBAL_THEMES);
  const [editingTheme, setEditingTheme] = useState<GlobalTheme | null>(null);
  const [showThemeModal, setShowThemeModal] = useState(false);

  // Migration state
  const [migrationStats, setMigrationStats] = useState({
    goals: 0,
    stories: 0, 
    tasks: 0,
    needsMigration: false
  });

  // Fitness & Integrations
  const [parkrunAthleteId, setParkrunAthleteId] = useState('');
  const [parkrunAutoSync, setParkrunAutoSync] = useState(false);
  const [stravaAutoSync, setStravaAutoSync] = useState(false);
  const [parkrunDefaultEventSlug, setParkrunDefaultEventSlug] = useState('');
  const [parkrunDefaultStartRun, setParkrunDefaultStartRun] = useState<string>('');
  const [parkrunAutoComputePercentiles, setParkrunAutoComputePercentiles] = useState(false);
  const [autoEnrichStravaHR, setAutoEnrichStravaHR] = useState(false);
  const [autoComputeFitnessMetrics, setAutoComputeFitnessMetrics] = useState(false);
  const [saveProfileMsg, setSaveProfileMsg] = useState<string>('');
  const [saveProfileError, setSaveProfileError] = useState<string>('');
  const [savingProfile, setSavingProfile] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<SettingsTab>(normalizeTab(new URLSearchParams(location.search).get('tab')));

  useEffect(() => {
    const nextTab = normalizeTab(new URLSearchParams(location.search).get('tab'));
    if (nextTab !== activeTab) {
      setActiveTab(nextTab);
    }
  }, [location.search, activeTab]);

  const handleTabSelect = (key: string | null) => {
    if (!key) return;
    const tab = normalizeTab(key);
    if (tab !== activeTab) {
      setActiveTab(tab);
    }

    const params = new URLSearchParams(location.search);
    if (params.get('tab') === tab) return;
    params.set('tab', tab);
    const searchString = params.toString();
    navigate(`${location.pathname}?${searchString}`, { replace: true });
  };
  // Finance (Monzo)
  const [monzoConnected, setMonzoConnected] = useState(false);
  const [monzoAccounts, setMonzoAccounts] = useState<Array<{ id: string; description?: string }>>([]);
  const [monzoAccountId, setMonzoAccountId] = useState<string>('');
 

  // Reminders (Shortcuts) helpers
  const [remindersSecret, setRemindersSecret] = useState<string>('');
  const userUid = currentUser?.uid || '';
  const pushUrl = `https://bob20250810.web.app/reminders/push?uid=${userUid}`;
  const pullUrl = `https://bob20250810.web.app/reminders/pull?uid=${userUid}`;
  const jellyPush = `shortcut "BOB Reminders – Push" {\n  let base = \"https://bob20250810.web.app\"\n  let uid = ask(\"Enter BOB User ID\")\n  let secret = ask(\"Enter Reminders Secret\")\n  let remindersList = ask(\"Reminders List (default: Personal)\")\n  if (remindersList == null || remindersList == \"\") { remindersList = \"Personal\" }\n  let headers = dictionary { \"x-reminders-secret\": secret }\n  let url = base + \"/reminders/push?uid=\" + uid\n  let response = getContentsOfURL(url: url, method: GET, headers: headers)\n  let payload = getDictionary(response)\n  let tasks = payload[\"tasks\"]\n  repeat task in tasks {\n    let id = task[\"id\"]\n    let title = task[\"title\"]\n    let dueDateMs = task[\"dueDate\"]\n    let ref = task[\"ref\"] ?? id\n    let storyId = task[\"storyId\"]\n    let goalId = task[\"goalId\"]\n    let createdAtMs = task[\"createdAt\"]\n    let createdLine = \"\"\n    if (createdAtMs != null) {\n      let createdDate = date((createdAtMs / 1000))\n      createdLine = \"[Created: \" + formatDate(createdDate, \"yyyy-MM-dd HH:mm\") + \"]\"\n    }\n    let due = null\n    if (dueDateMs != null) { due = date((dueDateMs / 1000)) }\n    let marker = \"BOB: \" + ref\n    let existing = findReminders(inList: remindersList, where: notesContains(marker), limit: 1)\n    if (count(existing) == 0) {\n      let extra = \"\"\n      if (storyId != null && storyId != \"\") { extra = extra + \" | Story: \" + storyId }\n      if (goalId != null && goalId != \"\") { extra = extra + \" | Goal: \" + goalId }\n      let line1 = marker + extra\n      let line2 = \"[\" + formatDate(currentDate(), \"yyyy-MM-dd HH:mm\") + \"] Created via Push\"\n      let line3 = (due != null) ? (\"(due: \" + formatDate(due, \"yyyy-MM-dd\") + \")\") : \"\"\n      let notes = line1 + \"\\n\" + line2 + (line3 == \"\" ? \"\" : (\" \" + line3)) + (createdLine == \"\" ? \"\" : (\"\\n\" + createdLine))\n      let r = createReminder(title: title, inList: remindersList, dueDate: due, notes: notes)\n    } else {\n      let r = first(existing)\n      setReminder(r, title: title, dueDate: due)\n      let prepend = \"[\" + formatDate(currentDate(), \"yyyy-MM-dd HH:mm\") + \"] Updated via Push\"\n      prependReminderNotes(r, prepend)\n    }\n  }\n}\n`;
  const jellyPull = `shortcut \"BOB Reminders – Pull\" {\n  let base = \"https://bob20250810.web.app\"\n  let uid = ask(\"Enter BOB User ID\")\n  let secret = ask(\"Enter Reminders Secret\")\n  let remindersList = ask(\"Reminders List (default: Personal)\")\n  if (remindersList == null || remindersList == \"\") { remindersList = \"Personal\" }\n  let lookbackMinutes = 120\n  let since = addToDate(currentDate(), minutes: -lookbackMinutes)\n  let candidates = findReminders(inList: remindersList, where: modifiedAfter(since))\n  let changes = []\n  repeat r in candidates {\n    let rid = identifier(r)\n    let notes = getReminderNotes(r)\n    let firstLine = firstLineOf(notes)\n    let id = null\n    if (startsWith(firstLine, \"BOB:\")) { id = trim(replace(firstLine, \"BOB:\", \"\")) }\n    let completed = isReminderCompleted(r)\n    let entry = dictionary { \"id\": id, \"reminderId\": rid, \"completed\": completed }\n    changes = append(changes, entry)\n    let stamp = \"[\" + formatDate(currentDate(), \"yyyy-MM-dd HH:mm\") + \"] \" + (completed ? \"Completed\" : \"Updated\") + \" in Reminders\"\n    prependReminderNotes(r, stamp)\n  }\n  let body = dictionary { \"tasks\": changes, \"uid\": uid }\n  let headers = dictionary { \"x-reminders-secret\": secret, \"Content-Type\": \"application/json\" }\n  let url = base + \"/reminders/pull?uid=\" + uid\n  let result = getContentsOfURL(url: url, method: POST, headers: headers, body: toJSON(body))\n  showResult(result)\n}\n`;
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); alert('Copied'); } catch {}
  };

  // Generate minimal Apple Shortcuts JSON skeletons for import
  const makePushShortcutJson = (uid: string, secret: string, base: string) => ({
    WFWorkflowClientVersion: 900,
    WFWorkflowIcon: { WFWorkflowIconGlyphNumber: 59513, WFWorkflowIconStartColor: 0 },
    WFWorkflowName: 'BOB Reminders – Push',
    WFWorkflowActions: [
      {
        WFWorkflowActionIdentifier: 'is.workflow.actions.getcontentsurl',
        WFWorkflowActionParameters: {
          WFGetContentsOfURLActionURL: `${base}/reminders/push?uid=${uid}`,
          WFHTTPMethod: 'GET',
          WFHTTPHeaders: { 'x-reminders-secret': secret }
        }
      }
    ]
  });

  const makePullShortcutJson = (uid: string, secret: string, base: string) => ({
    WFWorkflowClientVersion: 900,
    WFWorkflowIcon: { WFWorkflowIconGlyphNumber: 59513, WFWorkflowIconStartColor: 0 },
    WFWorkflowName: 'BOB Reminders – Pull',
    WFWorkflowActions: [
      {
        WFWorkflowActionIdentifier: 'is.workflow.actions.getcontentsurl',
        WFWorkflowActionParameters: {
          WFGetContentsOfURLActionURL: `${base}/reminders/pull?uid=${uid}`,
          WFHTTPMethod: 'POST',
          WFHTTPHeaders: { 'x-reminders-secret': secret, 'Content-Type': 'application/json' },
          WFRequestBody: JSON.stringify({ tasks: [] })
        }
      }
    ]
  });

  const downloadJson = (filename: string, data: any) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // Check if database needs migration to new theme system
  const checkMigrationStatus = async () => {
    if (!currentUser) return;

    try {
      const collections = ['goals', 'stories', 'tasks'];
      let needsMigration = false;

      for (const collectionName of collections) {
        const q = query(collection(db, collectionName), where('userId', '==', currentUser.uid));
        const snapshot = await getDocs(q);
        
        const count = snapshot.size;

        // Check if any items have string-based themes (need migration)
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          if (typeof data.theme === 'string') {
            needsMigration = true;
          }
        });

        setMigrationStats(prev => ({
          ...prev,
          [collectionName]: count,
          needsMigration
        }));
      }
    } catch (error) {
      console.error('Error checking migration status:', error);
    }
  };

  // Load global theme settings from Firebase
  useEffect(() => {
    const loadGlobalThemes = async () => {
      if (!currentUser) return;
      
      try {
        const docRef = doc(db, 'global_themes', currentUser.uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data() as GlobalThemeSettings;
          setGlobalThemes(data.themes || GLOBAL_THEMES);
        }
        // Load fitness profile fields
        const profileRef = doc(db, 'profiles', currentUser.uid);
        const profileSnap = await getDoc(profileRef);
      if (profileSnap.exists()) {
        const p = profileSnap.data() as any;
          setParkrunAthleteId(p.parkrunAthleteId || '');
          setParkrunAutoSync(!!p.parkrunAutoSync);
          setStravaAutoSync(!!p.stravaAutoSync);
          setParkrunDefaultEventSlug(p.parkrunDefaultEventSlug || '');
          setParkrunDefaultStartRun(p.parkrunDefaultStartRun ? String(p.parkrunDefaultStartRun) : '');
          setParkrunAutoComputePercentiles(!!p.parkrunAutoComputePercentiles);
          setAutoEnrichStravaHR(!!p.autoEnrichStravaHR);
        setAutoComputeFitnessMetrics(!!p.autoComputeFitnessMetrics);
        setMonzoConnected(!!p.monzoConnected);
      }
        
        // Check migration status
        await checkMigrationStatus();
        
      } catch (error) {
        console.error('Error loading global themes:', error);
      }
    };

    loadGlobalThemes();
  }, [currentUser]);

  // Initialize theme debugging (only when debug mode is enabled)
  useEffect(() => {
    // Theme debugging is now controlled by THEME_DEBUG_ENABLED flag in themeDebugger.ts
    // This prevents console flooding during normal usage
  }, [isDark, theme, logThemeInfo, scanPageForInconsistencies]);

  // Migrate database to use numeric theme IDs
  const migrateDatabase = async () => {
    if (!currentUser) return;

    try {
      setMigrationProgress(0);
      const collections = ['goals', 'stories', 'tasks'];
      const batch = writeBatch(db);
      let totalProcessed = 0;
      let totalItems = 0;
      
      // First count total items
      for (const collectionName of collections) {
        const q = query(collection(db, collectionName), where('userId', '==', currentUser.uid));
        const snapshot = await getDocs(q);
        totalItems += snapshot.size;
      }
      
      for (const collectionName of collections) {
        const q = query(collection(db, collectionName), where('userId', '==', currentUser.uid));
        const snapshot = await getDocs(q);
        
        snapshot.docs.forEach(docSnapshot => {
          const data = docSnapshot.data();
          
          // Only migrate if theme is still a string
          if (typeof data.theme === 'string') {
            const themeMapping: Record<string, number> = {
              'Health': 1, 'Growth': 2, 'Wealth': 3, 'Tribe': 4, 'Home': 5, 'General': 0
            };
            
            const newThemeId = themeMapping[data.theme] || 0;
            
            batch.update(doc(db, collectionName, docSnapshot.id), {
              theme: newThemeId,
              migratedAt: serverTimestamp()
            });
          }
          
          totalProcessed++;
          setMigrationProgress(Math.round((totalProcessed / totalItems) * 100));
        });
      }
      
      await batch.commit();
      setMigrateSuccess(true);
      await checkMigrationStatus();
      
    } catch (error) {
      console.error('Error migrating database:', error);
    }
  };

  // Monzo handlers
  const handleMonzoConnect = async () => {
    if (!currentUser) return;
    try {
      const nonce = Math.random().toString(36).slice(2);
      const region = 'europe-west2';
      const projectId = (window as any).FIREBASE_PROJECT_ID || (window as any).REACT_APP_FIREBASE_PROJECT_ID || 'bob20250810';
      const url = `https://${region}-${projectId}.cloudfunctions.net/monzoOAuthStart?uid=${currentUser.uid}&nonce=${nonce}`;
      const popup = window.open(url, 'monzo-oauth', 'width=500,height=700');
      const check = setInterval(() => {
        if (popup?.closed) { clearInterval(check); setMonzoConnected(true); }
      }, 800);
    } catch (e) { console.warn('Monzo connect failed', (e as any)?.message); }
  };

  const handleMonzoListAccounts = async () => {
    try {
      const callable = httpsCallable(functions, 'monzoListAccounts');
      const res: any = await callable({});
      const accounts = (res?.data?.accounts || []).map((a: any) => ({ id: a.id, description: a.description || a.type }));
      setMonzoAccounts(accounts);
      if (!monzoAccountId && accounts[0]) setMonzoAccountId(accounts[0].id);
    } catch (e) { console.warn('Monzo list accounts failed', (e as any)?.message); }
  };

  const handleMonzoSync = async () => {
    if (!monzoAccountId) { alert('Select a Monzo account first'); return; }
    try {
      const callable = httpsCallable(functions, 'monzoSyncTransactions');
      const res: any = await callable({ accountId: monzoAccountId });
      alert(`Synced ${res?.data?.count || 0} transactions`);
    } catch (e) { alert('Monzo sync failed: ' + ((e as any)?.message || 'unknown')); }
  };

  // Save global theme configuration
  const saveGlobalThemes = async () => {
    if (!currentUser) return;

    try {
      const globalThemeSettings: GlobalThemeSettings = {
        themes: globalThemes,
        customizations: {},
        lastUpdated: serverTimestamp()
      };

      await setDoc(doc(db, 'global_themes', currentUser.uid), globalThemeSettings);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('Error saving global themes:', error);
    }
  };

  // Edit theme color
  const handleThemeEdit = (theme: GlobalTheme) => {
    setEditingTheme({ ...theme });
    setShowThemeModal(true);
  };

  // Save edited theme
  const saveThemeEdit = () => {
    if (!editingTheme) return;

    setGlobalThemes(prev => 
      prev.map(theme => 
        theme.id === editingTheme.id ? editingTheme : theme
      )
    );
    
    setShowThemeModal(false);
    setEditingTheme(null);
  };

  // Reset to default themes
  const resetToDefaults = () => {
    setGlobalThemes(GLOBAL_THEMES);
  };

  return (
    <Container fluid className="py-4">
      <Row>
        <Col>
          <div className="d-flex justify-content-between align-items-center mb-4">
            <h2 style={{ color: colors.primary }} className="mb-0">
              <Settings size={28} className="me-2" />
              Settings
            </h2>
            <Button 
              variant="outline-info" 
              size="sm"
              onClick={(e) => {
                createClickHandler()(e);
                scanPageForInconsistencies();
              }}
            >
              🔍 Debug Theme
            </Button>
          </div>
        </Col>
      </Row>

      <Tab.Container activeKey={activeTab} onSelect={handleTabSelect}>
        <Row>
          <Col sm={3}>
            <Nav variant="pills" className="flex-column">
              <Nav.Item>
                <Nav.Link 
                  eventKey="themes" 
                  style={{ color: colors.primary }}
                  onClick={createClickHandler()}
                >
                  <Palette size={20} className="me-2" />
                  Themes & Colors
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link 
                  eventKey="database" 
                  style={{ color: colors.primary }}
                  onClick={createClickHandler()}
                >
                  <Database size={20} className="me-2" />
                  Database Migration
                  {migrationStats.needsMigration && (
                    <Badge bg="warning" className="ms-2">Action Needed</Badge>
                  )}
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link 
                  eventKey="integrations" 
                  style={{ color: colors.primary }}
                  onClick={createClickHandler()}
                >
                  <Plug size={20} className="me-2" />
                  Integrations
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link 
                  eventKey="reminders" 
                  style={{ color: colors.primary }}
                  onClick={createClickHandler()}
                >
                  <KeyRound size={20} className="me-2" />
                  Reminders (Shortcuts)
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link 
                  eventKey="ai"
                  style={{ color: colors.primary }}
                  onClick={createClickHandler()}
                >
                  <Wand2 size={20} className="me-2" />
                  AI: Story & KPI
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link 
                  eventKey="system" 
                  style={{ color: colors.primary }}
                  onClick={createClickHandler()}
                >
                  <Settings size={20} className="me-2" />
                  System Preferences
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link 
                  eventKey="finance" 
                  style={{ color: colors.primary }}
                  onClick={createClickHandler()}
                >
                  <Database size={20} className="me-2" />
                  Finance (Monzo)
                </Nav.Link>
              </Nav.Item>
            </Nav>
          </Col>
          
          <Col sm={9}>
            <Tab.Content>
              {/* Themes & Colors Tab */}
              <Tab.Pane eventKey="themes">
                <Card 
                  style={{ backgroundColor: backgrounds.card, border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}` }}
                  onClick={createClickHandler()}
                >
                  <Card.Header 
                    style={{ backgroundColor: backgrounds.surface, color: colors.primary }}
                    onClick={createClickHandler()}
                  >
                    <h4 className="mb-0">Global Theme Management</h4>
                    <small style={{ color: colors.secondary }}>
                      Customize themes used across all goals, stories, and tasks
                    </small>
                  </Card.Header>
                  <Card.Body>
                    {saveSuccess && (
                      <Alert variant="success" className="mb-3">
                        Global themes saved successfully!
                      </Alert>
                    )}
                    
                    <div className="d-flex justify-content-between align-items-center mb-3">
                      <h5 style={{ color: colors.primary }}>Global Themes ({globalThemes.length})</h5>
                      <div>
                        <Button 
                          variant="outline-secondary" 
                          size="sm" 
                          onClick={(e) => {
                            createClickHandler()(e);
                            resetToDefaults();
                          }}
                          className="me-2"
                        >
                          Reset to Defaults
                        </Button>
                        <Button 
                          variant="primary" 
                          onClick={(e) => {
                            createClickHandler()(e);
                            saveGlobalThemes();
                          }}
                        >
                          Save Themes
                        </Button>
                      </div>
                    </div>

                    <Row>
                      {globalThemes.map((theme) => (
                        <Col md={6} lg={4} key={theme.id} className="mb-3">
                          <Card 
                            style={{ 
                              backgroundColor: theme.color,
                              color: getContrastTextColor(theme.color),
                              cursor: 'pointer',
                              transition: 'transform 0.2s ease'
                            }}
                            className="h-100"
                            onClick={(e) => {
                              createClickHandler()(e);
                              handleThemeEdit(theme);
                            }}
                          >
                            <Card.Body className="text-center">
                              <h6 className="mb-1">{theme.label}</h6>
                              <small style={{ opacity: 0.8 }}>
                                ID: {theme.id} | {theme.color}
                              </small>
                            </Card.Body>
                          </Card>
                        </Col>
                      ))}
                    </Row>

                    <Alert variant="info" className="mt-3">
                      <strong>Note:</strong> Changes to themes will apply to all new goals, stories, and tasks. 
                      Existing items will retain their current theme assignments unless migrated.
                    </Alert>
                  </Card.Body>
                </Card>
              </Tab.Pane>

              {/* Finance (Monzo) */}
              <Tab.Pane eventKey="finance">
                <Card className="mb-3" style={{ backgroundColor: backgrounds.card }}>
                  <Card.Body>
                    <h5 className="mb-3">Monzo Bank</h5>
                    <div className="d-flex justify-content-between align-items-center p-3 border rounded">
                      <div>
                        <div className="mb-1"><strong>Status:</strong> {monzoConnected ? <span className="text-success">Connected</span> : <span className="text-muted">Not connected</span>}</div>
                        <div className="small text-muted">Connect and import transactions for budgeting and dashboards</div>
                      </div>
                      <div className="d-flex flex-column align-items-end gap-2">
                        <button className={`btn ${monzoConnected ? 'btn-outline-danger' : 'btn-outline-primary'}`} onClick={handleMonzoConnect}>
                          {monzoConnected ? 'Reconnect' : 'Connect'}
                        </button>
                        {monzoConnected && (
                          <div className="d-flex gap-2 align-items-center">
                            <select className="form-select form-select-sm" value={monzoAccountId} onChange={(e) => setMonzoAccountId(e.target.value)} style={{ minWidth: 220 }}>
                              <option value="">Select account…</option>
                              {monzoAccounts.map(a => (<option key={a.id} value={a.id}>{a.description || a.id}</option>))}
                            </select>
                            <button className="btn btn-outline-secondary btn-sm" onClick={handleMonzoListAccounts}>List Accounts</button>
                            <button className="btn btn-outline-success btn-sm" onClick={handleMonzoSync}>Sync Now</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card.Body>
                </Card>

                <BudgetSettings />
              </Tab.Pane>

              {/* Reminders (Shortcuts) Tab */}
              <Tab.Pane eventKey="reminders">
                <Card style={{ backgroundColor: backgrounds.card, border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}` }}>
                  <Card.Header style={{ backgroundColor: backgrounds.surface, color: colors.primary }}>
                    <h4 className="mb-0">Apple Reminders (Shortcuts)</h4>
                    <small className="text-muted">Endpoints, your UID, Jellycuts code, and secret rotation</small>
                  </Card.Header>
                  <Card.Body>
                    <Row className="mb-3">
                      <Col md={6}>
                        <Form.Group className="mb-2">
                          <Form.Label>Your User ID (UID)</Form.Label>
                          <div className="d-flex gap-2">
                            <Form.Control readOnly value={userUid} />
                            <Button variant="outline-secondary" onClick={() => copy(userUid)}><Clipboard size={16} /></Button>
                          </div>
                        </Form.Group>
                        <Form.Group className="mb-2">
                          <Form.Label>Push URL</Form.Label>
                          <div className="d-flex gap-2">
                            <Form.Control readOnly value={pushUrl} />
                            <Button variant="outline-secondary" onClick={() => copy(pushUrl)}><Clipboard size={16} /></Button>
                          </div>
                        </Form.Group>
                        <Form.Group className="mb-2">
                          <Form.Label>Pull URL</Form.Label>
                          <div className="d-flex gap-2">
                            <Form.Control readOnly value={pullUrl} />
                            <Button variant="outline-secondary" onClick={() => copy(pullUrl)}><Clipboard size={16} /></Button>
                          </div>
                        </Form.Group>
                        <Form.Group className="mb-2">
                          <Form.Label>Secret (paste for curl examples)</Form.Label>
                          <Form.Control type="password" placeholder="REMINDERS_WEBHOOK_SECRET" value={remindersSecret} onChange={(e)=>setRemindersSecret(e.target.value)} />
                        </Form.Group>
                      </Col>
                      <Col md={6}>
                        <Form.Group className="mb-2">
                          <Form.Label>curl: Push</Form.Label>
                          <Form.Control as="textarea" rows={4} readOnly value={`curl -sS -H 'x-reminders-secret: ${remindersSecret||'<SECRET>'}' '${pushUrl}' | jq .`} />
                          <div className="mt-1"><Button size="sm" variant="outline-secondary" onClick={()=>copy(`curl -sS -H 'x-reminders-secret: ${remindersSecret||'<SECRET>'}' '${pushUrl}' | jq .`)}>Copy</Button></div>
                        </Form.Group>
                        <Form.Group className="mb-2">
                          <Form.Label>curl: Pull (example)</Form.Label>
                          <Form.Control as="textarea" rows={4} readOnly value={`curl -sS -X POST -H 'x-reminders-secret: ${remindersSecret||'<SECRET>'}' -H 'Content-Type: application/json' -d '{\\"tasks\\":[{\\"id\\":\\"<taskId>\\",\\"reminderId\\":\\"<rid>\\",\\"completed\\":true}]}' '${pullUrl}' | jq .`} />
                          <div className="mt-1"><Button size="sm" variant="outline-secondary" onClick={()=>copy(`curl -sS -X POST -H 'x-reminders-secret: ${remindersSecret||'<SECRET>'}' -H 'Content-Type: application/json' -d '{\"tasks\":[{\"id\":\"<taskId>\",\"reminderId\":\"<rid>\",\"completed\":true}]}' '${pullUrl}' | jq .`)}>Copy</Button></div>
                        </Form.Group>
                      </Col>
                    </Row>
                    <Row>
                      <Col md={6} className="mb-3">
                        <Card>
                          <Card.Header><FileCode size={16} className="me-2" /> Jellycuts: Push</Card.Header>
                          <Card.Body>
                            <Form.Control as="textarea" rows={12} readOnly value={jellyPush} />
                            <div className="mt-2"><Button size="sm" variant="outline-secondary" onClick={()=>copy(jellyPush)}>Copy Jelly (Push)</Button></div>
                            <div className="mt-2"><Button size="sm" variant="outline-primary" onClick={()=>downloadJson('BOB_Reminders_Push.shortcut.json', makePushShortcutJson(userUid, remindersSecret||'<SECRET>', 'https://bob20250810.web.app'))}>Download Apple Shortcut JSON (Push)</Button></div>
                          </Card.Body>
                        </Card>
                      </Col>
                      <Col md={6} className="mb-3">
                        <Card>
                          <Card.Header><FileCode size={16} className="me-2" /> Jellycuts: Pull</Card.Header>
                          <Card.Body>
                            <Form.Control as="textarea" rows={12} readOnly value={jellyPull} />
                            <div className="mt-2"><Button size="sm" variant="outline-secondary" onClick={()=>copy(jellyPull)}>Copy Jelly (Pull)</Button></div>
                            <div className="mt-2"><Button size="sm" variant="outline-primary" onClick={()=>downloadJson('BOB_Reminders_Pull.shortcut.json', makePullShortcutJson(userUid, remindersSecret||'<SECRET>', 'https://bob20250810.web.app'))}>Download Apple Shortcut JSON (Pull)</Button></div>
                          </Card.Body>
                        </Card>
                      </Col>
                    </Row>
                    <Card className="mt-2">
                      <Card.Header>Rotate Secret</Card.Header>
                      <Card.Body>
                        <p className="mb-2">Secret name: <code>REMINDERS_WEBHOOK_SECRET</code> (Google Cloud Secret Manager)</p>
                        <pre className="p-2 bg-light" style={{whiteSpace:'pre-wrap'}}>
gcloud secrets versions access latest --secret=REMINDERS_WEBHOOK_SECRET --project=bob20250810
firebase functions:secrets:set REMINDERS_WEBHOOK_SECRET --project bob20250810
firebase deploy --only functions:remindersPush,functions:remindersPull --project bob20250810
                        </pre>
                        <small className="text-muted">Updating the secret requires redeploying the affected functions.</small>
                      </Card.Body>
                    </Card>
                  </Card.Body>
                </Card>
              </Tab.Pane>

              {/* Database Migration Tab */}
              <Tab.Pane eventKey="database">
                <Card style={{ backgroundColor: backgrounds.card, border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}` }}>
                  <Card.Header style={{ backgroundColor: backgrounds.surface, color: colors.primary }}>
                    <h4 className="mb-0">Database Migration</h4>
                    <small style={{ color: colors.secondary }}>
                      Upgrade your data to use the new global theme system
                    </small>
                  </Card.Header>
                  <Card.Body>
                    {migrateSuccess && (
                      <Alert variant="success" className="mb-3">
                        Database migration completed successfully!
                      </Alert>
                    )}

                    <Row className="mb-4">
                      <Col md={4} className="text-center">
                        <h3 style={{ color: colors.primary }}>{migrationStats.goals}</h3>
                        <p style={{ color: colors.secondary }}>Goals</p>
                      </Col>
                      <Col md={4} className="text-center">
                        <h3 style={{ color: colors.primary }}>{migrationStats.stories}</h3>
                        <p style={{ color: colors.secondary }}>Stories</p>
                      </Col>
                      <Col md={4} className="text-center">
                        <h3 style={{ color: colors.primary }}>{migrationStats.tasks}</h3>
                        <p style={{ color: colors.secondary }}>Tasks</p>
                      </Col>
                    </Row>

                    {migrationStats.needsMigration ? (
                      <div>
                        <Alert variant="warning">
                          <strong>Migration Required:</strong> Your database contains items using the old theme format. 
                          Click below to upgrade them to the new global theme system.
                        </Alert>
                        
                        {migrationProgress > 0 && migrationProgress < 100 && (
                          <div className="mb-3">
                            <div className="progress">
                              <div 
                                className="progress-bar" 
                                style={{ width: `${migrationProgress}%` }}
                              >
                                {migrationProgress}%
                              </div>
                            </div>
                          </div>
                        )}
                        
                        <Button 
                          variant="warning" 
                          onClick={migrateDatabase}
                          disabled={migrationProgress > 0 && migrationProgress < 100}
                        >
                          {migrationProgress > 0 && migrationProgress < 100 ? 'Migrating...' : 'Migrate Database'}
                        </Button>
                      </div>
                    ) : (
                      <Alert variant="success">
                        <strong>Up to Date:</strong> Your database is using the latest global theme system.
                      </Alert>
                    )}
                  </Card.Body>
                </Card>
              </Tab.Pane>

              <Tab.Pane eventKey="integrations">
                <IntegrationSettings />
              </Tab.Pane>

              {/* AI Story/KPI Settings */}
              <Tab.Pane eventKey="ai">
                <AIStoryKPISettings />
              </Tab.Pane>

              {/* System Preferences Tab */}
              <Tab.Pane eventKey="system">
                <Card style={{ backgroundColor: backgrounds.card, border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}` }}>
                  <Card.Header style={{ backgroundColor: backgrounds.surface, color: colors.primary }}>
                    <h4 className="mb-0">System Preferences</h4>
                  </Card.Header>
                  <Card.Body>
                    {/* AI Story Generation Prompt */}
                    <AISettings />

                    <Card className="mb-3">
                      <Card.Body>
                        <h5 className="mb-2">Fitness & Integrations</h5>
                        <Row className="g-3 align-items-end">
                          <Col md={6}>
                            <Form.Group>
                              <Form.Label style={{ color: colors.primary }}>Parkrun Athlete ID</Form.Label>
                              <Form.Control
                                type="text"
                                placeholder="e.g., 349501"
                                value={parkrunAthleteId}
                                onChange={(e) => setParkrunAthleteId(e.target.value)}
                              />
                              <Form.Text className="text-muted">Found in your Parkrun profile URL (athleteNumber=...)</Form.Text>
                            </Form.Group>
                          </Col>
                          <Col md={3}>
                            <Button
                              variant="primary"
                              disabled={savingProfile}
                              onClick={async () => {
                                if (!currentUser) return;
                                setSavingProfile(true);
                                setSaveProfileError('');
                                try {
                                  await setDoc(doc(db, 'profiles', currentUser.uid), {
                                    ownerUid: currentUser.uid,
                                    parkrunAthleteId,
                                    parkrunAutoSync,
                                    stravaAutoSync,
                                    parkrunDefaultEventSlug,
                                    parkrunDefaultStartRun: parkrunDefaultStartRun ? Number(parkrunDefaultStartRun) : null,
                                    parkrunAutoComputePercentiles,
                                    autoEnrichStravaHR,
                                    autoComputeFitnessMetrics
                                  }, { merge: true });
                                  setSaveProfileMsg('Saved');
                                  setTimeout(() => setSaveProfileMsg(''), 2500);
                                } catch (e: any) {
                                  setSaveProfileError(e?.message || 'Failed to save');
                                } finally {
                                  setSavingProfile(false);
                                }
                              }}
                            >
                              {savingProfile ? 'Saving…' : 'Save'}
                            </Button>
                          </Col>
                          <Col md={3}>
                            {saveProfileMsg && <span className="text-success">{saveProfileMsg}</span>}
                            {saveProfileError && <span className="text-danger">{saveProfileError}</span>}
                          </Col>
                        </Row>
                      </Card.Body>
                    </Card>

                    <Card className="mb-3">
                      <Card.Body>
                        <h6 className="mb-2">Automation</h6>
                        <Row className="g-3">
                          <Col md={6}>
                            <Form.Check type="checkbox" label="Auto-sync Parkrun (daily)" checked={parkrunAutoSync} onChange={(e)=>setParkrunAutoSync(e.target.checked)} />
                          </Col>
                          <Col md={6}>
                            <Form.Check type="checkbox" label="Auto-sync Strava (daily)" checked={stravaAutoSync} onChange={(e)=>setStravaAutoSync(e.target.checked)} />
                          </Col>
                          <Col md={6}>
                            <Form.Check type="checkbox" label="Auto-compute Parkrun percentiles" checked={parkrunAutoComputePercentiles} onChange={(e)=>setParkrunAutoComputePercentiles(e.target.checked)} />
                          </Col>
                          <Col md={6}>
                            <Form.Check type="checkbox" label="Auto-enrich Strava HR zones" checked={autoEnrichStravaHR} onChange={(e)=>setAutoEnrichStravaHR(e.target.checked)} />
                          </Col>
                          <Col md={6}>
                            <Form.Check type="checkbox" label="Auto-compute Fitness Overview/Analysis" checked={autoComputeFitnessMetrics} onChange={(e)=>setAutoComputeFitnessMetrics(e.target.checked)} />
                          </Col>
                        </Row>
                        <Row className="g-3 mt-2">
                          <Col md={6}>
                            <Form.Label>Default Event Slug</Form.Label>
                            <Form.Control value={parkrunDefaultEventSlug} onChange={(e)=>setParkrunDefaultEventSlug(e.target.value)} placeholder="e.g., ormeau" />
                          </Col>
                          <Col md={6}>
                            <Form.Label>Default Start Run #</Form.Label>
                            <Form.Control value={parkrunDefaultStartRun} onChange={(e)=>setParkrunDefaultStartRun(e.target.value)} placeholder="e.g., 552" />
                          </Col>
                        </Row>
                      </Card.Body>
                    </Card>

                    <Form.Group className="mb-3">
                      <Form.Label style={{ color: colors.primary }}>Theme Mode</Form.Label>
                      <Form.Select 
                        value={theme} 
                        onChange={(e) => {
                          const newTheme = e.target.value as 'light' | 'dark' | 'system';
                          if (newTheme !== theme) {
                            toggleTheme();
                          }
                        }}
                        style={{ 
                          backgroundColor: backgrounds.surface, 
                          color: colors.onSurface,
                          border: `1px solid ${isDark ? '#374151' : '#d1d5db'}`
                        }}
                      >
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                        <option value="system">System</option>
                      </Form.Select>
                    </Form.Group>

                    <Alert variant="info">
                      <strong>Current Theme:</strong> {theme} mode
                      {theme === 'system' && ` (resolved to ${isDark ? 'dark' : 'light'})`}
                    </Alert>
                  </Card.Body>
                </Card>
              </Tab.Pane>
            </Tab.Content>
          </Col>
        </Row>
      </Tab.Container>

      {/* Theme Edit Modal */}
      <Modal show={showThemeModal} onHide={() => setShowThemeModal(false)}>
        <Modal.Header closeButton style={{ backgroundColor: backgrounds.surface, color: colors.primary }}>
          <Modal.Title>Edit Theme</Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ backgroundColor: backgrounds.card }}>
          {editingTheme && (
            <Form>
              <Form.Group className="mb-3">
                <Form.Label style={{ color: colors.primary }}>Theme Name</Form.Label>
                <Form.Control
                  type="text"
                  value={editingTheme.label}
                  onChange={(e) => setEditingTheme({...editingTheme, label: e.target.value})}
                  style={{ 
                    backgroundColor: backgrounds.surface, 
                    color: colors.onSurface,
                    border: `1px solid ${isDark ? '#374151' : '#d1d5db'}`
                  }}
                />
              </Form.Group>
              
              <Form.Group className="mb-3">
                <Form.Label style={{ color: colors.primary }}>Color</Form.Label>
                <Form.Control
                  type="color"
                  value={editingTheme.color}
                  onChange={(e) => setEditingTheme({...editingTheme, color: e.target.value})}
                  style={{ 
                    backgroundColor: backgrounds.surface,
                    border: `1px solid ${isDark ? '#374151' : '#d1d5db'}`
                  }}
                />
              </Form.Group>

              <div className="preview-card p-3 text-center rounded" style={{ 
                backgroundColor: editingTheme.color,
                color: getContrastTextColor(editingTheme.color)
              }}>
                Preview: {editingTheme.label}
              </div>
            </Form>
          )}
        </Modal.Body>
        <Modal.Footer style={{ backgroundColor: backgrounds.surface }}>
          <Button variant="secondary" onClick={() => setShowThemeModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={saveThemeEdit}>
            Save Changes
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default SettingsPage;

// --- Inline AI settings component ---
const AISettings: React.FC = () => {
  const { currentUser } = useAuth();
  const [prompt, setPrompt] = useState('');
  const [saved, setSaved] = useState(false);
  const [dedupRunning, setDedupRunning] = useState(false);
  const [dedupResult, setDedupResult] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!currentUser) return;
      try {
        const snap = await getDoc(doc(db, 'user_settings', currentUser.uid));
        if (snap.exists()) {
          setPrompt(snap.data().storyGenPrompt || '');
        }
      } catch (e) {
        console.warn('Failed to load user_settings', e);
      }
    };
    load();
  }, [currentUser]);

  const save = async () => {
    if (!currentUser) return;
    try {
      await setDoc(doc(db, 'user_settings', currentUser.uid), { storyGenPrompt: prompt, updatedAt: serverTimestamp() }, { merge: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('Failed to save prompt', e);
    }
  };

  const runDuplicateDetection = async () => {
    if (!currentUser) return;
    try {
      setDedupRunning(true);
      setDedupResult(null);
      const callable = httpsCallable(functions, 'detectDuplicateReminders');
      const resp: any = await callable({});
      const count = resp?.data?.groupsCreated ?? 0;
      setDedupResult(`Potential duplicate groups created: ${count}`);
    } catch (e: any) {
      console.error('Duplicate detection failed', e);
      setDedupResult('Duplicate detection failed: ' + (e?.message || 'Unknown error'));
    } finally {
      setDedupRunning(false);
    }
  };

  return (
    <Card className="mb-3">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <div>
            <h5 className="mb-0">AI Story Generation</h5>
            <small className="text-muted">Prompt used by the wand button on Gantt goals</small>
          </div>
          <Button size="sm" variant="primary" onClick={save}>Save Prompt</Button>
        </div>
        <Form.Control as="textarea" rows={4} placeholder="Write a system prompt for story generation..." value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        {saved && <div className="text-success mt-2">Saved</div>}
        <hr />
        <div className="d-flex justify-content-between align-items-center">
          <div>
            <h6 className="mb-1">Duplicate Task Detection (iOS Reminders)</h6>
            <small className="text-muted">Scan for potential duplicates and flag for review</small>
          </div>
          <div>
            <Button size="sm" variant="outline-secondary" onClick={runDuplicateDetection} disabled={dedupRunning}>
              {dedupRunning ? 'Running…' : 'Run Detection'}
            </Button>
          </div>
        </div>
        {dedupResult && <div className="mt-2 small">{dedupResult}</div>}
      </Card.Body>
    </Card>
  );
};
