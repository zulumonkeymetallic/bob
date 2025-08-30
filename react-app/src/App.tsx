import React, { useState, useEffect } from 'react';
import { Container, Nav, Navbar, Button } from 'react-bootstrap';
import { Routes, Route, BrowserRouter as Router, Link, Navigate } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import SprintDashboard from './components/SprintDashboard';
import TaskListView from './components/TaskListView';
import StoryBacklog from './components/StoryBacklog';
import SprintAdmin from './components/SprintAdmin';
import GoalsManagement from './components/GoalsManagement';
import Admin from './components/Admin';
import KanbanPage from './components/KanbanPage';
import ResponsiveKanban from './components/ResponsiveKanban';
import TasksList from './components/TasksList';
import PlanningDashboard from './components/PlanningDashboard';
import Calendar from './components/Calendar';
import Changelog from './components/Changelog';
import BacklogManager from './components/BacklogManager';
import VisualCanvas from './components/VisualCanvas';
import MobilePriorityDashboard from './components/MobilePriorityDashboard';
import ModernTableDemo from './components/ModernTableDemo';
import FloatingActionButton from './components/FloatingActionButton';
import ImportExportModal from './components/ImportExportModal';
import SidebarLayout from './components/SidebarLayout';
import ThemeColorManager from './components/ThemeColorManager';
import { useTheme } from './contexts/ThemeContext';
import { useAuth } from './contexts/AuthContext';
import { PersonaProvider } from './contexts/PersonaContext';
import PersonaSwitcher from './components/PersonaSwitcher';
import { useDeviceInfo } from './utils/deviceDetection';
import { checkForUpdates, VERSION } from './version';
import './App.css';

function App() {
  return (
    <PersonaProvider>
      <Router>
        <AppContent />
      </Router>
    </PersonaProvider>
  );
}

function AppContent() {
  const { theme, toggleTheme } = useTheme();
  const { currentUser, signInWithGoogle, signOut } = useAuth();
  const deviceInfo = useDeviceInfo();
  const [isNavExpanded, setIsNavExpanded] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  // Check for updates on app load
  useEffect(() => {
    checkForUpdates();
    
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

  return (
      <SidebarLayout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/sprint-dashboard" element={<SprintDashboard />} />
          <Route path="/tasks" element={<TasksList />} />
          <Route path="/task-list" element={<TaskListView />} />
          <Route path="/mobile-priorities" element={<MobilePriorityDashboard />} />
          <Route path="/modern-table" element={<ModernTableDemo />} />
          <Route path="/kanban" element={<ResponsiveKanban />} />
          <Route path="/kanban-old" element={<KanbanPage />} />
          <Route path="/ai-planner" element={<PlanningDashboard />} />
          <Route path="/planning" element={<PlanningDashboard />} />
          <Route path="/backlog" element={<StoryBacklog />} />
          <Route path="/personal-lists" element={<BacklogManager />} />
          <Route path="/personal-backlogs" element={<BacklogManager />} />
          <Route path="/goals" element={<GoalsManagement />} />
          <Route path="/goals-management" element={<GoalsManagement />} />
          <Route path="/canvas" element={<VisualCanvas />} />
          <Route path="/visual-canvas" element={<VisualCanvas />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/settings" element={<Navigate to="/theme-colors" replace />} />
          <Route path="/theme-colors" element={<ThemeColorManager />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/changelog" element={<Changelog />} />
        </Routes>

        {/* Floating Action Button for quick adds */}
        <FloatingActionButton onImportClick={() => setShowImportModal(true)} />

        {/* Import/Export Modal */}
        <ImportExportModal 
          show={showImportModal} 
          onHide={() => setShowImportModal(false)} 
        />
      </SidebarLayout>
  );
}

export default App;
