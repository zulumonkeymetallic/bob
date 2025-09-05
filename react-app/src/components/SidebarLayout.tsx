import React, { useState } from 'react';
import { Container, Nav, Navbar, Button, Offcanvas } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useTheme } from '../contexts/ThemeContext';
import { useTestMode } from '../contexts/TestModeContext';

interface SidebarLayoutProps {
  children: React.ReactNode;
  onSignOut?: () => Promise<void>;
}

interface NavigationGroup {
  label: string;
  items: NavigationItem[];
  icon: string;
}

interface NavigationItem {
  label: string;
  path: string;
  icon: string;
}

const SidebarLayout: React.FC<SidebarLayoutProps> = ({ children, onSignOut }) => {
  const { currentUser, signOut } = useAuth();
  const { currentPersona, setPersona } = usePersona();
  const { theme, toggleTheme } = useTheme();
  const { isTestMode, toggleTestMode, testModeLabel } = useTestMode();
  const navigate = useNavigate();
  const [showSidebar, setShowSidebar] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<string[]>(['Dashboards']);

  const navigationGroups: NavigationGroup[] = [
    {
      label: 'Dashboards',
      icon: 'chart-bar',
      items: [
        { label: 'Overview Dashboard', path: '/dashboard', icon: 'home' },
        { label: 'Sprint Dashboard', path: '/sprint-dashboard', icon: 'chart-line' }
      ]
    },
    {
      label: 'Goals & Planning',
      icon: 'target',
      items: [
        { label: 'Goals Management', path: '/goals', icon: 'target' },
        { label: 'AI Planner', path: '/ai-planner', icon: 'cpu' },
        { label: 'Visual Canvas', path: '/canvas', icon: 'share-alt' }
      ]
    },
    {
      label: 'Sprint & Execution',
      icon: 'calendar-alt',
      items: [
        { label: 'Kanban Board', path: '/kanban', icon: 'kanban' },
        { label: 'Sprint Kanban', path: '/sprints/kanban', icon: 'columns' },
        { label: 'Calendar', path: '/calendar', icon: 'calendar' }
      ]
    },
    {
      label: 'Data Management',
      icon: 'list',
      items: [
        { label: 'Stories', path: '/stories', icon: 'book' },
        { label: 'Tasks', path: '/task-list', icon: 'list-check' },
        { label: 'Personal Lists', path: '/personal-lists-modern', icon: 'bookmark' }
      ]
    },
    {
      label: 'Visualization',
      icon: 'share-alt',
      items: [
        { label: 'Sprint Planning Matrix', path: '/sprints/planning', icon: 'th' }
      ]
    },
    {
      label: 'System',
      icon: 'cog',
      items: [
        { label: 'Settings', path: '/theme-colors', icon: 'cog' },
        { label: 'Test Suite', path: '/test', icon: 'vial' },
        { label: 'Changelog', path: '/changelog', icon: 'file-text' }
      ]
    }
  ];

  const handleNavigation = (path: string) => {
    navigate(path);
    setShowSidebar(false);
  };

  const toggleGroup = (groupLabel: string) => {
    setExpandedGroups(prev => 
      prev.includes(groupLabel) 
        ? prev.filter(g => g !== groupLabel)
        : [...prev, groupLabel]
    );
  };

  return (
    <div className="d-flex" style={{ minHeight: '100vh' }}>
      {/* Desktop Sidebar */}
      <div className="sidebar-desktop d-none d-lg-block" style={{ width: '250px', minHeight: '100vh' }}>
        <div className="h-100 d-flex flex-column" style={{ 
          background: 'var(--panel)', 
          color: 'var(--notion-text)',
          borderRight: '1px solid var(--notion-border)',
          maxHeight: '100vh',
          overflow: 'hidden'
        }}>
          {/* Brand */}
          <div className="p-3" style={{ borderBottom: '1px solid var(--notion-border)', flexShrink: 0 }}>
            <h4 className="mb-1" style={{ color: 'var(--notion-text)', fontWeight: '600' }}>BOB</h4>
            <small style={{ color: 'var(--notion-text-gray)' }}>Productivity Platform</small>
          </div>

          {/* User Info */}
          {currentUser && (
            <div className="p-3" style={{ borderBottom: '1px solid var(--notion-border)', flexShrink: 0 }}>
              <div className="d-flex align-items-center mb-2">
                <div className="rounded-circle d-flex align-items-center justify-content-center me-2" 
                     style={{ 
                       width: '32px', 
                       height: '32px', 
                       fontSize: '14px',
                       background: 'var(--notion-accent)',
                       color: 'white'
                     }}>
                  {currentUser.displayName?.charAt(0) || 'U'}
                </div>
                <div className="flex-grow-1">
                  <div className="small" style={{ color: 'var(--notion-text)' }}>
                    {currentUser.displayName || 'User'}
                  </div>
                  <div className="badge" style={{ 
                    background: 'var(--notion-accent)', 
                    color: 'white',
                    fontSize: '0.75rem'
                  }}>
                    {currentPersona}
                  </div>
                </div>
              </div>
              <div className="d-flex gap-1">
                <Button 
                  size="sm" 
                  variant={currentPersona === 'personal' ? 'primary' : 'outline-primary'}
                  onClick={() => setPersona('personal')}
                  className="flex-fill"
                >
                  Personal
                </Button>
                <Button 
                  size="sm" 
                  variant={currentPersona === 'work' ? 'primary' : 'outline-primary'}
                  onClick={() => setPersona('work')}
                  className="flex-fill"
                >
                  Work
                </Button>
              </div>
            </div>
          )}

          {/* Navigation - Scrollable */}
          <div className="flex-grow-1" style={{ 
            overflowY: 'auto', 
            overflowX: 'hidden',
            scrollbarWidth: 'thin',
            msOverflowStyle: 'scrollbar'
          }}>
            <Nav className="flex-column py-2">{navigationGroups.map((group) => (
                <div key={group.label} className="mb-2">
                  {/* Group Header */}
                  <div
                    className="d-flex align-items-center justify-content-between px-3 py-2 cursor-pointer"
                    onClick={() => toggleGroup(group.label)}
                    style={{ 
                      cursor: 'pointer', 
                      fontSize: '0.9rem', 
                      fontWeight: '600',
                      color: 'var(--notion-text-gray)',
                      borderRadius: '6px',
                      margin: '0 8px',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--notion-hover)';
                      e.currentTarget.style.color = 'var(--notion-text)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = 'var(--notion-text-gray)';
                    }}
                  >
                    <div className="d-flex align-items-center">
                      <i className={`fas fa-${group.icon} me-2`}></i>
                      {group.label}
                    </div>
                    <i className={`fas fa-chevron-${expandedGroups.includes(group.label) ? 'down' : 'right'}`}></i>
                  </div>
                  
                  {/* Group Items */}
                  {expandedGroups.includes(group.label) && (
                    <div className="ms-2">
                      {group.items.map((item) => (
                        <Nav.Link
                          key={item.path}
                          className="px-3 py-2 border-0 text-start"
                          onClick={() => handleNavigation(item.path)}
                          style={{ 
                            cursor: 'pointer', 
                            fontSize: '0.9rem',
                            color: 'var(--notion-text)',
                            borderRadius: '6px',
                            margin: '2px 8px',
                            display: 'block',
                            textDecoration: 'none',
                            transition: 'all 0.15s ease'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--notion-hover)';
                            e.currentTarget.style.color = 'var(--notion-accent)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.color = 'var(--notion-text)';
                          }}
                        >
                          <i className={`fas fa-${item.icon} me-2`}></i>
                          {item.label}
                        </Nav.Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </Nav>
          </div>

          {/* Bottom Actions - Now Sticky */}
          <div 
            className="p-3" 
            style={{ 
              borderTop: '1px solid var(--notion-border)',
              position: 'sticky',
              bottom: 0,
              background: 'var(--notion-bg)',
              zIndex: 10
            }}
          >
            <div className="d-flex gap-2 mb-2">
              <Button 
                size="sm" 
                onClick={toggleTheme}
                className="flex-fill"
                style={{
                  background: 'var(--notion-hover)',
                  border: '1px solid var(--notion-border)',
                  color: 'var(--notion-text)',
                  borderRadius: '6px'
                }}
              >
                {theme === 'light' ? 'Dark' : 'Light'} Mode
              </Button>
              <Button
                size="sm"
                onClick={toggleTestMode}
                className="flex-fill"
                style={{
                  background: isTestMode ? '#ff6b6b' : 'var(--notion-hover)',
                  border: `1px solid ${isTestMode ? '#ff6b6b' : 'var(--notion-border)'}`,
                  color: isTestMode ? 'white' : 'var(--notion-text)',
                  borderRadius: '6px'
                }}
                title={`Switch to ${isTestMode ? 'Production' : 'Test'} Mode`}
              >
                {isTestMode ? '🧪 TEST' : '🏭 PROD'}
              </Button>
            </div>
            <Button 
              size="sm" 
              onClick={onSignOut || signOut}
              className="w-100"
              style={{
                background: 'transparent',
                border: '1px solid var(--notion-border)',
                color: 'var(--notion-text)',
                borderRadius: '6px'
              }}
            >
              Sign Out
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Header */}
      <div className="d-lg-none fixed-top bg-dark">
        <Navbar variant="dark" className="px-3">
          <Button 
            variant="outline-light" 
            size="sm"
            onClick={() => setShowSidebar(true)}
          >
            Menu
          </Button>
          <Navbar.Brand className="mx-auto">
            BOB
            {isTestMode && (
              <span style={{ 
                marginLeft: '8px', 
                fontSize: '10px', 
                backgroundColor: '#ff6b6b', 
                color: 'white', 
                padding: '2px 6px', 
                borderRadius: '8px',
                fontWeight: 'bold'
              }}>
                TEST
              </span>
            )}
          </Navbar.Brand>
          <div className="d-flex align-items-center gap-2">
            <Button
              variant={isTestMode ? "danger" : "outline-secondary"}
              size="sm"
              onClick={toggleTestMode}
              style={{ fontSize: '10px', padding: '2px 6px' }}
              title={`Switch to ${isTestMode ? 'Production' : 'Test'} Mode`}
            >
              {isTestMode ? '🧪' : '🏭'}
            </Button>
            {currentUser && (
              <div className="rounded-circle bg-primary d-flex align-items-center justify-content-center" 
                   style={{ width: '24px', height: '24px', fontSize: '12px' }}>
                {currentUser.displayName?.charAt(0) || 'U'}
              </div>
            )}
          </div>
        </Navbar>
      </div>

      {/* Mobile Sidebar Offcanvas */}
      <Offcanvas 
        show={showSidebar} 
        onHide={() => setShowSidebar(false)} 
        placement="start"
        className="bg-dark text-white"
      >
        <Offcanvas.Header closeButton closeVariant="white">
          <Offcanvas.Title>BOB Platform</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {/* User Info Mobile */}
          {currentUser && (
            <div className="mb-3 pb-3 border-bottom border-secondary">
              <div className="d-flex align-items-center mb-2">
                <div className="rounded-circle bg-primary d-flex align-items-center justify-content-center me-2" 
                     style={{ width: '32px', height: '32px', fontSize: '14px' }}>
                  {currentUser.displayName?.charAt(0) || 'U'}
                </div>
                <div>
                  <div className="text-white">
                    {currentUser.displayName || 'User'}
                  </div>
                  <small className="text-muted">
                    {currentPersona} persona
                  </small>
                </div>
              </div>
              <div className="d-flex gap-1">
                <Button 
                  size="sm" 
                  variant={currentPersona === 'personal' ? 'primary' : 'outline-primary'}
                  onClick={() => setPersona('personal')}
                  className="flex-fill"
                >
                  Personal
                </Button>
                <Button 
                  size="sm" 
                  variant={currentPersona === 'work' ? 'primary' : 'outline-primary'}
                  onClick={() => setPersona('work')}
                  className="flex-fill"
                >
                  Work
                </Button>
              </div>
            </div>
          )}

          {/* Navigation Mobile */}
          <Nav className="flex-column">
            {navigationGroups.map((group) => (
              <div key={group.label} className="mb-2">
                {/* Group Header Mobile */}
                <div
                  className="d-flex align-items-center justify-content-between px-3 py-2 text-white-50"
                  onClick={() => toggleGroup(group.label)}
                  style={{ cursor: 'pointer', fontSize: '0.9rem', fontWeight: '600' }}
                >
                  <div className="d-flex align-items-center">
                    <i className={`fas fa-${group.icon} me-2`}></i>
                    {group.label}
                  </div>
                  <i className={`fas fa-chevron-${expandedGroups.includes(group.label) ? 'down' : 'right'}`}></i>
                </div>
                
                {/* Group Items Mobile */}
                {expandedGroups.includes(group.label) && (
                  <div className="ms-3">
                    {group.items.map((item) => (
                      <Nav.Link
                        key={item.path}
                        className="text-white py-2 border-0"
                        onClick={() => handleNavigation(item.path)}
                        style={{ fontSize: '0.9rem' }}
                      >
                        <i className={`fas fa-${item.icon} me-2`}></i>
                        {item.label}
                      </Nav.Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </Nav>

          {/* Bottom Actions Mobile - Now Sticky */}
          <div 
            className="mt-auto pt-3 border-top border-secondary"
            style={{
              position: 'sticky',
              bottom: 0,
              background: 'var(--bs-dark)',
              zIndex: 10,
              marginTop: 'auto !important'
            }}
          >
            <div className="d-flex gap-2 mb-2">
              <Button 
                variant="outline-light" 
                size="sm" 
                onClick={toggleTheme}
                className="flex-fill"
              >
                {theme === 'light' ? 'Dark' : 'Light'} Mode
              </Button>
            </div>
            <Button 
              variant="outline-danger" 
              size="sm" 
              onClick={signOut}
              className="w-100"
            >
              Sign Out
            </Button>
          </div>
        </Offcanvas.Body>
      </Offcanvas>

      {/* Main Content Area */}
      <div className="flex-grow-1" style={{ paddingTop: window.innerWidth < 992 ? '60px' : '0' }}>
        <main className="h-100">
          {children}
        </main>
      </div>
    </div>
  );
};

export default SidebarLayout;

export {};
