import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Form, Modal, Alert, Nav, Tab } from 'react-bootstrap';
import { db } from '../firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';

interface ThemeColors {
  Health: string;
  Growth: string;
  Wealth: string;
  Tribe: string;
  Home: string;
}

const ThemeColorManager: React.FC = () => {
  const { currentUser } = useAuth();
  const { theme } = useTheme();
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState<keyof ThemeColors | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Default theme colors (Material Design inspired)
  const [themeColors, setThemeColors] = useState<ThemeColors>({
    Health: '#e53e3e', // Red
    Growth: '#3182ce', // Blue  
    Wealth: '#38a169', // Green
    Tribe: '#805ad5', // Purple
    Home: '#d69e2e'   // Orange/Yellow
  });

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

  return (
    <Container className="mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>Settings</h2>
      </div>

      <Tab.Container defaultActiveKey="theme-colors">
        <Row>
          <Col sm={3}>
            <Nav variant="pills" className="flex-column">
              <Nav.Item>
                <Nav.Link eventKey="theme-colors">Theme Colors</Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="integrations">Integrations</Nav.Link>
              </Nav.Item>
            </Nav>
          </Col>
          <Col sm={9}>
            <Tab.Content>
              <Tab.Pane eventKey="theme-colors">
                {saveSuccess && (
                  <Alert variant="success" className="mb-3">
                    Theme colors saved successfully!
                  </Alert>
                )}

                <Card>
                  <Card.Header>
                    <h5 className="mb-0">Life Theme Colors</h5>
                  </Card.Header>
                  <Card.Body>
                    <Row>
                      {Object.entries(themeColors).map(([themeKey, color]) => (
                        <Col md={6} key={themeKey} className="mb-3">
                          <Form.Group>
                            <Form.Label>{themeKey}</Form.Label>
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
                        </Col>
                      ))}
                    </Row>
                    
                    <div className="d-flex justify-content-end mt-3">
                      <Button variant="primary" onClick={saveThemeColors}>
                        Save Theme Colors
                      </Button>
                    </div>
                  </Card.Body>
                </Card>
              </Tab.Pane>

              <Tab.Pane eventKey="integrations">
                <Card>
                  <Card.Header>
                    <h5 className="mb-0">External Integrations</h5>
                  </Card.Header>
                  <Card.Body>
                    <div className="text-center py-4">
                      <p className="text-muted">Integration settings coming soon...</p>
                      <small className="text-muted">
                        This will include Steam library sync, calendar integration, and more.
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
