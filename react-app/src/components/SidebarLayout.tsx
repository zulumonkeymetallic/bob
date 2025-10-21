import React, { useState } from 'react';
import { Container, Nav, Navbar, Button, Offcanvas } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useTheme } from '../contexts/ThemeContext';
import VersionDisplay from './VersionDisplay';
import { useSprint } from '../contexts/SprintContext';
import SprintSelector from './SprintSelector';
import CompactSprintMetrics from './CompactSprintMetrics';
import AssistantDock from './AssistantDock';
// Test mode UI removed per request

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
  // const { isTestMode, toggleTestMode, testModeLabel } = useTestMode();
  const navigate = useNavigate();
  const [showSidebar, setShowSidebar] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('leftNavCollapsed') === '1'; } catch { return false; }
  });
  const toggleNavCollapsed = () => {
    setNavCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem('leftNavCollapsed', next ? '1' : '0'); } catch {}
      return next;
    });
  };
  const [expandedGroups, setExpandedGroups] = useState<string[]>(['Dashboards', 'Finance', 'Settings', 'Logs']);
  const { selectedSprintId: globalSprintId, setSelectedSprintId: setGlobalSprintId } = useSprint();
  const [assistantOpen, setAssistantOpen] = useState(false);

  const navigationGroups: NavigationGroup[] = [
    {
      label: 'Dashboards',
      icon: 'chart-bar',
      items: [
        { label: 'Overview', path: '/dashboard', icon: 'home' },
        { label: 'Kanban Board', path: '/sprints/kanban', icon: 'kanban' },
      ]
    },
    // Health
    {
      label: 'Health',
      icon: 'heartbeat',
      items: [
        { label: 'Running Results', path: '/running-results', icon: 'running' }
      ]
    },
    {
      label: 'Goals',
      icon: 'target',
      items: [
        { label: 'Goals List', path: '/goals', icon: 'list' },
        { label: 'Goals Roadmap', path: '/goals/roadmap', icon: 'project-diagram' },
        { label: 'Visual Canvas', path: '/canvas', icon: 'share-alt' }
      ]
    },
    {
      label: 'Finance',
      icon: 'piggy-bank',
      items: [
        { label: 'Finance Hub', path: '/finance', icon: 'piggy-bank' }
      ]
    },
    {
      label: 'Stories',
      icon: 'book',
      items: [
        { label: 'Stories List', path: '/stories', icon: 'list' },
        { label: 'Kanban Board', path: '/sprints/kanban', icon: 'kanban' }
      ]
    },
    {
      label: 'Backlog',
      icon: 'clipboard-list',
      items: [
        { label: 'Games', path: '/games-backlog', icon: 'gamepad' }
      ]
    },
    {
      label: 'Tasks',
      icon: 'list-check',
      items: [
        { label: 'Tasks List', path: '/tasks', icon: 'list' }
      ]
    },
    {
      label: 'Sprints',
      icon: 'calendar-alt',
      items: [
        { label: 'Sprint Management', path: '/sprints/management', icon: 'tasks' },
        { label: 'Sprint Kanban', path: '/sprints/kanban', icon: 'columns' },
        { label: 'Planning Matrix', path: '/sprints/planning', icon: 'th' }
      ]
    },
    {
      label: 'Calendar',
      icon: 'calendar',
      items: [
        { label: 'Unified Planner', path: '/calendar', icon: 'calendar' },
        { label: 'Google Integration', path: '/calendar/integration', icon: 'google' }
      ]
    },
    {
      label: 'Routines',
      icon: 'check-circle',
      items: [
        { label: 'Routines & Chores', path: '/routines', icon: 'clipboard-check' },
        { label: 'Daily Habits', path: '/habits', icon: 'check' },
        { label: 'Unified Planner', path: '/calendar', icon: 'calendar' },
        { label: 'Mobile Checklist', path: '/mobile-checklist', icon: 'mobile' }
      ]
    },
    {
      label: 'Travel',
      icon: 'globe',
      items: [
        { label: 'Travel Map', path: '/travel', icon: 'map' }
      ]
    },
    {
      label: 'Planning & AI',
      icon: 'cpu',
      items: [
        { label: 'AI Planner', path: '/ai-planner', icon: 'cpu' }
      ]
    },
    // (Removed Data Management per request)
    {
      label: 'Settings',
      icon: 'cog',
      items: [
        { label: 'Overview', path: '/settings', icon: 'sliders-h' },
        { label: 'Email & Notifications', path: '/settings/email', icon: 'envelope' },
        { label: 'Planner & Automations', path: '/settings/planner', icon: 'cogs' },
        { label: 'Google Calendar', path: '/settings/integrations/google', icon: 'google' },
        { label: 'Monzo', path: '/settings/integrations/monzo', icon: 'credit-card' },
        { label: 'Strava', path: '/settings/integrations/strava', icon: 'bicycle' },
        { label: 'Steam', path: '/settings/integrations/steam', icon: 'gamepad' },
        { label: 'Trakt', path: '/settings/integrations/trakt', icon: 'film' }
      ]
    },
    {
      label: 'Logs',
      icon: 'stream',
      items: [
        { label: 'Integration Logs', path: '/logs/integrations', icon: 'database' },
        { label: 'AI Diagnostics', path: '/logs/ai', icon: 'robot' }
      ]
    },
    // Removed duplicate Health group at bottom
  ];

  const handleNavigation = (path: string) => {
    try {
      console.info('[Sidebar] navigation requested', { path });
      navigate(path);
      setShowSidebar(false);
    } catch (error) {
      console.error('[Sidebar] navigation failed', { path, error });
    }
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
      {/* Desktop Sidebar (collapsible) */}
      {!navCollapsed && (
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
              {/* Removed Test/Prod toggle */}
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

            {/* App Version */}
            <div style={{ marginTop: '8px', textAlign: 'center' }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 600,
                border: '1px solid var(--notion-border)',
                background: 'var(--notion-hover)',
                color: 'var(--notion-text)'
              }}>
                <VersionDisplay variant="badge-only" showSessionInfo={false} />
              </span>
            </div>
          </div>
        </div>
      </div>
      )}

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
            <SprintSelector
              selectedSprintId={globalSprintId}
              onSprintChange={setGlobalSprintId}
            />
            {/* Test mode toggle removed */}
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

      {/* Global collapse/expand toggle */}
      <button
        type="button"
        className="btn btn-sm btn-light position-fixed"
        onClick={toggleNavCollapsed}
        style={{ top: 10, left: navCollapsed ? 10 : 260, zIndex: 2000, boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }}
        title={navCollapsed ? 'Show sidebar' : 'Hide sidebar'}
      >
        {navCollapsed ? '▶' : '◀'}
      </button>

      {/* Main Content Area */}
      <div className="flex-grow-1" style={{ paddingTop: window.innerWidth < 992 ? '60px' : '0' }}>
        {/* Desktop top toolbar with global Sprint selector */}
        <div className="d-none d-lg-block" style={{
          borderBottom: '1px solid var(--notion-border)',
          background: 'var(--notion-bg)'
        }}>
          <div className="container-fluid" style={{ padding: '8px 16px' }}>
            <div className="d-flex justify-content-end align-items-center gap-3">
              {/* Pending approvals badge */}
              {/* Lightweight import to avoid heavy planner deps here */}
              {(() => {
                const ApprovalsBadge = require('./planner/ApprovalsBadge').default;
                return <ApprovalsBadge />;
              })()}
              <Button size="sm" variant="outline-primary" onClick={() => setAssistantOpen(v => !v)}>
                {assistantOpen ? 'Hide Assistant' : 'Assistant'}
              </Button>
              {/* Metrics first, then selector so metrics appear to the left of the selector */}
              <CompactSprintMetrics selectedSprintId={globalSprintId} />
              <SprintSelector
                selectedSprintId={globalSprintId}
                onSprintChange={setGlobalSprintId}
              />
            </div>
          </div>
        </div>

        <main className="h-100">
          {children}
        </main>
        <AssistantDock open={assistantOpen} onClose={() => setAssistantOpen(false)} />
      </div>
    </div>
  );
};

export default SidebarLayout;

export {};
