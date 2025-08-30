import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Form, Modal, Alert, Nav, Tab } from 'react-bootstrap';
import { db } from '../firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import CalendarSyncManager from './CalendarSyncManager';

interface ThemeColors {
  Health: string;
  Growth: string;
  Wealth: string;
  Tribe: string;
  Home: string;
}

interface ThemeColorShades {
  primary: string;
  light: string;
  lighter: string;
  dark: string;
  darker: string;
}

const ThemeColorManager: React.FC = () => {
  const { currentUser } = useAuth();
  const { theme } = useTheme();
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Default theme colors (Material Design inspired)
  const [themeColors, setThemeColors] = useState<ThemeColors>({
    Health: '#e53e3e', // Red
    Growth: '#3182ce', // Blue  
    Wealth: '#38a169', // Green
    Tribe: '#805ad5', // Purple
    Home: '#d69e2e'   // Orange/Yellow
  });

  // Generate material design shades
  const generateShades = (color: string): ThemeColorShades => {
    // Convert hex to RGB
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);

    // Generate lighter and darker shades
    const lighten = (amount: number) => {
      const newR = Math.min(255, r + amount);
      const newG = Math.min(255, g + amount);
      const newB = Math.min(255, b + amount);
      return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
    };

    const darken = (amount: number) => {
      const newR = Math.max(0, r - amount);
      const newG = Math.max(0, g - amount);
      const newB = Math.max(0, b - amount);
      return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
    };

    return {
      primary: color,
      light: lighten(40),
      lighter: lighten(80),
      dark: darken(40),
      darker: darken(80)
    };
  };

  // Load user's custom theme colors
  useEffect(() => {
    if (!currentUser) return;

    const loadThemeColors = async () => {
      try {
        const docRef = doc(db, 'theme_colors', currentUser.uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          setThemeColors(data.colors || themeColors);
        }
      } catch (error) {
        console.error('Error loading theme colors:', error);
      }
    };

    loadThemeColors();
  }, [currentUser]);

  const handleColorChange = (themeKey: keyof ThemeColors, color: string) => {
    setThemeColors(prev => ({
      ...prev,
      [themeKey]: color
    }));
  };

  const saveThemeColors = async () => {
    if (!currentUser) return;

    try {
      await setDoc(doc(db, 'theme_colors', currentUser.uid), {
        colors: themeColors,
        updatedAt: serverTimestamp()
      });

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('Error saving theme colors:', error);
    }
  };

  const resetToDefaults = () => {
    setThemeColors({
      Health: '#e53e3e',
      Growth: '#3182ce', 
      Wealth: '#38a169',
      Tribe: '#805ad5',
      Home: '#d69e2e'
    });
  };

  return (
    <Container fluid className="mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>Settings</h2>
      </div>

      <Tab.Container defaultActiveKey="theme-colors">
        <Row>
          <Col sm={2}>
            <Nav variant="pills" className="flex-column">
              <Nav.Item>
                <Nav.Link eventKey="theme-colors">Theme Colors</Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="calendar-sync">Calendar Sync</Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="steam-connect">Steam Connect</Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="api-testing">API Testing</Nav.Link>
              </Nav.Item>
            </Nav>
          </Col>
          <Col sm={10}>
            <Tab.Content>
              <Tab.Pane eventKey="theme-colors">
                <div className="mb-4">
                  <h3 className="mb-3">Theme Color Customization</h3>
                  {saveSuccess && (
                    <Alert variant="success" className="mb-3">
                      Theme colors saved successfully!
                    </Alert>
                  )}
                </div>

                <Row>
                  {Object.entries(themeColors).map(([themeKey, color]) => {
                    const shades = generateShades(color);
                    return (
                      <Col lg={4} md={6} key={themeKey} className="mb-4">
                        <Card>
                          <Card.Header>
                            <h5 className="mb-0">{themeKey} Theme</h5>
                          </Card.Header>
                          <Card.Body>
                            <Form.Group className="mb-3">
                              <Form.Label>Primary Color</Form.Label>
                              <div className="d-flex align-items-center">
                                <Form.Control
                                  type="color"
                                  value={color}
                                  onChange={(e) => handleColorChange(themeKey as keyof ThemeColors, e.target.value)}
                                  style={{ width: '50px', marginRight: '10px' }}
                                />
                                <Form.Control
                                  type="text"
                                  value={color}
                                  onChange={(e) => handleColorChange(themeKey as keyof ThemeColors, e.target.value)}
                                  placeholder="#000000"
                                />
                              </div>
                            </Form.Group>

                            <div className="mb-3">
                              <Form.Label>Material Design Shades</Form.Label>
                              <div 
                                className="p-3 rounded"
                                style={{ background: `linear-gradient(135deg, ${shades.lighter}, ${shades.primary}, ${shades.darker})` }}
                              >
                                <small className="text-white">Auto-generated shades for cards and backgrounds</small>
                              </div>
                            </div>

                            <div className="mb-3">
                              <Form.Label>Usage Preview</Form.Label>
                              <div className="d-flex gap-1 mb-2">
                                <span 
                                  className="badge"
                                  style={{ backgroundColor: shades.primary, color: 'white' }}
                                >
                                  {themeKey} Badge
                                </span>
                              </div>
                              <div 
                                className="p-3 rounded border"
                                style={{ 
                                  backgroundColor: shades.lighter,
                                  borderColor: shades.light,
                                  color: shades.darker
                                }}
                              >
                                Sample {themeKey} Card
                              </div>
                            </div>
                          </Card.Body>
                        </Card>
                      </Col>
                    );
                  })}
                </Row>

                <Row className="mt-4">
                  <Col>
                    <Card>
                      <Card.Header>
                        <h5 className="mb-0">Theme Usage Information</h5>
                      </Card.Header>
                      <Card.Body>
                        <h6>Where These Colors Apply</h6>
                        <ul className="mb-0">
                          <li><strong>Goals:</strong> Theme badges and progress indicators</li>
                          <li><strong>Stories:</strong> Theme-based card backgrounds and borders</li>
                          <li><strong>Tasks:</strong> Inherit theme colors from parent stories</li>
                          <li><strong>Calendar Blocks:</strong> Time block backgrounds and labels</li>
                          <li><strong>Dashboard:</strong> Theme-based statistics and charts</li>
                        </ul>
                      </Card.Body>
                    </Card>
                  </Col>
                </Row>

                <div className="d-flex justify-content-end gap-2 mt-4">
                  <Button variant="outline-secondary" onClick={resetToDefaults}>
                    Reset to Defaults
                  </Button>
                  <Button variant="primary" onClick={saveThemeColors}>
                    Save Colors
                  </Button>
                </div>
              </Tab.Pane>

              <Tab.Pane eventKey="calendar-sync">
                <CalendarSyncManager />
              </Tab.Pane>

              <Tab.Pane eventKey="steam-connect">
                <div className="mb-4">
                  <h3 className="mb-3">Steam Integration</h3>
                  <p className="text-muted">Connect your Steam account to import games and track gaming goals</p>
                </div>
                
                <Card>
                  <Card.Header>
                    <h5 className="mb-0">Steam Account Connection</h5>
                  </Card.Header>
                  <Card.Body>
                    <div className="text-center py-4">
                      <div className="mb-2">
                        <i className="fas fa-unlink fa-2x text-muted"></i>
                      </div>
                      <p className="text-muted">Steam integration coming soon...</p>
                      <small className="text-muted">
                        This will allow you to sync your Steam library to your personal backlog.
                      </small>
                    </div>
                  </Card.Body>
                </Card>
              </Tab.Pane>

              <Tab.Pane eventKey="api-testing">
                <div className="mb-4">
                  <h3 className="mb-3">API Testing</h3>
                  <p className="text-muted">Test various API integrations and connections</p>
                </div>
                
                <Card>
                  <Card.Header>
                    <h5 className="mb-0">Available API Tests</h5>
                  </Card.Header>
                  <Card.Body>
                    <div className="text-center py-4">
                      <p className="text-muted">API testing interface coming soon...</p>
                      <small className="text-muted">
                        This will include calendar sync testing, external integrations, and more.
                      </small>
                    </div>
                  </Card.Body>
                </Card>
              </Tab.Pane>
            </Tab.Content>
          </Col>
        </Row>
      </Tab.Container>
    </Container>
  );
};

export default ThemeColorManager;
