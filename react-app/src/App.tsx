import React, { useState, useEffect } from 'react';
import { Button } from 'react-bootstrap';
import { Routes, Route, BrowserRouter as Router, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import TaskListView from './components/TaskListView';
import GoalsManagement from './components/GoalsManagement';
import Admin from './components/Admin';
import KanbanPage from './components/KanbanPage';
import ModernKanbanPage from './components/ModernKanbanPage';
import TasksList from './components/TasksList';
import PlanningDashboard from './components/PlanningDashboard';
import Calendar from './components/CalendarDnDView';
import BacklogManager from './components/BacklogManager';
import VisualCanvas from './components/VisualCanvas';
import StoriesManagement from './components/StoriesManagement';
import PersonalListsManagement from './components/PersonalListsManagement';
import MobilePriorityDashboard from './components/MobilePriorityDashboard';
// import ModernTableDemo from './components/ModernTableDemo';
import FloatingActionButton from './components/FloatingActionButton';
import ImportExportModal from './components/ImportExportModal';
import SidebarLayout from './components/SidebarLayout';
import SettingsPage from './components/SettingsPage';
import LoginPage from './components/LoginPage';
import ErrorBoundary from './components/ErrorBoundary';
import { useTheme } from './contexts/ThemeContext';
import { useAuth } from './contexts/AuthContext';
import { PersonaProvider } from './contexts/PersonaContext';
import { SprintProvider } from './contexts/SprintContext';
import { SidebarProvider } from './contexts/SidebarContext';

// Import theme-aware styles
import './styles/theme-aware.css';
import { TestModeProvider } from './contexts/TestModeContext';
import PersonaSwitcher from './components/PersonaSwitcher';
import GlobalSidebar from './components/GlobalSidebar';
import { useDeviceInfo } from './utils/deviceDetection';
import { checkForUpdates, VERSION } from './version';
// import { versionTimeoutService } from './services/versionTimeoutService';
import SprintPlannerSimple from './components/SprintPlannerSimple';
import { clickTrackingService } from './services/ClickTrackingService';
import logger from './utils/logger';

// BOB v3.5.2 - New Scaffolding Components
import EnhancedGanttChart from './components/visualization/EnhancedGanttChart';
import CalendarIntegrationView from './components/calendar/CalendarIntegrationView';
import SprintManagementView from './components/sprints/SprintManagementView';
import SprintsPage from './components/sprints/SprintsPage';
import SprintTablePage from './components/sprints/SprintTablePage';
import RoutesManagementView from './components/routes/RoutesManagementView';
import CurrentSprintKanban from './components/CurrentSprintKanban';
import CalendarBlockManagerNew from './components/CalendarBlockManagerNew';
import MobileView from './components/MobileView';
import MobileChecklistView from './components/MobileChecklistView';
import ChoresManagement from './components/ChoresManagement';
import HabitsManagement from './components/HabitsManagement';
import AIUsageDashboard from './components/AIUsageDashboard';
import SprintPlannerMatrix from './components/SprintPlannerMatrix';
import MigrationManager from './components/MigrationManager';
import GoalVizPage from './components/visualization/GoalVizPage';
import ThemeRoadmap from './components/visualization/ThemeRoadmap';
import GoalRoadmapV3 from './components/visualization/GoalRoadmapV3';
import SprintKanbanPage from './components/SprintKanbanPage';
import TasksManagement from './components/TasksManagement';
import TravelMap from './components/travel/TravelMap';
import SprintPlanningMatrix from './components/SprintPlanningMatrix';
import WorkoutsDashboard from './components/WorkoutsDashboard';

function App() {
  return (
    <TestModeProvider>
      <PersonaProvider>
        <SprintProvider>
          <SidebarProvider>
            <Router>
              <AppContent />
            </Router>
          </SidebarProvider>
        </SprintProvider>
      </PersonaProvider>
    </TestModeProvider>
  );
}

function AppContent() {
  const { theme, toggleTheme } = useTheme();
  const { currentUser, signInWithGoogle, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const deviceInfo = useDeviceInfo();
  const [isNavExpanded, setIsNavExpanded] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [forceRender, setForceRender] = useState(0);
  
  // Data for the global sidebar
  const [goals, setGoals] = useState([]);
  const [stories, setStories] = useState([]);
  const [sprints, setSprints] = useState([]);

  // 🖱️ Initialize global click tracking service
  useEffect(() => {
    logger.info('global', 'Initializing click tracking');
    clickTrackingService.initialize();
    return () => {
      logger.info('global', 'Cleaning up click tracking');
      clickTrackingService.destroy();
    };
  }, []);

  // Debug location changes and force re-render
  useEffect(() => {
    logger.debug('nav', 'Location change', { path: location.pathname, key: location.key });
    setForceRender(prev => prev + 1);
  }, [location.pathname, location.key]);

  // Auto-route to mobile checklist on mobile devices when landing on dashboard/home
  useEffect(() => {
    if (!currentUser) return;
    const isMobile = deviceInfo?.isMobile;
    const path = location.pathname;
    const onHome = path === '/' || path === '/dashboard';
    const alreadyMobile = path.startsWith('/mobile');
    if (isMobile && onHome && !alreadyMobile) {
      navigate('/mobile-checklist', { replace: true });
    }
  }, [currentUser, deviceInfo?.isMobile, location.pathname]);

  // Check for updates on app load and initialize version timeout service
  useEffect(() => {
    // Initialize enhanced version timeout service
    logger.info('global', 'Initializing Version Timeout Service');
    // versionTimeoutService.forceVersionCheck(); // Temporarily disabled to fix cache loop
    
    // Legacy update check as fallback
    checkForUpdates();
    
    // Add keyboard shortcut for force refresh (Ctrl+Shift+R or Cmd+Shift+R)
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'R') {
        event.preventDefault();
        logger.info('global', 'Force refresh triggered by keyboard shortcut');
        
        // Clear all caches and reload
        if ('caches' in window) {
          caches.keys().then(names => {
            names.forEach(name => caches.delete(name));
          });
        }
        
        // Clear service worker cache
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistrations().then(registrations => {
            registrations.forEach(registration => registration.unregister());
          });
        }
        
        window.location.reload();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    
    // Cleanup function
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      // versionTimeoutService.destroy(); // Temporarily disabled to fix cache loop
    };
  }, []);

  if (!currentUser) {
    return <LoginPage />;
  }

  const handleSignOut = async () => {
    try {
      await signOut();
      console.log('Sign out successful');
    } catch (error) {
      console.error('Sign out failed:', error);
    }
  };

  return (
    <ErrorBoundary>
      <MigrationManager>
        <SidebarLayout onSignOut={handleSignOut}>
          {/* Debug current route */}
          
          <div key={`${location.pathname}-${forceRender}`}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/tasks" element={<TasksList />} />
              <Route path="/task-list" element={<TaskListView />} />
              <Route path="/mobile-priorities" element={<MobilePriorityDashboard />} />
            {/* <Route path="/modern-table" element={<ModernTableDemo />} /> */}
            {/* Legacy sprint routes - redirect to consolidated */}
            <Route path="/kanban" element={<Navigate to="/sprints/kanban" replace />} />
            <Route path="/kanban-old" element={<Navigate to="/sprints/kanban" replace />} />
            <Route path="/sprint-planning" element={<Navigate to="/sprints/management" replace />} />
            <Route path="/sprint-simple" element={<Navigate to="/sprints/management" replace />} />
            <Route path="/sprint-kanban" element={<Navigate to="/sprints/kanban" replace />} />
            <Route path="/sprint-matrix" element={<Navigate to="/sprints/management" replace />} />
            <Route path="/current-sprint" element={<Navigate to="/sprints/kanban" replace />} />
            
            {/* Sprint routes */}
            <Route path="/sprints" element={<SprintsPage />} />
            {/* Restore dedicated Management page */}
            <Route path="/sprints/management" element={<SprintManagementView />} />
            <Route path="/sprints/kanban" element={<SprintKanbanPage />} />
            <Route path="/sprints/stories" element={<StoriesManagement />} />
            <Route path="/sprints/table" element={<SprintTablePage />} />
            
            <Route path="/tasks-management" element={<TasksManagement />} />
            <Route path="/calendar-blocks" element={<CalendarBlockManagerNew />} />
            <Route path="/mobile-view" element={<MobileView />} />
            <Route path="/mobile-checklist" element={<MobileChecklistView />} />
            <Route path="/chores" element={<ChoresManagement />} />
            <Route path="/habits" element={<HabitsManagement />} />
            <Route path="/ai-planner" element={<PlanningDashboard />} />
            <Route path="/ai-usage" element={<AIUsageDashboard />} />
            <Route path="/planning" element={<PlanningDashboard />} />
            <Route path="/stories" element={<StoriesManagement />} />
            <Route path="/personal-lists" element={<BacklogManager />} />
            <Route path="/personal-lists-modern" element={<PersonalListsManagement />} />
            <Route path="/personal-backlogs" element={<BacklogManager />} />
            <Route path="/goals" element={<GoalsManagement />} />
            <Route path="/goals-management" element={<GoalsManagement />} />
            <Route path="/goals/roadmap" element={<GoalRoadmapV3 />} />
            {/* Legacy V2 removed; no preview route retained */}
            <Route path="/goals/cards" element={<ThemeRoadmap />} />
            <Route path="/goals/viz" element={<GoalVizPage />} />
            
            {/* Goals Timeline uses Enhanced Gantt (V3) */}
            <Route path="/goals/timeline" element={<EnhancedGanttChart />} />
            <Route path="/calendar/integration" element={<CalendarIntegrationView />} />
            <Route path="/calendar/sync" element={<CalendarIntegrationView />} />
            <Route path="/routes" element={<RoutesManagementView />} />
            <Route path="/routines" element={<RoutesManagementView />} />
            <Route path="/routes/optimization" element={<RoutesManagementView />} />
            <Route path="/travel" element={<TravelMap />} />
            
            <Route path="/canvas" element={<VisualCanvas />} />
            <Route path="/visual-canvas" element={<VisualCanvas />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/running-results" element={<WorkoutsDashboard />} />
            <Route path="/workouts" element={<Navigate to="/running-results" replace />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/theme-colors" element={<Navigate to="/settings" replace />} />
            <Route path="/admin" element={<Admin />} />
            {/* Removed by request: Test Suite and Changelog routes */}
            <Route path="/test" element={<Navigate to="/dashboard" replace />} />
            <Route path="/changelog" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </div>

        {/* Floating Action Button for quick adds */}
        <FloatingActionButton onImportClick={() => setShowImportModal(true)} />

        {/* Import/Export Modal */}
        <ImportExportModal 
          show={showImportModal} 
          onHide={() => setShowImportModal(false)} 
        />

        {/* Global Sidebar */}
        <GlobalSidebar
          goals={goals}
          stories={stories}
          sprints={sprints}
        />
      </SidebarLayout>
    </MigrationManager>
    </ErrorBoundary>
  );
}

export default App;
