import React, { useState, useEffect } from 'react';
import { Container, Nav, Tab, Row, Col } from 'react-bootstrap';
import { useLocation, useNavigate } from 'react-router-dom';
import SprintManagementView from './SprintManagementView';
import SprintKanbanPage from '../SprintKanbanPage';
import StoriesManagement from '../StoriesManagement';
import SprintSelector from '../SprintSelector';

const SprintsPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('management');
  const [selectedSprintId, setSelectedSprintId] = useState<string>('');

  // Parse active tab from URL
  useEffect(() => {
    const pathParts = location.pathname.split('/');
    if (pathParts.length >= 3) {
      const tab = pathParts[2]; // /sprints/[tab]
      if (['management', 'kanban', 'stories'].includes(tab)) {
        setActiveTab(tab);
      }
    }
  }, [location.pathname]);

  // Update URL when tab changes
  const handleTabSelect = (tab: string | null) => {
    if (tab) {
      setActiveTab(tab);
      navigate(`/sprints/${tab}`);
    }
  };

  const handleSprintChange = (sprintId: string) => {
    console.log('🎯 SprintsPage: Sprint changed to:', sprintId);
    setSelectedSprintId(sprintId);
  };

  return (
    <Container fluid className="px-4 py-3">
      <Row className="mb-4">
        <Col>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h2 className="mb-0">Sprint Management</h2>
            <SprintSelector 
              selectedSprintId={selectedSprintId}
              onSprintChange={handleSprintChange}
              className="ms-auto"
            />
          </div>
          
          <Tab.Container activeKey={activeTab} onSelect={handleTabSelect}>
            <Nav variant="tabs" className="mb-4">
              <Nav.Item>
                <Nav.Link eventKey="management">Sprint Management</Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="kanban">Sprint Kanban</Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="stories">Sprint Stories</Nav.Link>
              </Nav.Item>
            </Nav>

            <Tab.Content>
              <Tab.Pane eventKey="management">
                <SprintManagementView />
              </Tab.Pane>
              
              <Tab.Pane eventKey="kanban">
                <SprintKanbanPage selectedSprintId={selectedSprintId} />
              </Tab.Pane>
              
              <Tab.Pane eventKey="stories">
                <StoriesManagement />
              </Tab.Pane>
            </Tab.Content>
          </Tab.Container>
        </Col>
      </Row>
    </Container>
  );
};

export default SprintsPage;
