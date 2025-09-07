import React, { useState } from 'react';
import { Container, Nav, Navbar, Button, Offcanvas } from 'react-bootstrap';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useTheme } from '../contexts/ModernThemeContext';
import { useActivityTracking } from '../hooks/useActivityTracking';
import StickySignOut from './StickySignOut';
import ThemeToggle from './ThemeToggle';
import SprintSelector from './SprintSelector';
import CompactSprintMetrics from './CompactSprintMetrics';
import { isStatus, isTheme } from '../utils/statusHelpers';

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
  const { currentUser, signOut, isTestUser } = useAuth();
  const { currentPersona, setPersona } = usePersona();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { trackClick } = useActivityTracking();
  const [showSidebar, setShowSidebar] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<string[]>(['Overview', 'Goals']);
  const [selectedSprintId, setSelectedSprintId] = useState<string>('');
  
  // Check if side-door test mode is active
  // const isSideDoorActive = SideDoorAuth.isTestModeActive();
  const isSideDoorActive = false;

  const navigationGroups: NavigationGroup[] = [
    // Overview at the top
    {
      label: 'Overview',
      icon: 'home',
      items: [
        { label: 'Dashboard', path: '/dashboard', icon: 'home' },
        { label: 'Kanban Board', path: '/sprints/kanban', icon: 'columns' }
      ]
    },
    // Goals section
    {
      label: 'Goals',
      icon: 'target',
      items: [
        { label: 'Goals Table', path: '/goals', icon: 'table' },
        { label: 'Goals Gantt Chart', path: '/goals/roadmap', icon: 'timeline' },
        { label: 'Goals Visual Canvas', path: '/canvas', icon: 'share-alt' }
      ]
    },
    // Stories section  
    {
      label: 'Stories',
      icon: 'book',
      items: [
        { label: 'Stories Table', path: '/stories', icon: 'table' },
        { label: 'Stories Kanban', path: '/enhanced-kanban', icon: 'columns' }
      ]
    },
    // Tasks section
    {
      label: 'Tasks',
      icon: 'list-check',
      items: [
        { label: 'Tasks Table', path: '/task-list', icon: 'table' },
        { label: 'Tasks Management', path: '/tasks-management', icon: 'cog' }
      ]
    },
    // Sprints section
    {
      label: 'Sprints',
      icon: 'chart-gantt',
      items: [
        { label: 'Sprints Management', path: '/sprints/management', icon: 'table' },
        { label: 'Sprint Dashboard', path: '/sprint-dashboard', icon: 'chart-line' }
      ]
    },
    // Planning & Tools
    {
      label: 'Planning & Tools',
      icon: 'cpu',
      items: [
        { label: 'AI Planner', path: '/ai-planner', icon: 'cpu' },
        { label: 'Calendar', path: '/calendar', icon: 'calendar-alt' },
        { label: 'Calendar Blocks', path: '/calendar-blocks', icon: 'calendar' },
        { label: 'Calendar Integration', path: '/calendar/integration', icon: 'calendar-sync' },
        { label: 'Routes & Routines', path: '/routes', icon: 'route' }
      ]
    },
    // System & Settings
    {
      label: 'System & Settings',
      icon: 'cog',
      items: [
        { label: 'Personal Lists', path: '/personal-lists-modern', icon: 'bookmark' },
        { label: 'Mobile View', path: '/mobile-view', icon: 'mobile-alt' },
        { label: 'Settings', path: '/theme-colors', icon: 'cog' },
        { label: 'AI Usage Analytics', path: '/ai-usage', icon: 'chart-pie' },
        { label: 'Developer Status', path: '/admin', icon: 'code' },
        { label: 'Test Suite', path: '/test', icon: 'vial' },
        { label: 'Changelog', path: '/changelog', icon: 'file-text' }
      ]
    }
  ];

    const handleNavigation = (path: string) => {
    console.log('🔀 BOB v3.1.4: COMPLETE NAVIGATION REBUILD - Navigating to:', path);
    console.log('🔀 Current URL:', window.location.pathname);
    console.log('🔀 React Router location:', location.pathname);
    
    // Track navigation with activity tracking
    trackClick({
      elementId: `nav-link-${path.replace('/', '')}`,
      elementType: 'link',
      entityId: 'navigation',
      entityType: 'work_project',
      entityTitle: `Navigate to ${path}`,
      additionalData: { 
        from: location.pathname,
        to: path,
        action: 'sidebar_navigation',
        timestamp: new Date().toISOString()
      }
    });
    
    // COMPLETE NAVIGATION REBUILD - Multiple fallback strategies
    console.log('🔀 STRATEGY 1: React Router navigate with state reset');
    
    // Close sidebar immediately
    setShowSidebar(false);
    
    // Strategy 1: Try React Router with forced state
    try {
      navigate(path, { 
        replace: true,
        state: { 
          forceRefresh: Date.now(),
          timestamp: new Date().toISOString(),
          source: 'sidebar_navigation'
        }
      });
      
      // Strategy 2: If same path, use window location
      setTimeout(() => {
        if (window.location.pathname !== path) {
          console.log('🔀 STRATEGY 2: Window location redirect');
          window.location.href = window.location.origin + path;
        }
      }, 100);
      
    } catch (error) {
      console.error('🔀 Navigation error, using fallback:', error);
      // Strategy 3: Direct window location as fallback
      window.location.href = window.location.origin + path;
    }
    
    console.log('🔀 Navigation triggered with multi-strategy approach');
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
      <div className="sidebar-desktop d-none d-lg-block" style={{ 
        width: '250px', 
        minHeight: '100vh',
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 1000,
        overflowY: 'auto',
        overflowX: 'hidden',
        scrollBehavior: 'smooth'
      }}>
        <div className="h-100 d-flex flex-column" style={{ 
          background: 'var(--panel)', 
          color: 'var(--notion-text)',
          borderRight: '1px solid var(--notion-border)',
          minHeight: '100vh'
        }}>
          {/* Brand */}
          <div className="p-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--notion-border)' }}>
            <div className="d-flex align-items-center justify-content-between">
              <div>
                <h4 className="mb-1" style={{ color: 'var(--notion-text)', fontWeight: '600' }}>BOB</h4>
                <small style={{ color: 'var(--notion-text-gray)' }}>Productivity Platform</small>
              </div>
              {(isSideDoorActive || isTestUser) && (
                <div 
                  className="badge"
                  style={{ 
                    background: '#ff6b6b', 
                    color: 'white',
                    fontSize: '0.7rem',
                    padding: '4px 8px'
                  }}
                  title="Test Mode Active - Side Door Authentication"
                >
                  🧪 TEST
                </div>
              )}
            </div>
          </div>

          {/* User Info */}
          {currentUser && (
            <div className="p-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--notion-border)' }}>
              <div className="d-flex align-items-center mb-2">
                <div className="rounded-circle d-flex align-items-center justify-content-center me-2" 
                     style={{ 
                       width: '32px', 
                       height: '32px', 
                       fontSize: '14px',
                       background: 'var(--notion-accent)',
                       color: theme.colors.onPrimary
                     }}>
                  {currentUser.displayName?.charAt(0) || 'U'}
                </div>
                <div className="flex-grow-1">
                  <div className="small" style={{ color: 'var(--notion-text)' }}>
                    {currentUser.displayName || 'User'}
                  </div>
                  <div className="badge" style={{ 
                    background: 'var(--notion-accent)', 
                    color: theme.colors.onPrimary,
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

          {/* Navigation - Scrollable Area */}
          <div className="flex-grow-1" style={{ 
            overflowY: 'auto',
            overflowX: 'hidden',
            scrollBehavior: 'smooth',
            maxHeight: 'calc(100vh - 200px)', // Reduced from 280px to allow more scroll space
            minHeight: '400px' // Ensure minimum scrollable area
          }}>
            <Nav className="flex-column">
              {navigationGroups.map((group) => (
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

          {/* Sticky Sign Out with Theme Toggle */}
          <div style={{ 
            borderTop: `1px solid ${theme.colors.border}`,
            padding: '12px 16px',
            background: theme.colors.surface
          }}>
            {/* Theme Toggle */}
            <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'center' }}>
              <ThemeToggle variant="dropdown" showLabel={true} />
            </div>
            
            {/* Sticky Sign Out Component */}
            <StickySignOut 
              onSignOut={onSignOut || signOut}
              showVersion={true}
            />
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
          </Navbar.Brand>
          <div className="d-flex align-items-center gap-2">
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
        className="bg-dark"
        style={{ color: theme.colors.onBackground }}
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
                  <div style={{ color: theme.colors.onBackground }}>
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
                  className="d-flex align-items-center justify-content-between px-3 py-2"
                  onClick={() => toggleGroup(group.label)}
                  style={{ cursor: 'pointer', fontSize: '0.9rem', fontWeight: '600', color: theme.colors.secondary }}
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
                        className="py-2 border-0"
                        onClick={() => handleNavigation(item.path)}
                        style={{ fontSize: '0.9rem', color: theme.colors.onBackground }}
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

          {/* Bottom Actions Mobile */}
          <div className="mt-auto pt-3 border-top border-secondary">
            <Button 
              size="sm" 
              onClick={signOut}
              className="w-100 btn-signout"
              style={{
                background: '#dc3545',
                border: '1px solid #dc3545',
                color: 'white'
              }}
            >
              Sign Out
            </Button>
            
            {/* Theme Toggle and Sign Out Mobile */}
            <div style={{ marginTop: '20px' }}>
              <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'center' }}>
                <ThemeToggle variant="dropdown" showLabel={true} />
              </div>
              <StickySignOut 
                onSignOut={onSignOut || signOut}
                showVersion={true}
              />
            </div>
          </div>
        </Offcanvas.Body>
      </Offcanvas>

      {/* Main Content Area */}
      <div className="flex-grow-1" style={{ 
        paddingTop: window.innerWidth < 992 ? '60px' : '0',
        marginLeft: window.innerWidth >= 992 ? '250px' : '0'
      }}>
        {/* Top Header with Sprint Selector and Metrics */}
        <div className="border-bottom px-3 py-2 d-flex justify-content-between align-items-center" 
             style={{ 
               position: 'sticky', 
               top: '0', 
               zIndex: 1000,
               backgroundColor: theme.colors.surface,
               borderBottomColor: theme.isDark ? '#374151' : '#e5e7eb',
               color: theme.colors.primary
             }}>
          <div className="d-flex align-items-center">
            <h6 className="mb-0 text-muted">Current Context</h6>
          </div>
          <div className="d-flex align-items-center gap-3">
            <CompactSprintMetrics
              selectedSprintId={selectedSprintId}
              className="me-2"
            />
            <SprintSelector
              selectedSprintId={selectedSprintId}
              onSprintChange={setSelectedSprintId}
              className="ms-2"
            />
          </div>
        </div>
        
        <main className="h-100">
          {children}
        </main>
      </div>
    </div>
  );
};

export default SidebarLayout;

export {};
