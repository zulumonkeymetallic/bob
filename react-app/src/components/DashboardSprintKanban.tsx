import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Badge, Button } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Story } from '../types';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';
import { useNavigate } from 'react-router-dom';
import { useSprint } from '../contexts/SprintContext';

interface DashboardSprintKanbanProps {
  maxStories?: number;
  selectedSprintId?: string | null;
}

const DashboardSprintKanban: React.FC<DashboardSprintKanbanProps> = ({ 
  maxStories = 6, 
  selectedSprintId 
}) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const navigate = useNavigate();
  
  const [stories, setStories] = useState<Story[]>([]);
  const { sprints } = useSprint();

  const columns = [
    { id: 'backlog', title: 'Backlog', status: 0 },
    { id: 'in-progress', title: 'In Progress', status: 2 },
    { id: 'done', title: 'Done', status: 4 }
  ];

  useEffect(() => {
    if (!currentUser || !currentPersona) return;

    let unsubscribeStories: (() => void) | undefined;

    try {
      const storiesQuery = query(
        collection(db, 'stories'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona)
      );
      
      unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
        const storiesData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Story[];
        
        const activeSprintId = (() => {
          if (selectedSprintId && selectedSprintId !== '') return selectedSprintId;
          const sprint = sprints.find((s) => s.status === 1) || sprints[0];
          return sprint ? sprint.id : undefined;
        })();

        const sprintStories = storiesData
          .filter(story => {
            if (selectedSprintId === '') return true;
            if (selectedSprintId) return story.sprintId === selectedSprintId;
            return activeSprintId ? story.sprintId === activeSprintId : true;
          })
          .slice(0, maxStories);
        
        setStories(sprintStories);
      }, (error) => {
        console.error('Dashboard stories subscription error:', error);
      });
    } catch (error) {
      console.error('Error setting up dashboard subscriptions:', error);
    }

    return () => {
      try {
        unsubscribeStories?.();
      } catch (error) {
        console.error('Error cleaning up dashboard subscriptions:', error);
      }
    };
  }, [currentUser, currentPersona, maxStories, selectedSprintId, sprints]);

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;

    const { source, destination, draggableId } = result;
    
    if (source.droppableId === destination.droppableId) return;

    const story = stories.find(s => s.id === draggableId);
    if (!story) return;

    const destinationColumn = columns.find(col => col.id === destination.droppableId);
    if (!destinationColumn) return;

    try {
      await updateDoc(doc(db, 'stories', story.id), {
        status: destinationColumn.status,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating story status:', error);
    }
  };

  const getStoriesForColumn = (status: number) => {
    return stories.filter(story => story.status === status);
  };

  const getStatusBadgeVariant = (status: number) => {
    switch (status) {
      case 1: return 'info';
      case 2: return 'warning';
      case 3: return 'primary';
      case 4: return 'success';
      default: return 'secondary';
    }
  };

  return (
    <Card className="h-100">
      <Card.Header className="d-flex justify-content-between align-items-center">
        <h5 className="mb-0">Sprint Board</h5>
        <div>
          {(() => {
            if (selectedSprintId === '') return null;
            const sprintMatch = selectedSprintId
              ? sprints.find((s) => s.id === selectedSprintId)
              : sprints.find((s) => s.status === 1) || sprints[0];
            if (!sprintMatch) return null;
            return (
            <Badge bg="primary" className="me-2">
                {sprintMatch.name || sprintMatch.id}
            </Badge>
            );
          })()}
          <Button 
            variant="outline-primary" 
            size="sm"
            onClick={() => navigate('/sprints/management')}
          >
            View Full Board
          </Button>
        </div>
      </Card.Header>
      <Card.Body className="p-2">
        <DragDropContext onDragEnd={handleDragEnd}>
          <Row className="g-2">
            {columns.map(column => (
              <Col key={column.id} xs={4}>
                <div className="kanban-column">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <small className="fw-bold text-muted">{column.title}</small>
                    <Badge bg={getStatusBadgeVariant(column.status)} pill>
                      {getStoriesForColumn(column.status).length}
                    </Badge>
                  </div>
                  
                  <Droppable droppableId={column.id}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`kanban-droppable ${snapshot.isDraggingOver ? 'drag-over' : ''}`}
                        style={{
                          minHeight: '200px',
                          backgroundColor: snapshot.isDraggingOver ? 'rgba(var(--card-rgb), 0.15)' : 'transparent',
                          border: '1px dashed var(--line)',
                          borderRadius: '4px',
                          padding: '8px'
                        }}
                      >
                        {getStoriesForColumn(column.status).map((story, index) => (
                          <Draggable key={story.id} draggableId={story.id} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                style={{
                                  ...provided.draggableProps.style,
                                  opacity: snapshot.isDragging ? 0.8 : 1
                                }}
                              >
                                <Card 
                                  className="mb-2 story-card" 
                                  style={{ 
                                    fontSize: '0.85rem',
                                    cursor: 'grab',
                                    border: '1px solid var(--line)'
                                  }}
                                >
                                  <Card.Body className="p-2">
                                    <div className="fw-bold mb-1" style={{ fontSize: '0.8rem' }}>
                                      {(story as any).ref || story.id}
                                    </div>
                                    <div className="mb-2" style={{ fontSize: '0.75rem', lineHeight: '1.2' }}>
                                      {story.title}
                                    </div>
                                    {(story as any).points && (
                                      <Badge bg="secondary" style={{ fontSize: '0.6rem' }}>
                                        {(story as any).points}pts
                                      </Badge>
                                    )}
                                  </Card.Body>
                                </Card>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              </Col>
            ))}
          </Row>
        </DragDropContext>
      </Card.Body>
    </Card>
  );
};

export default DashboardSprintKanban;
