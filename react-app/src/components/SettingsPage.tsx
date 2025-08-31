import React, { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

interface ThemeColors {
  Health: string;
  Growth: string;
  Wealth: string;
  Tribe: string;
  Home: string;
}

interface SettingsPageProps {}

const SettingsPage: React.FC<SettingsPageProps> = () => {
  const { theme, setTheme } = useTheme();
  const { currentUser } = useAuth();
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState(false);
  const [steamConnected, setSteamConnected] = useState(false);
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
    }

    // Load theme colors from Firebase
    if (currentUser) {
      const loadThemeColors = async () => {
        try {
          const docRef = doc(db, 'theme_colors', currentUser.uid);
          const docSnap = await getDoc(docRef);
          
          if (docSnap.exists()) {
            const data = docSnap.data();
            setThemeColors(prev => ({ ...prev, ...data.colors }));
          }
        } catch (error) {
          console.error('Error loading theme colors:', error);
        }
      };
      loadThemeColors();
    }
  }, [currentUser]);

  // Save settings to localStorage
  const saveSettings = () => {
    const settings = {
      notifications,
      autoSync,
      googleCalendarConnected,
      steamConnected,
      theme,
    };
    localStorage.setItem('bobSettings', JSON.stringify(settings));
  };

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    saveSettings();
  };

  const handleColorChange = async (colorTheme: keyof ThemeColors, newColor: string) => {
    const updatedColors = { ...themeColors, [colorTheme]: newColor };
    setThemeColors(updatedColors);

    // Save to Firebase
    if (currentUser) {
      try {
        const docRef = doc(db, 'theme_colors', currentUser.uid);
        await setDoc(docRef, {
          colors: updatedColors,
          updatedAt: serverTimestamp()
        });
      } catch (error) {
        console.error('Error saving theme colors:', error);
      }
    }
  };

  const handleGoogleCalendarConnect = async () => {
    // TODO: Implement Google Calendar OAuth flow
    console.log('Google Calendar OAuth flow will be implemented here');
    setGoogleCalendarConnected(!googleCalendarConnected);
    saveSettings();
  };

  const handleSteamConnect = async () => {
    // TODO: Implement Steam OpenID authentication
    console.log('Steam authentication flow will be implemented here');
    setSteamConnected(!steamConnected);
    saveSettings();
  };

  const handleNotificationToggle = () => {
    setNotifications(!notifications);
    saveSettings();
  };

  const handleAutoSyncToggle = () => {
    setAutoSync(!autoSync);
    saveSettings();
  };

  return (
    <div className="container-fluid py-4">
      <div className="row justify-content-center">
        <div className="col-md-8 col-lg-6">
          <div className="card">
            <div className="card-header">
              <h2 className="card-title mb-0">Settings</h2>
            </div>
            <div className="card-body">
              
              {/* Theme Settings */}
              <div className="settings-section mb-4">
                <h4 className="mb-3">Theme & Appearance</h4>
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
                
                {/* Color Theme Settings */}
                <div className="mb-3">
                  <label className="form-label">Color Themes</label>
                  <div className="row g-2">
                    {Object.entries(themeColors).map(([themeName, color]) => (
                      <div key={themeName} className="col-md-6">
                        <div className="d-flex align-items-center gap-2">
                          <input
                            type="color"
                            className="form-control form-control-color"
                            value={color}
                            onChange={(e) => handleColorChange(themeName as keyof ThemeColors, e.target.value)}
                            title={`Choose ${themeName} color`}
                          />
                          <label className="form-label mb-0">{themeName}</label>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="form-text">
                    Customize colors for your goal themes
                  </div>
                </div>
              </div>

              {/* Integration Settings */}
              <div className="settings-section mb-4">
                <h4 className="mb-3">Integrations</h4>
                
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

              {/* General Settings */}
              <div className="settings-section mb-4">
                <h4 className="mb-3">General</h4>
                
                <div className="form-check form-switch mb-3">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="notificationsToggle"
                    checked={notifications}
                    onChange={handleNotificationToggle}
                  />
                  <label className="form-check-label" htmlFor="notificationsToggle">
                    <strong>Enable Notifications</strong>
                    <br />
                    <small className="text-muted">
                      Get notified about task deadlines and sprint updates
                    </small>
                  </label>
                </div>

                <div className="form-check form-switch mb-3">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="autoSyncToggle"
                    checked={autoSync}
                    onChange={handleAutoSyncToggle}
                  />
                  <label className="form-check-label" htmlFor="autoSyncToggle">
                    <strong>Auto-sync Integrations</strong>
                    <br />
                    <small className="text-muted">
                      Automatically sync with connected services every 15 minutes
                    </small>
                  </label>
                </div>
              </div>

              {/* Account Settings */}
              <div className="settings-section">
                <h4 className="mb-3">Account</h4>
                <div className="alert alert-info">
                  <h6>Data Export & Import</h6>
                  <p className="mb-2">Export your data or import from backup files.</p>
                  <div className="d-flex gap-2">
                    <button className="btn btn-sm btn-outline-primary">
                      Export Data
                    </button>
                    <button className="btn btn-sm btn-outline-secondary">
                      Import Data
                    </button>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;

export {};
