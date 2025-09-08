import React, { useState, useEffect } from 'react';
import { Button } from 'react-bootstrap';
import { Routes, Route, BrowserRouter as Router, Navigate } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import SprintDashboard from './components/SprintDashboard';
import TaskListView from './components/TaskListView';
import GoalsManagement from './components/GoalsManagement';
import KanbanPage from './components/KanbanPage';
import ModernKanbanPage from './components/ModernKanbanPage';
import TasksList from './components/TasksList';
import PlanningDashboard from './components/PlanningDashboard';
import Calendar from './components/Calendar';
import Changelog from './components/Changelog';
import BacklogManager from './components/BacklogManager';
import VisualCanvas from './components/VisualCanvas';
import StoriesManagement from './components/StoriesManagement';
import PersonalListsManagement from './components/PersonalListsManagement';
import MobilePriorityDashboard from './components/MobilePriorityDashboard';
import ModernTableDemo from './components/ModernTableDemo';
import FloatingActionButton from './components/FloatingActionButton';
import ImportExportModal from './components/ImportExportModal';
import SidebarLayout from './components/SidebarLayout';
import ThemeColorManager from './components/ThemeColorManager';
import ThemeBasedGanttChart from './components/visualization/ThemeBasedGanttChart';
import SprintKanbanPage from './components/SprintKanbanPage';
import SprintPlanningMatrix from './components/SprintPlanningMatrix';
import { useTheme } from './contexts/ThemeContext';
import { useAuth } from './contexts/AuthContext';
import { PersonaProvider } from './contexts/PersonaContext';
import { SidebarProvider } from './contexts/SidebarContext';
import { TestModeProvider } from './contexts/TestModeContext';
import { SprintProvider } from './contexts/SprintContext';
import PersonaSwitcher from './components/PersonaSwitcher';
import GlobalSidebar from './components/GlobalSidebar';
import { useDeviceInfo } from './utils/deviceDetection';
import { checkForUpdates, VERSION } from './version';
import ComprehensiveTest from './components/ComprehensiveTest';
import { useVersionCheck } from './hooks/useVersionCheck';
import { UpdateAvailableToast } from './components/UpdateAvailableToast';
import { registerServiceWorker } from './utils/serviceWorker';

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
  const deviceInfo = useDeviceInfo();
  const [isNavExpanded, setIsNavExpanded] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  
  // Data for the global sidebar
  const [goals, setGoals] = useState([]);
  const [stories, setStories] = useState([]);
  const [sprints, setSprints] = useState([]);

  // Version checking and update management
  const {
    updateAvailable,
    newVersion,
    currentVersion,
    applyUpdate,
    dismissUpdate
  } = useVersionCheck({
    onUpdateAvailable: (current, latest) => {
      console.log('🆕 Update available:', { current, latest });
    }
  });

  // Initialize service worker and check for updates on app load
  useEffect(() => {
    checkForUpdates();
    
    // Register service worker
    registerServiceWorker().then((result) => {
      if (result.isRegistered) {
        console.log('✅ Service worker registered successfully');
      } else {
        console.log('ℹ️ Service worker not available or failed to register');
      }
    });
    
    // Add keyboard shortcut for force refresh (Ctrl+Shift+R or Cmd+Shift+R)
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'R') {
        event.preventDefault();
        console.log('🔄 Force refresh triggered by keyboard shortcut');
        
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
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSignIn = async () => {
    try {
      console.log('Attempting to sign in...');
      await signInWithGoogle();
      console.log('Sign in successful');
    } catch (error) {
      console.error('Sign in failed:', error);
      alert('Sign in failed: ' + error.message);
    }
  };

  if (!currentUser) {
    return (
      <div className={`app-container ${theme} vh-100 d-flex justify-content-center align-items-center`}>
        <div className="text-center">
          <h1>Welcome to BOB</h1>
          <p>Your personal productivity assistant.</p>
          <Button variant="primary" size="lg" onClick={handleSignIn}>
            Sign in with Google
          </Button>
        </div>
      </div>
    );
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
      <SidebarLayout onSignOut={handleSignOut}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/sprint-dashboard" element={<SprintDashboard />} />
          <Route path="/tasks" element={<TasksList />} />
          <Route path="/task-list" element={<TaskListView />} />
          <Route path="/mobile-priorities" element={<MobilePriorityDashboard />} />
          <Route path="/modern-table" element={<ModernTableDemo />} />
          <Route path="/kanban" element={<SprintKanbanPage />} />
          <Route path="/kanban-old" element={<KanbanPage />} />
          <Route path="/ai-planner" element={<PlanningDashboard />} />
          <Route path="/planning" element={<PlanningDashboard />} />
          <Route path="/stories" element={<StoriesManagement />} />
          <Route path="/personal-lists" element={<BacklogManager />} />
          <Route path="/personal-lists-modern" element={<PersonalListsManagement />} />
          <Route path="/personal-backlogs" element={<BacklogManager />} />
          <Route path="/goals" element={<GoalsManagement />} />
          <Route path="/goals-management" element={<GoalsManagement />} />
          <Route path="/goals/visualization" element={<ThemeBasedGanttChart />} />
          <Route path="/goals/gantt" element={<ThemeBasedGanttChart />} />
          <Route path="/canvas" element={<VisualCanvas />} />
          <Route path="/visual-canvas" element={<VisualCanvas />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/sprints/kanban" element={<SprintKanbanPage />} />
          <Route path="/sprints/management" element={<SprintKanbanPage />} />
          <Route path="/sprints/planning" element={<SprintPlanningMatrix />} />
          <Route path="/settings" element={<Navigate to="/theme-colors" replace />} />
          <Route path="/theme-colors" element={<ThemeColorManager />} />
          <Route path="/test" element={<ComprehensiveTest />} />
          <Route path="/changelog" element={<Changelog />} />
        </Routes>

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

        {/* Update Available Toast */}
        <UpdateAvailableToast
          show={updateAvailable}
          currentVersion={currentVersion}
          newVersion={newVersion}
          onReload={applyUpdate}
          onDismiss={dismissUpdate}
        />
      </SidebarLayout>
  );
}

export default App;
