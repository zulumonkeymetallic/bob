import React, { useState, useEffect, Suspense } from 'react';
import { Button } from 'react-bootstrap';
import { Routes, Route, BrowserRouter as Router, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import TaskListView from './components/TaskListView';
import GoalsManagement from './components/GoalsManagement';
import KanbanPage from './components/KanbanPage';
import ModernKanbanPage from './components/ModernKanbanPage';
import PlanningDashboard from './components/PlanningDashboard';
import UnifiedPlannerPage from './components/planner/UnifiedPlannerPage';
import WeeklyThemePlanner from './components/planner/WeeklyThemePlanner';
import PlanningApprovalPage from './components/planner/PlanningApprovalPage';
import ApprovalsCenter from './components/planner/ApprovalsCenter';
import BacklogManager from './components/BacklogManager';
import VisualCanvas from './components/VisualCanvas';
import StoriesManagement from './components/StoriesManagement';
import PersonalListsManagement from './components/PersonalListsManagement';
import GamesBacklog from './components/GamesBacklog';
import BooksBacklog from './components/BooksBacklog';
import ShowsBacklog from './components/ShowsBacklog';
import VideosBacklog from './components/VideosBacklog';
import MobilePriorityDashboard from './components/MobilePriorityDashboard';
// import ModernTableDemo from './components/ModernTableDemo';
import FloatingActionButton from './components/FloatingActionButton';
import FloatingAssistantButton from './components/FloatingAssistantButton';
import AssistantChatModal from './components/AssistantChatModal';
import ImportExportModal from './components/ImportExportModal';
import SidebarLayout from './components/SidebarLayout';
import SettingsPage from './components/SettingsPage';
import LoginPage from './components/LoginPage';
import ErrorBoundary from './components/ErrorBoundary';
import { useTheme } from './contexts/ThemeContext';
import { useAuth } from './contexts/AuthContext';
import { PersonaProvider, usePersona } from './contexts/PersonaContext';
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
import SprintRetrospective from './components/SprintRetrospective';
import RoutesManagementView from './components/routes/RoutesManagementView';
import CurrentSprintKanban from './components/CurrentSprintKanban';
import MobileView from './components/MobileView';
import MobileChecklistView from './components/MobileChecklistView';
import MobileHome from './components/MobileHome';
import ChoresTasksPage from './components/ChoresTasksPage';
import HabitsManagement from './components/HabitsManagement';
import AIUsageDashboard from './components/AIUsageDashboard';
import SprintPlannerMatrix from './components/SprintPlannerMatrix';
import MigrationManager from './components/MigrationManager';
import GoalVizPage from './components/visualization/GoalVizPage';
import GoalRoadmapV3 from './components/visualization/GoalRoadmapV3';
import GoalRoadmapV5 from './components/visualization/GoalRoadmapV5';
import GoalRoadmapV6 from './components/visualization/GoalRoadmapV6';

import SprintKanbanPageV2 from './components/SprintKanbanPageV2';
import TasksManagement from './components/TasksManagement';
import SprintPlanningMatrix from './components/SprintPlanningMatrix';
import WorkoutsDashboard from './components/WorkoutsDashboard';
import FinanceDashboardModern from './components/FinanceDashboardModern';
import MerchantMappings from './components/finance/MerchantMappings';
import CategoriesBuckets from './components/finance/CategoriesBuckets';
import BudgetsPage from './components/finance/BudgetsPage';
import GoalPotLinking from './components/finance/GoalPotLinking';
import TransactionsList from './components/finance/TransactionsList';
import FinanceFlowDiagram from './components/finance/FinanceFlowDiagram';
import PotsBoard from './components/finance/PotsBoard';
import IntegrationSettings from './components/IntegrationSettings';
import IntegrationLogs from './components/IntegrationLogs';
import SettingsEmailPage from './components/settings/SettingsEmailPage';
import SettingsPlannerPage from './components/settings/SettingsPlannerPage';
import AiDiagnosticsLogs from './components/logs/AiDiagnosticsLogs';
import GoogleCalendarSettings from './components/settings/integrations/GoogleCalendarSettings';
import MonzoSettings from './components/settings/integrations/MonzoSettings';
import StravaSettings from './components/settings/integrations/StravaSettings';
import SteamSettings from './components/settings/integrations/SteamSettings';
import HardcoverSettings from './components/settings/integrations/HardcoverSettings';
import TraktSettings from './components/settings/integrations/TraktSettings';
import { useEntityAudit } from './hooks/useEntityAudit';
import RoutinesChoresManager from './components/routines/RoutinesChoresManager';
import DeepLinkStory from './components/routes/DeepLinkStory';
import DeepLinkGoal from './components/routes/DeepLinkGoal';
import DeepLinkTask from './components/routes/DeepLinkTask';
import QueryDeepLinkGate from './components/routes/QueryDeepLinkGate';
import AdvancedOverview from './components/AdvancedOverview';
import FinanceDashboardAdvanced from './components/finance/FinanceDashboardAdvanced';
import CapacityDashboard from './components/CapacityDashboard';


// Lazy-loaded heavy routes
const TravelMap = React.lazy(() => import('./components/travel/TravelMap'));

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
  const { currentPersona } = usePersona();
  const [isNavExpanded, setIsNavExpanded] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);

  // Root path redirect that is mobile-aware
  const RootRedirect: React.FC = () => {
    const dev = useDeviceInfo();
    return <Navigate to={dev?.isMobile ? '/mobile' : '/sprints/kanban'} replace />;
  };

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

  // Debug location changes
  useEffect(() => {
    logger.debug('nav', 'Location change', { path: location.pathname, key: location.key });
  }, [location.pathname, location.key]);



  // Auto-route to mobile Home on mobile devices when landing on dashboard/home
  useEffect(() => {
    if (!currentUser) return;
    const isMobile = deviceInfo?.isMobile;
    const path = location.pathname;
    const onHome = path === '/' || path === '/dashboard';
    const alreadyMobile = path.startsWith('/mobile');
    if (isMobile && onHome && !alreadyMobile) {
      navigate('/mobile', { replace: true });
    }
  }, [currentUser, deviceInfo?.isMobile, location.pathname, navigate]);

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

  // Gate global audit listeners behind an env flag to reduce initial reads
  const enableAudit = process.env.REACT_APP_ENABLE_AUDIT === 'true';
  useEntityAudit(enableAudit && currentUser ? { currentUserId: currentUser.uid, currentUserEmail: currentUser.email, persona: currentPersona } : null);

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
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/overview/advanced" element={<AdvancedOverview />} />
            <Route
              path="/tasks"
              element={<QueryDeepLinkGate paramKey="taskId" pathPrefix="/tasks" fallback={<TaskListView />} />}
            />
            <Route path="/tasks/:id" element={<DeepLinkTask />} />
            {/* Back-compat for older deep links */}
            <Route path="/task/:id" element={<DeepLinkTask />} />
            <Route path="/task" element={<Navigate to="/tasks" replace />} />
            <Route path="/task-list" element={<Navigate to="/tasks" replace />} />
            <Route path="/mobile-priorities" element={<MobilePriorityDashboard />} />
            <Route path="/games-backlog" element={<GamesBacklog />} />
            <Route path="/books-backlog" element={<BooksBacklog />} />
            <Route path="/shows-backlog" element={<ShowsBacklog />} />
            <Route path="/videos-backlog" element={<VideosBacklog />} />
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
            <Route path="/sprints/management/burndown" element={<SprintManagementView />} />
            <Route path="/sprints/kanban" element={<SprintKanbanPageV2 />} />

            <Route path="/sprints/kanban-v2" element={<Navigate to="/sprints/kanban" replace />} />
            <Route path="/sprints/stories" element={<StoriesManagement />} />
            <Route path="/sprints/table" element={<SprintTablePage />} />
            <Route path="/sprints/planning" element={<SprintPlanningMatrix />} />
            <Route path="/sprints/retrospective" element={<SprintRetrospective />} />
            <Route path="/sprints/capacity" element={<CapacityDashboard />} />

            <Route path="/tasks-management" element={<TasksManagement />} />
            <Route path="/chores" element={<ChoresTasksPage />} />
            <Route path="/mobile" element={<MobileHome />} />
            <Route path="/mobile-view" element={<MobileView />} />
            <Route path="/mobile-checklist" element={<MobileChecklistView />} />
            <Route path="/habits" element={<HabitsManagement />} />
            <Route path="/routines" element={<RoutinesChoresManager />} />
            <Route path="/ai-planner" element={<PlanningDashboard />} />
            <Route path="/ai-usage" element={<AIUsageDashboard />} />
            <Route path="/planning" element={<PlanningDashboard />} />
            <Route path="/planning/approvals" element={<ApprovalsCenter />} />
            <Route path="/planning/approval" element={<PlanningApprovalPage />} />
            <Route
              path="/stories"
              element={<QueryDeepLinkGate paramKey="storyId" pathPrefix="/stories" fallback={<StoriesManagement />} />}
            />
            <Route path="/stories/:id" element={<DeepLinkStory />} />
            <Route path="/personal-lists" element={<BacklogManager />} />
            <Route path="/personal-lists-modern" element={<PersonalListsManagement />} />
            <Route path="/personal-backlogs" element={<BacklogManager />} />
            <Route
              path="/goals"
              element={<QueryDeepLinkGate paramKey="goalId" pathPrefix="/goals" fallback={<GoalsManagement />} />}
            />
            <Route path="/goals/:id" element={<DeepLinkGoal />} />
            <Route path="/goals-management" element={<GoalsManagement />} />
            <Route path="/goals/roadmap" element={<GoalRoadmapV5 />} />
            <Route path="/goals/roadmap-legacy" element={<GoalRoadmapV3 />} />
            <Route path="/goals/roadmap-v5" element={<GoalRoadmapV5 />} />
            <Route path="/goals/roadmap-v6" element={<GoalRoadmapV6 />} />
            {/* Legacy V2 removed; no preview route retained */}
            <Route path="/goals/viz" element={<GoalVizPage />} />

            {/* Goals Timeline uses Enhanced Gantt (V3) */}
            <Route path="/goals/timeline" element={<EnhancedGanttChart />} />
            <Route path="/calendar/integration" element={<CalendarIntegrationView />} />
            <Route path="/calendar/sync" element={<CalendarIntegrationView />} />
            <Route path="/routes" element={<RoutesManagementView />} />
            <Route path="/routes/optimization" element={<RoutesManagementView />} />
            <Route path="/finance/integrations" element={<Navigate to="/settings/integrations" replace />} />
            <Route path="/logs/integrations" element={<IntegrationLogs />} />
            <Route path="/logs/ai" element={<AiDiagnosticsLogs />} />
            <Route
              path="/travel"
              element={
                <Suspense fallback={<div style={{ padding: 16 }}>Loading Travel Map…</div>}>
                  <TravelMap />
                </Suspense>
              }
            />

            <Route path="/canvas" element={<VisualCanvas />} />
            <Route path="/visual-canvas" element={<VisualCanvas />} />
            <Route path="/calendar" element={<UnifiedPlannerPage />} />
            <Route path="/calendar/planner" element={<WeeklyThemePlanner />} />
            <Route path="/calendar/themes" element={<Navigate to="/calendar/planner" replace />} />
            <Route path="/running-results" element={<WorkoutsDashboard />} />
            <Route path="/workouts" element={<Navigate to="/running-results" replace />} />
            <Route path="/finance" element={<FinanceDashboardModern />} />
            <Route path="/finance/merchants" element={<MerchantMappings />} />
            <Route path="/finance/categories" element={<CategoriesBuckets />} />
            <Route path="/finance/budgets" element={<BudgetsPage />} />
            <Route path="/finance/goals" element={<GoalPotLinking />} />
            <Route path="/finance/transactions" element={<TransactionsList />} />
            <Route path="/finance/dashboard" element={<FinanceDashboardAdvanced />} />
            <Route path="/finance/flow" element={<FinanceFlowDiagram />} />
            <Route path="/finance/pots" element={<PotsBoard />} />
            <Route path="/finance/advanced" element={<Navigate to="/finance/dashboard" replace />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/email" element={<SettingsEmailPage />} />
            <Route path="/settings/planner" element={<SettingsPlannerPage />} />
            <Route path="/settings/integrations" element={<IntegrationSettings />} />
            <Route path="/settings/integrations/google" element={<GoogleCalendarSettings />} />
            <Route path="/settings/integrations/monzo" element={<MonzoSettings />} />
            <Route path="/settings/integrations/strava" element={<StravaSettings />} />
            <Route path="/settings/integrations/steam" element={<SteamSettings />} />
            <Route path="/settings/integrations/hardcover" element={<HardcoverSettings />} />
            <Route path="/settings/integrations/trakt" element={<TraktSettings />} />
            <Route path="/theme-colors" element={<Navigate to="/settings" replace />} />
            <Route path="/admin" element={<Navigate to="/settings/integrations" replace />} />
            {/* Removed by request: Test Suite and Changelog routes */}
            <Route path="/test" element={<Navigate to="/dashboard" replace />} />
            <Route path="/changelog" element={<Navigate to="/dashboard" replace />} />
          </Routes>

          {/* Assistant (floating, near FAB but separate) */}
          <FloatingAssistantButton onClick={() => setShowAssistant(true)} />
          <AssistantChatModal show={showAssistant} onHide={() => setShowAssistant(false)} />

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
