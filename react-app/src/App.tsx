import React, { useState } from 'react';
import { Container, Nav, Navbar, Button } from 'react-bootstrap';
import { Routes, Route, BrowserRouter as Router, Link } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import StoryBacklog from './components/StoryBacklog';
import SprintAdmin from './components/SprintAdmin';
import GoalsManagement from './components/GoalsManagement';
import DevelopmentTracking from './components/DevelopmentTracking';
import Admin from './components/Admin';
import KanbanPage from './components/KanbanPage';
import Changelog from './components/Changelog';
import { useTheme } from './contexts/ThemeContext';
import { useAuth } from './contexts/AuthContext';
import './App.css';

function App() {
  const { theme, toggleTheme } = useTheme();
  const { currentUser, signInWithGoogle, signOut } = useAuth();
  const [isNavExpanded, setIsNavExpanded] = useState(false);

  if (!currentUser) {
    return (
      <div className={`app-container ${theme} vh-100 d-flex justify-content-center align-items-center`}>
        <div className="text-center">
          <h1>Welcome to BOB</h1>
          <p>Your personal productivity assistant.</p>
          <Button variant="primary" size="lg" onClick={signInWithGoogle}>
            Sign in with Google
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Router>
      <div className={`app-container ${theme}`}>
        <Navbar
          bg={theme === 'dark' ? 'dark' : 'light'}
          variant={theme === 'dark' ? 'dark' : 'light'}
          expand="lg"
          fixed="top"
          className="main-navbar"
          onToggle={setIsNavExpanded}
          expanded={isNavExpanded}
        >
          <Container fluid>
            <Navbar.Brand as={Link} to="/">BOB</Navbar.Brand>
            <Navbar.Toggle aria-controls="basic-navbar-nav" />
            <Navbar.Collapse id="basic-navbar-nav">
              <Nav className="me-auto">
                <Nav.Link as={Link} to="/" onClick={() => setIsNavExpanded(false)}>Dashboard</Nav.Link>
                <Nav.Link as={Link} to="/kanban" onClick={() => setIsNavExpanded(false)}>Kanban</Nav.Link>
                <Nav.Link as={Link} to="/backlog" onClick={() => setIsNavExpanded(false)}>Backlog</Nav.Link>
                <Nav.Link as={Link} to="/goals" onClick={() => setIsNavExpanded(false)}>Goals</Nav.Link>
                <Nav.Link as={Link} to="/dev-tracking" onClick={() => setIsNavExpanded(false)}>Dev Tracking</Nav.Link>
                <Nav.Link as={Link} to="/admin" onClick={() => setIsNavExpanded(false)}>Admin</Nav.Link>
                <Nav.Link as={Link} to="/changelog" onClick={() => setIsNavExpanded(false)}>Changelog</Nav.Link>
              </Nav>
              <Button variant="outline-secondary" onClick={toggleTheme} className="me-2">
                {theme === 'dark' ? 'Light' : 'Dark'} Mode
              </Button>
              <Button variant="outline-danger" onClick={signOut}>
                Sign Out
              </Button>
            </Navbar.Collapse>
          </Container>
        </Navbar>
        <Container fluid className="content-container">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/kanban" element={<KanbanPage />} />
            <Route path="/backlog" element={<StoryBacklog />} />
            <Route path="/goals" element={<GoalsManagement />} />
            <Route path="/dev-tracking" element={<DevelopmentTracking />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/changelog" element={<Changelog />} />
          </Routes>
        </Container>
      </div>
    </Router>
  );
}

export default App;
