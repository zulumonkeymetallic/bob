import React, { useState, useEffect } from 'react';
import { Container, Card, Row, Col, Button, Form, InputGroup } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, updateDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import ModernPersonalListsTable from './ModernPersonalListsTable';

// Define PersonalItem interface locally
interface PersonalItem {
  id: string;
  title: string;
  description?: string;
  category: 'personal' | 'work' | 'learning' | 'health' | 'finance';
  priority: 'low' | 'medium' | 'high';
  status: 'todo' | 'in-progress' | 'waiting' | 'done';
  dueDate?: number;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
  ownerUid: string;
  persona: string;
}

const PersonalListsManagement: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [items, setItems] = useState<PersonalItem[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    loadPersonalItems();
  }, [currentUser, currentPersona]);

  const loadPersonalItems = async () => {
    if (!currentUser) return;
    
    setLoading(true);
    
    // Load personal items data
    const itemsQuery = query(
      collection(db, 'personalItems'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('createdAt', 'desc')
    );
    
    // Subscribe to real-time updates
    const unsubscribeItems = onSnapshot(itemsQuery, (snapshot) => {
      const itemsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as PersonalItem[];
      setItems(itemsData);
    });

    setLoading(false);

    return () => {
      unsubscribeItems();
    };
  };

  // Handler functions for ModernPersonalListsTable
  const handleItemUpdate = async (itemId: string, updates: Partial<PersonalItem>) => {
    try {
      await updateDoc(doc(db, 'personalItems', itemId), {
        ...updates,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating personal item:', error);
    }
  };

  const handleItemDelete = async (itemId: string) => {
    try {
      await deleteDoc(doc(db, 'personalItems', itemId));
    } catch (error) {
      console.error('Error deleting personal item:', error);
    }
  };

  const handleItemPriorityChange = async (itemId: string, newPriority: number) => {
    try {
      await updateDoc(doc(db, 'personalItems', itemId), {
        priority: newPriority,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating personal item priority:', error);
    }
  };

  // Apply filters to items
  const filteredItems = items.filter(item => {
    if (filterStatus !== 'all' && item.status !== filterStatus) return false;
    if (filterCategory !== 'all' && item.category !== filterCategory) return false;
    if (searchTerm && !item.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  // Get counts for dashboard cards
  const itemCounts = {
    total: filteredItems.length,
    todo: filteredItems.filter(i => i.status === 'todo').length,
    inProgress: filteredItems.filter(i => i.status === 'in-progress').length,
    done: filteredItems.filter(i => i.status === 'done').length
  };

  return (
    <div style={{ 
      padding: '24px', 
      backgroundColor: '#f8f9fa',
      minHeight: '100vh',
      width: '100%'
    }}>
      <div style={{ maxWidth: '100%', margin: '0' }}>
        {/* Header */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          marginBottom: '24px' 
        }}>
          <div>
            <h2 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '600' }}>
              Personal Lists
            </h2>
            <p style={{ margin: 0, color: '#6b7280', fontSize: '16px' }}>
              Manage personal tasks across all life categories
            </p>
          </div>
          <Button variant="primary" onClick={() => alert('Add new personal item - coming soon')}>
            Add Item
          </Button>
        </div>

        {/* Dashboard Cards */}
        <Row className="mb-4">
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: '#1f2937' }}>
                  {itemCounts.total}
                </h3>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '14px', fontWeight: '500' }}>
                  Total Items
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: '#6b7280' }}>
                  {itemCounts.todo}
                </h3>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '14px', fontWeight: '500' }}>
                  To Do
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: '#2563eb' }}>
                  {itemCounts.inProgress}
                </h3>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '14px', fontWeight: '500' }}>
                  In Progress
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: '#059669' }}>
                  {itemCounts.done}
                </h3>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '14px', fontWeight: '500' }}>
                  Done
                </p>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        {/* Filters */}
        <Card style={{ marginBottom: '24px', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <Card.Body style={{ padding: '24px' }}>
            <Row>
              <Col md={4}>
                <Form.Group>
                  <Form.Label style={{ fontWeight: '500', marginBottom: '8px' }}>Search Items</Form.Label>
                  <InputGroup>
                    <Form.Control
                      type="text"
                      placeholder="Search by title..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{ border: '1px solid #d1d5db' }}
                    />
                  </InputGroup>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group>
                  <Form.Label style={{ fontWeight: '500', marginBottom: '8px' }}>Status</Form.Label>
                  <Form.Select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    style={{ border: '1px solid #d1d5db' }}
                  >
                    <option value="all">All Status</option>
                    <option value="todo">To Do</option>
                    <option value="in-progress">In Progress</option>
                    <option value="waiting">Waiting</option>
                    <option value="done">Done</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group>
                  <Form.Label style={{ fontWeight: '500', marginBottom: '8px' }}>Category</Form.Label>
                  <Form.Select
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                    style={{ border: '1px solid #d1d5db' }}
                  >
                    <option value="all">All Categories</option>
                    <option value="personal">Personal</option>
                    <option value="work">Work</option>
                    <option value="learning">Learning</option>
                    <option value="health">Health</option>
                    <option value="finance">Finance</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            <Row style={{ marginTop: '16px' }}>
              <Col>
                <Button 
                  variant="outline-secondary" 
                  onClick={() => {
                    setFilterStatus('all');
                    setFilterCategory('all');
                    setSearchTerm('');
                  }}
                  style={{ borderColor: '#d1d5db' }}
                >
                  Clear Filters
                </Button>
              </Col>
            </Row>
          </Card.Body>
        </Card>

        {/* Modern Personal Lists Table - Full Width */}
        <Card style={{ border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', minHeight: '600px' }}>
          <Card.Header style={{ 
            backgroundColor: '#fff', 
            borderBottom: '1px solid #e5e7eb', 
            padding: '20px 24px' 
          }}>
            <h5 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
              Personal Items ({filteredItems.length})
            </h5>
          </Card.Header>
          <Card.Body style={{ padding: 0 }}>
            {loading ? (
              <div style={{ 
                textAlign: 'center', 
                padding: '60px 20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <div className="spinner-border" style={{ marginBottom: '16px' }} />
                <p style={{ margin: 0, color: '#6b7280' }}>Loading personal items...</p>
              </div>
            ) : (
              <div style={{ height: '600px', overflow: 'auto' }}>
                <ModernPersonalListsTable
                  items={filteredItems}
                  onItemUpdate={handleItemUpdate}
                  onItemDelete={handleItemDelete}
                  onItemPriorityChange={handleItemPriorityChange}
                />
              </div>
            )}
          </Card.Body>
        </Card>
      </div>
    </div>
  );
};

export default PersonalListsManagement;
