import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Form, Modal, Alert, Nav, Tab, Badge } from 'react-bootstrap';
import { db } from '../firebase';
import { doc, getDoc, setDoc, serverTimestamp, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useThemeAwareColors, getContrastTextColor } from '../hooks/useThemeAwareColors';
import { GLOBAL_THEMES, GlobalTheme } from '../constants/globalThemes';
import CalendarSyncManager from './CalendarSyncManager';
import { Settings, Palette, Database, Calendar } from 'lucide-react';

interface GlobalThemeSettings {
  themes: GlobalTheme[];
  customizations: Record<string, any>;
  lastUpdated: any;
}

const ThemeColorManager: React.FC = () => {
  const { currentUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { isDark, colors, backgrounds } = useThemeAwareColors();
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
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

  const mergeThemes = (saved?: GlobalTheme[] | null): GlobalTheme[] => {
    if (!Array.isArray(saved) || saved.length === 0) return GLOBAL_THEMES;
    const savedById = new Map(saved.map((t) => [t.id, t]));
    const merged = GLOBAL_THEMES.map((t) => savedById.get(t.id) || t);
    const extras = saved.filter((t) => !GLOBAL_THEMES.find((d) => d.id === t.id));
    return extras.length ? [...merged, ...extras] : merged;
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
          setGlobalThemes(mergeThemes(data.themes));
        }
        
        // Check migration status
        await checkMigrationStatus();
        
      } catch (error) {
        console.error('Error loading global themes:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadGlobalThemes();
  }, [currentUser]);

  // Check if database needs migration to new theme system
  const checkMigrationStatus = async () => {
    if (!currentUser) return;

    try {
      const collections = ['goals', 'stories', 'tasks'];
      let totalItems = 0;
      let needsMigration = false;

      for (const collectionName of collections) {
        const q = query(collection(db, collectionName), where('ownerUid', '==', currentUser.uid));
        const snapshot = await getDocs(q);
        
        const count = snapshot.size;
        totalItems += count;

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
        const q = query(collection(db, collectionName), where('ownerUid', '==', currentUser.uid));
        const snapshot = await getDocs(q);
        totalItems += snapshot.size;
      }
      
      for (const collectionName of collections) {
        const q = query(collection(db, collectionName), where('ownerUid', '==', currentUser.uid));
        const snapshot = await getDocs(q);
        
        snapshot.docs.forEach(docSnapshot => {
          const data = docSnapshot.data();
          
          // Only migrate if theme is still a string
          if (typeof data.theme === 'string') {
            const normalizedTheme = String(data.theme).trim().toLowerCase();
            const themeMapping: Record<string, number> = {
              'general': 0,
              'health': 1,
              'health & fitness': 1,
              'health and fitness': 1,
              'fitness': 1,
              'career': 2,
              'professional': 2,
              'career & professional': 2,
              'career and professional': 2,
              'finance': 3,
              'wealth': 3,
              'finance & wealth': 3,
              'finance and wealth': 3,
              'learning': 4,
              'education': 4,
              'learning & education': 4,
              'learning and education': 4,
              'family': 5,
              'relationships': 5,
              'family & relationships': 5,
              'family and relationships': 5,
              'tribe': 5,
              'hobbies': 6,
              'hobby': 6,
              'interests': 6,
              'hobbies & interests': 6,
              'hobbies and interests': 6,
              'travel': 7,
              'adventure': 7,
              'travel & adventure': 7,
              'travel and adventure': 7,
              'home': 8,
              'home & living': 8,
              'home and living': 8,
              'growth': 9,
              'spiritual': 9,
              'spiritual & personal growth': 9,
              'spiritual and personal growth': 9,
              'personal growth': 9,
              'chores': 10,
              'rest': 11,
              'recovery': 11,
              'rest & recovery': 11,
              'rest and recovery': 11,
              'work': 12,
              'work (main gig)': 12,
              'main gig': 12,
              'side gig': 15,
              'side-gig': 15,
              'sidegig': 15,
              'sleep': 13,
              'random': 14
            };
            
            const newThemeId = themeMapping[normalizedTheme] ?? 0;
            
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
      await checkMigrationStatus(); // Refresh migration status
      
    } catch (error) {
      console.error('Error migrating database:', error);
    }
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
      // Apply colors to CSS variables immediately and persist locally for startup
      try {
        const root = document.documentElement;
        const keyMap: Record<string, string> = {
          general: 'growth',
          health: 'health',
          fitness: 'health',
          growth: 'growth',
          spiritual: 'growth',
          learning: 'tribe',
          education: 'tribe',
          wealth: 'wealth',
          finance: 'wealth',
          tribe: 'tribe',
          family: 'tribe',
          relationship: 'tribe',
          home: 'home',
          living: 'home',
          career: 'home',
          professional: 'home',
          work: 'work',
          'side gig': 'sidegig',
          sidegig: 'sidegig',
          sleep: 'sleep',
          random: 'random',
          hobby: 'growth',
          interest: 'growth',
          travel: 'growth',
          adventure: 'growth',
          chores: 'chores',
          rest: 'rest',
          recovery: 'rest'
        };
        const normalizeHex = (hex: string) => {
          const clean = hex.replace('#', '').trim();
          if (clean.length === 3) {
            return clean.split('').map((c) => c + c).join('');
          }
          return clean.padEnd(6, '0').slice(0, 6);
        };
        const mixColor = (hex: string, mixWith: string, amount: number) => {
          const src = normalizeHex(hex);
          const mix = normalizeHex(mixWith);
          const amt = Math.max(0, Math.min(1, amount));
          const sr = parseInt(src.slice(0, 2), 16);
          const sg = parseInt(src.slice(2, 4), 16);
          const sb = parseInt(src.slice(4, 6), 16);
          const mr = parseInt(mix.slice(0, 2), 16);
          const mg = parseInt(mix.slice(2, 4), 16);
          const mb = parseInt(mix.slice(4, 6), 16);
          const r = Math.round(sr + (mr - sr) * amt);
          const g = Math.round(sg + (mg - sg) * amt);
          const b = Math.round(sb + (mb - sb) * amt);
          return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
        };
        const lighten = (hex: string, amount: number) => mixColor(hex, '#ffffff', amount);
        const darken = (hex: string, amount: number) => mixColor(hex, '#000000', amount);
        const applied: Record<string, string> = {};
        globalThemes.forEach(t => {
          const name = (t.name || t.label || '').toLowerCase();
          const match = Object.keys(keyMap).find(k => name.includes(k));
          if (match && t.color) {
            const key = keyMap[match];
            root.style.setProperty(`--theme-${key}-primary`, t.color);
            root.style.setProperty(`--theme-${key}-light`, lighten(t.color, 0.35));
            root.style.setProperty(`--theme-${key}-lighter`, lighten(t.color, 0.7));
            root.style.setProperty(`--theme-${key}-dark`, darken(t.color, 0.2));
            root.style.setProperty(`--theme-${key}-darker`, darken(t.color, 0.35));
            applied[key] = t.color;
          }
        });
        localStorage.setItem('bob-global-themes', JSON.stringify(applied));
      } catch (e) {
        console.warn('Theme CSS override failed', e);
      }
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
          <h2 style={{ color: colors.primary }} className="mb-4">
            <Settings size={28} className="me-2" />
            Settings
          </h2>
        </Col>
      </Row>

      <Tab.Container defaultActiveKey="themes">
        <Row>
          <Col sm={3}>
            <Nav variant="pills" className="flex-column">
              <Nav.Item>
                <Nav.Link eventKey="themes" style={{ color: colors.primary }}>
                  <Palette size={20} className="me-2" />
                  Themes & Colors
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="database" style={{ color: colors.primary }}>
                  <Database size={20} className="me-2" />
                  Database Migration
                  {migrationStats.needsMigration && (
                    <Badge bg="warning" className="ms-2">Action Needed</Badge>
                  )}
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="calendar" style={{ color: colors.primary }}>
                  <Calendar size={20} className="me-2" />
                  Calendar Integration
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="system" style={{ color: colors.primary }}>
                  <Settings size={20} className="me-2" />
                  System Preferences
                </Nav.Link>
              </Nav.Item>
            </Nav>
          </Col>
          
          <Col sm={9}>
            <Tab.Content>
              {/* Themes & Colors Tab */}
              <Tab.Pane eventKey="themes">
                <Card style={{ backgroundColor: backgrounds.card, border: `1px solid var(--line)` }}>
                  <Card.Header style={{ backgroundColor: backgrounds.surface, color: colors.primary }}>
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
                        <Button variant="outline-secondary" size="sm" onClick={resetToDefaults} className="me-2">
                          Reset to Defaults
                        </Button>
                        <Button variant="primary" onClick={saveGlobalThemes}>
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
                            onClick={() => handleThemeEdit(theme)}
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

              {/* Database Migration Tab */}
              <Tab.Pane eventKey="database">
                <Card style={{ backgroundColor: backgrounds.card, border: `1px solid var(--line)` }}>
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

              {/* Calendar Integration Tab */}
              <Tab.Pane eventKey="calendar">
                <CalendarSyncManager />
              </Tab.Pane>

              {/* System Preferences Tab */}
              <Tab.Pane eventKey="system">
                <Card style={{ backgroundColor: backgrounds.card, border: `1px solid var(--line)` }}>
                  <Card.Header style={{ backgroundColor: backgrounds.surface, color: colors.primary }}>
                    <h4 className="mb-0">System Preferences</h4>
                  </Card.Header>
                  <Card.Body>
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
                          border: `1px solid var(--line)`
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
                    border: `1px solid var(--line)`
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
                    border: `1px solid var(--line)`
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

export default ThemeColorManager;

// Ensure module recognition
export {};
