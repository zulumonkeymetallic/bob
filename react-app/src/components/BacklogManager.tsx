import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Badge, ListGroup, Nav, Tab, Form, Modal, Dropdown } from 'react-bootstrap';
import { Plus, List, Grid3x3Gap, Search, Filter } from 'react-bootstrap-icons';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { db, functions as fbFunctions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore';
import { Goal, Sprint } from '../types';
import { ChoiceHelper } from '../config/choices';
import { isStatus, isTheme, isPriority, getThemeClass, getPriorityBadge } from '../utils/statusHelpers';


interface BacklogItem {
  id: string;
  title: string;
  description?: string;
  status: 'wishlist' | 'active' | 'completed' | 'dropped';
  priority: 'low' | 'medium' | 'high';
  dateAdded: Date;
  completedDate?: Date;
  tags: string[];
  metadata?: {
    // Steam specific
    steamId?: string;
    appId?: number;
    price?: number;
    genres?: string[];
    releaseDate?: string;
    coverUrl?: string | null;
    headerUrl?: string | null;
    iconUrl?: string | null;
    playtimeForever?: number;
    playtimeTwoWeeks?: number;
    playtimeHours?: number;
    shortDescription?: string | null;
    storeUrl?: string | null;
    lastPlayedAt?: Date | null;
    
    // Trakt specific
    traktId?: string;
    imdbId?: string;
    tmdbId?: number;
    year?: number;
    type?: 'movie' | 'show' | 'episode';
    runtime?: number;
    rating?: number;
  };
  source: 'manual' | 'steam' | 'trakt';
  externalUrl?: string;
}

type BacklogType = 'games' | 'movies' | 'shows' | 'books' | 'custom';

const BacklogManager: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [activeTab, setActiveTab] = useState<BacklogType>('games');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [backlogs, setBacklogs] = useState<Record<BacklogType, BacklogItem[]>>({
    games: [],
    movies: [],
    shows: [],
    books: [],
    custom: []
  });
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  const [newItem, setNewItem] = useState({
    title: '',
    description: '',
    priority: 'medium' as const,
    tags: '',
    source: 'manual' as const
  });

  useEffect(() => {
    if (!currentUser) return;
    
    // Load backlogs from localStorage or API
    loadBacklogs();
    
    // Load goals and sprints from Firebase
    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );
    
    const sprintsQuery = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid)
    );
    
    const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
      const goalsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Goal[];
      setGoals(goalsData);
    });
    
    const unsubscribeSprints = onSnapshot(sprintsQuery, (snapshot) => {
      const sprintsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Sprint[];
      setSprints(sprintsData);
    });
    
    return () => {
      unsubscribeGoals();
      unsubscribeSprints();
    };
  }, [currentUser, currentPersona]);

  useEffect(() => {
    if (!currentUser) return;
    const steamQuery = query(
      collection(db, 'steam'),
      where('ownerUid', '==', currentUser.uid)
    );
    const unsubscribeSteam = onSnapshot(steamQuery, (snap) => {
      const steamItems: BacklogItem[] = snap.docs
        .map((docSnap) => {
          const data: any = docSnap.data();
          if (data.hidden) return null;
          const playtimeHours = typeof data.playtimeHours === 'number'
            ? data.playtimeHours
            : (data.playtimeForever || data.playtime_forever || 0) / 60;
          const lastPlayed = data.lastPlayedAt?.toDate?.()
            ? data.lastPlayedAt.toDate()
            : (typeof data.lastPlayedAt === 'number' ? new Date(data.lastPlayedAt) : null);
          return {
            id: docSnap.id,
            title: data.name || `App ${data.appid}`,
            description: data.shortDescription || '',
            status: (data.status as BacklogItem['status']) || 'wishlist',
            priority: 'medium',
            dateAdded: data.createdAt?.toDate?.() ? data.createdAt.toDate() : new Date(),
            completedDate: data.status === 'completed' && data.statusUpdatedAt?.toDate?.()
              ? data.statusUpdatedAt.toDate()
              : undefined,
            tags: Array.isArray(data.genres) ? data.genres : [],
            metadata: {
              steamId: data.appid,
              appId: data.appid,
              genres: Array.isArray(data.genres) ? data.genres : [],
              coverUrl: data.coverUrl || data.headerUrl || null,
              headerUrl: data.headerUrl || null,
              iconUrl: data.iconUrl || null,
              playtimeForever: data.playtimeForever || data.playtime_forever || 0,
              playtimeTwoWeeks: data.playtimeTwoWeeks || data.playtime_2weeks || 0,
              playtimeHours,
              shortDescription: data.shortDescription || null,
              storeUrl: data.storeUrl || null,
              releaseDate: data.releaseDate || null,
              lastPlayedAt: lastPlayed
            },
            source: 'steam',
            externalUrl: data.storeUrl || `https://store.steampowered.com/app/${data.appid}`
          } as BacklogItem;
        })
        .filter(Boolean) as BacklogItem[];

      steamItems.sort((a, b) => {
        const bPlay = b.metadata?.playtimeForever || 0;
        const aPlay = a.metadata?.playtimeForever || 0;
        return bPlay - aPlay;
      });

      setBacklogs(prev => {
        const manualGames = prev.games.filter(item => item.source !== 'steam');
        return {
          ...prev,
          games: [...steamItems, ...manualGames]
        };
      });
    });

    return () => unsubscribeSteam();
  }, [currentUser]);

  // Clear selection when switching tabs
  useEffect(() => { setSelectedIds([]); }, [activeTab]);

  const reviveBacklogItem = (item: any): BacklogItem => ({
    ...item,
    dateAdded: item.dateAdded ? new Date(item.dateAdded) : new Date(),
    completedDate: item.completedDate ? new Date(item.completedDate) : undefined,
    metadata: {
      ...item.metadata,
      lastPlayedAt: item.metadata?.lastPlayedAt ? new Date(item.metadata.lastPlayedAt) : item.metadata?.lastPlayedAt || null
    }
  });

  const loadBacklogs = () => {
    // For now, load from localStorage
    // TODO: Integrate with Firebase
    const saved = localStorage.getItem(`backlogs_${currentUser?.uid}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setBacklogs((prev) => ({
          ...prev,
          ...Object.fromEntries(
            Object.entries(parsed).map(([key, value]) => (
              Array.isArray(value)
                ? [key, value.map(reviveBacklogItem)]
                : [key, value]
            ))
          ),
          games: Array.isArray(parsed.games)
            ? parsed.games.filter((item: BacklogItem) => item.source !== 'steam').map(reviveBacklogItem)
            : prev.games
        }));
      } catch (error) {
        console.error('Error loading backlogs:', error);
      }
    }
  };

  const saveBacklogs = (newBacklogs: Record<BacklogType, BacklogItem[]>) => {
    setBacklogs(newBacklogs);
    const storagePayload = {
      ...newBacklogs,
      games: newBacklogs.games.filter(item => item.source !== 'steam')
    };
    localStorage.setItem(`backlogs_${currentUser?.uid}`, JSON.stringify(storagePayload));
  };

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const scheduleSelectedViaN8n = async () => {
    try {
      const items = backlogs.games
        .filter(i => selectedIds.includes(i.id) && i.source === 'steam')
        .map(i => ({ appid: i?.metadata?.appId || i?.metadata?.steamId || null, title: i.title }));
      if (items.length === 0) return;
      const callable = httpsCallable(fbFunctions, 'scheduleSteamGamesViaN8n');
      const res: any = await callable({ items, settings: { durationMinutes: 120 } });
      alert(`Scheduled ${res?.data?.count ?? items.length} calendar block(s)`);
      setSelectedIds([]);
    } catch (e: any) {
      alert('Failed to schedule via n8n: ' + (e?.message || 'unknown'));
    }
  };

  const addItem = () => {
    if (!newItem.title.trim()) return;

    const item: BacklogItem = {
      id: Date.now().toString(),
      title: newItem.title,
      description: newItem.description || undefined,
      status: 'wishlist',
      priority: newItem.priority,
      dateAdded: new Date(),
      tags: newItem.tags.split(',').map(t => t.trim()).filter(t => t),
      source: newItem.source
    };

    const updatedBacklogs = {
      ...backlogs,
      [activeTab]: [...backlogs[activeTab], item]
    };

    saveBacklogs(updatedBacklogs);
    setShowAddModal(false);
    setNewItem({
      title: '',
      description: '',
      priority: 'medium',
      tags: '',
      source: 'manual'
    });
  };

  const updateItemStatus = async (itemId: string, newStatus: BacklogItem['status']) => {
    const item = backlogs[activeTab].find(entry => entry.id === itemId);
    if (!item) return;

    if (item.source === 'steam') {
      try {
        await updateDoc(doc(db, 'steam', itemId), {
          status: newStatus,
          statusUpdatedAt: serverTimestamp(),
          hidden: newStatus === 'dropped'
        });
      } catch (error) {
        console.error('Failed to update Steam backlog status', error);
      }
      setBacklogs(prev => ({
        ...prev,
        [activeTab]: prev[activeTab].map(entry =>
          entry.id === itemId
            ? { ...entry, status: newStatus, completedDate: newStatus === 'completed' ? new Date() : undefined }
            : entry
        )
      }));
      return;
    }

    const updatedBacklogs = {
      ...backlogs,
      [activeTab]: backlogs[activeTab].map(entry =>
        entry.id === itemId
          ? {
              ...entry,
              status: newStatus,
              completedDate: newStatus === 'completed' ? new Date() : undefined
            }
          : entry
      )
    };
    saveBacklogs(updatedBacklogs);
  };

  const deleteItem = async (itemId: string) => {
    const item = backlogs[activeTab].find(entry => entry.id === itemId);
    if (item?.source === 'steam') {
      try {
        await updateDoc(doc(db, 'steam', itemId), {
          hidden: true,
          status: 'dropped',
          statusUpdatedAt: serverTimestamp()
        });
      } catch (error) {
        console.error('Failed to hide Steam backlog item', error);
      }
      setBacklogs(prev => ({
        ...prev,
        [activeTab]: prev[activeTab].filter(entry => entry.id !== itemId)
      }));
      return;
    }

    const updatedBacklogs = {
      ...backlogs,
      [activeTab]: backlogs[activeTab].filter(entry => entry.id !== itemId)
    };
    saveBacklogs(updatedBacklogs);
  };

  const convertToStory = async (item: BacklogItem, goalId: string, sprintId?: string) => {
    if (!currentUser) return;
    
    try {
      // Create a new story from the backlog item
      const storyData = {
        title: item.title,
        description: item.description || '',
        goalId: goalId,
        status: 'backlog' as const,
        priority: isPriority(item.priority, 'high') ? 3 : 
                 isPriority(item.priority, 'medium') ? 2 : 1,
        points: 3, // Default points
        wipLimit: 3,
        orderIndex: Date.now(),
        persona: currentPersona,
        sprintId: sprintId || undefined,
        tags: item.tags,
        ownerUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      const storyRef = await addDoc(collection(db, 'stories'), storyData);
      
      // Update the backlog item status to completed (converted)
      await updateItemStatus(item.id, 'completed');

      if (item.source === 'steam') {
        try {
          await updateDoc(doc(db, 'steam', item.id), {
            status: 'completed',
            statusUpdatedAt: serverTimestamp(),
            linkedStoryId: storyRef.id
          });
        } catch (error) {
          console.error('Failed to update Steam metadata after story conversion', error);
        }
      }
      
    } catch (error) {
      console.error('Error converting item to story:', error);
    }
  };

  const getThemeColor = (theme?: string | number): string => {
    // Handle both legacy string themes and new numeric themes
    if (typeof theme === 'number') {
      switch (theme) {
        case 1: return 'success'; // Health
        case 2: return 'primary'; // Growth
        case 3: return 'warning'; // Wealth
        case 4: return 'info';    // Tribe
        case 5: return 'secondary'; // Home
        default: return 'light';
      }
    }
    
    // Legacy string support
    switch (theme) {
      case 'Health': return 'success';
      case 'Growth': return 'primary';
      case 'Wealth': return 'warning';
      case 'Tribe': return 'info';
      case 'Home': return 'secondary';
      default: return 'light';
    }
  };

  const getStatusColor = (status: BacklogItem['status']) => {
    switch (status) {
      case 'wishlist': return 'secondary';
      case 'active': return 'primary';
      case 'completed': return 'success';
      case 'dropped': return 'danger';
      default: return 'secondary';
    }
  };

  const getPriorityColor = (priority: BacklogItem['priority']) => {
    switch (priority) {
      case 'high': return 'danger';
      case 'medium': return 'warning';
      case 'low': return 'info';
      default: return 'secondary';
    }
  };

  const filteredItems = backlogs[activeTab].filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesFilter = filterStatus === 'all' || item.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const getTabIcon = (tab: BacklogType) => {
    switch (tab) {
      case 'games': return '🎮';
      case 'movies': return '🎬';
      case 'shows': return '📺';
      case 'books': return '📚';
      case 'custom': return '📋';
      default: return '📋';
    }
  };

  const getTabStats = (type: BacklogType) => {
    const items = backlogs[type];
    return {
      total: items.length,
      active: items.filter(i => isStatus(i.status, 'active')).length,
      completed: items.filter(i => i.status === 'completed').length,
      wishlist: items.filter(i => i.status === 'wishlist').length
    };
  };

  // Get current backlog items for global edit
  const currentItems = filteredItems;

  // Bulk edit handlers
  const handleBulkEdit = async (selectedItems: BacklogItem[], action: string) => {
    try {
      switch (action) {
        case 'edit':
          alert(`Bulk editing ${selectedItems.length} items - feature coming soon!`);
          break;
        case 'duplicate':
          const updatedBacklogs = {
            ...backlogs,
            [activeTab]: [
              ...backlogs[activeTab],
              ...selectedItems.map(item => ({
                ...item,
                id: `${Date.now()}-${Math.random()}`,
                title: `${item.title} (Copy)`,
                dateAdded: new Date()
              }))
            ]
          };
          saveBacklogs(updatedBacklogs);
          break;
        default:
          console.log(`Bulk action ${action} not implemented`);
      }
    } catch (error) {
      console.error('Error performing bulk action:', error);
    }
  };

  const handleBulkDelete = async (itemIds: string[]) => {
    if (itemIds.length === 0) return;

    if (window.confirm(`Are you sure you want to delete ${itemIds.length} item(s)?`)) {
      for (const id of itemIds) {
        await deleteItem(id);
      }
    }
  };

  return (
    <Container fluid>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>Personal Backlogs</h2>
        <div className="d-flex gap-2">
          <Button
            variant={viewMode === 'list' ? 'primary' : 'outline-primary'}
            size="sm"
            onClick={() => setViewMode('list')}
          >
            <List />
          </Button>
          <Button
            variant={viewMode === 'grid' ? 'primary' : 'outline-primary'}
            size="sm"
            onClick={() => setViewMode('grid')}
          >
            <Grid3x3Gap />
          </Button>
          {activeTab === 'games' && selectedIds.length > 0 && (
            <Button variant="outline-success" size="sm" onClick={scheduleSelectedViaN8n}>
              Schedule via n8n ({selectedIds.length})
            </Button>
          )}
          <Button variant="success" onClick={() => setShowAddModal(true)}>
            <Plus className="me-1" />
            Add Item
          </Button>
        </div>
      </div>

      <Tab.Container activeKey={activeTab} onSelect={(k) => setActiveTab(k as BacklogType)}>
        <Row>
          <Col md={3}>
            <Nav variant="pills" className="flex-column">
              {(['games', 'movies', 'shows', 'books', 'custom'] as BacklogType[]).map(type => {
                const stats = getTabStats(type);
                return (
                  <Nav.Item key={type}>
                    <Nav.Link eventKey={type} className="d-flex justify-content-between align-items-center">
                      <span>
                        {getTabIcon(type)} {type.charAt(0).toUpperCase() + type.slice(1)}
                      </span>
                      <div className="d-flex gap-1">
                        <Badge bg="primary" text="white" style={{ fontSize: '0.7rem' }}>
                          {stats.total}
                        </Badge>
                        {stats.active > 0 && (
                          <Badge bg="warning" text="dark" style={{ fontSize: '0.7rem' }}>
                            {stats.active}
                          </Badge>
                        )}
                      </div>
                    </Nav.Link>
                  </Nav.Item>
                );
              })}
            </Nav>

            <Card className="mt-3">
              <Card.Header>Quick Stats</Card.Header>
              <Card.Body>
                {(() => {
                  const stats = getTabStats(activeTab);
                  return (
                    <div className="d-flex flex-column gap-2">
                      <div className="d-flex justify-content-between">
                        <span>Wishlist:</span>
                        <Badge bg="secondary">{stats.wishlist}</Badge>
                      </div>
                      <div className="d-flex justify-content-between">
                        <span>Active:</span>
                        <Badge bg="primary">{stats.active}</Badge>
                      </div>
                      <div className="d-flex justify-content-between">
                        <span>Completed:</span>
                        <Badge bg="success">{stats.completed}</Badge>
                      </div>
                    </div>
                  );
                })()}
              </Card.Body>
            </Card>
          </Col>

          <Col md={9}>
            {/* Search and Filter */}
            <Row className="mb-3">
              <Col md={6}>
                <Form.Control
                  type="text"
                  placeholder={`Search ${activeTab}...`}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </Col>
              <Col md={3}>
                <Form.Select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                >
                  <option value="all">All Status</option>
                  <option value="wishlist">Wishlist</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="dropped">Dropped</option>
                </Form.Select>
              </Col>
            </Row>

            <Tab.Content>
              <Tab.Pane eventKey={activeTab}>
                {filteredItems.length === 0 ? (
                  <Card className="text-center p-4">
                    <Card.Body>
                      <div className="text-muted mb-3">
                        {getTabIcon(activeTab)}
                      </div>
                      <h5>No {activeTab} in your backlog</h5>
                      <p className="text-muted">Start building your collection!</p>
                      <Button variant="primary" onClick={() => setShowAddModal(true)}>
                        <Plus className="me-1" />
                        Add Your First {activeTab.slice(0, -1)}
                      </Button>
                    </Card.Body>
                  </Card>
                ) : viewMode === 'list' ? (
                  <ListGroup>
                    {filteredItems.map(item => {
                      const cover = item.metadata?.coverUrl || item.metadata?.headerUrl;
                      const playtime = item.metadata?.playtimeHours;
                      return (
                        <ListGroup.Item key={item.id}>
                          <div className="d-flex justify-content-between align-items-start">
                            <div className="d-flex flex-grow-1">
                              <div className="me-2 pt-1">
                                <Form.Check
                                  type="checkbox"
                                  checked={selectedIds.includes(item.id)}
                                  onChange={() => toggleSelected(item.id)}
                                />
                              </div>
                              {cover ? (
                                <div className="me-3">
                                  <img
                                    src={cover}
                                    alt={item.title}
                                    style={{ width: 48, height: 72, objectFit: 'cover', borderRadius: 6 }}
                                  />
                                </div>
                              ) : null}
                              <div>
                                <div className="d-flex align-items-center mb-1">
                                  <h6 className="mb-0 me-2">{item.title}</h6>
                                  <Badge bg={getStatusColor(item.status)} className="me-2">
                                    {item.status}
                                  </Badge>
                                  <Badge bg={getPriorityColor(item.priority)}>
                                    {item.priority}
                                  </Badge>
                                </div>
                                {item.description && (
                                  <p className="text-muted mb-1">{item.description}</p>
                                )}
                                {item.tags.length > 0 && (
                                  <div className="d-flex gap-1 flex-wrap">
                                    {item.tags.map(tag => (
                                      <Badge key={tag} bg="light" text="dark" style={{ fontSize: '0.7rem' }}>
                                        {tag}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                                {playtime ? (
                                  <div className="text-muted small mt-1">
                                    {playtime.toFixed(1)} hrs played
                                    {item.metadata?.lastPlayedAt ? ` · Last played ${item.metadata.lastPlayedAt.toLocaleDateString()}` : ''}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                            <div className="d-flex flex-column gap-2 align-items-end">
                              {goals.length > 0 && item.status !== 'completed' && (
                                <Dropdown align="end">
                                  <Dropdown.Toggle variant="outline-primary" size="sm">
                                    Convert to Story
                                  </Dropdown.Toggle>
                                  <Dropdown.Menu>
                                    <Dropdown.Header>Select Goal</Dropdown.Header>
                                    {goals.map(goal => (
                                      <Dropdown.Item key={goal.id}>
                                        <div onClick={() => convertToStory(item, goal.id)}>
                                          <div className="d-flex justify-content-between align-items-center">
                                            <span>{goal.title}</span>
                                            <Badge bg={getThemeColor(goal.theme)} className="ms-1">
                                              {ChoiceHelper.getLabel('goal', 'theme', goal.theme)}
                                            </Badge>
                                          </div>
                                        </div>
                                        {sprints.length > 0 && (
                                          <div className="mt-1">
                                            <small className="text-muted">Add to Sprint:</small>
                                            {sprints.slice(0, 3).map(sprint => (
                                              <div
                                                key={sprint.id}
                                                className="ps-2 py-1 border-start border-2 border-light cursor-pointer"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  convertToStory(item, goal.id, sprint.id);
                                                }}
                                              >
                                                <small>→ {sprint.name}</small>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </Dropdown.Item>
                                    ))}
                                  </Dropdown.Menu>
                                </Dropdown>
                              )}
                              <Form.Select
                                size="sm"
                                value={item.status}
                                onChange={(e) => updateItemStatus(item.id, e.target.value as BacklogItem['status'])}
                              >
                                <option value="wishlist">Wishlist</option>
                                <option value="active">Active</option>
                                <option value="completed">Completed</option>
                                <option value="dropped">Dropped</option>
                              </Form.Select>
                              <Button
                                variant="outline-danger"
                                size="sm"
                                onClick={() => deleteItem(item.id)}
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                        </ListGroup.Item>
                      );
                    })}
                  </ListGroup>
                ) : (
                  <Row xs={1} sm={2} md={2} lg={3} className="g-3">
                    {filteredItems.map(item => {
                      const cover = item.metadata?.coverUrl || item.metadata?.headerUrl;
                      const playtime = item.metadata?.playtimeHours;
                      return (
                        <Col key={item.id}>
                          <Card className="h-100">
                            {cover ? (
                              <Card.Img variant="top" src={cover} style={{ height: 180, objectFit: 'cover' }} />
                            ) : null}
                            <Card.Body>
                              <div className="d-flex justify-content-between align-items-start">
                                <div>
                                  <Card.Title className="h6">{item.title}</Card.Title>
                                  <Badge bg={getStatusColor(item.status)} className="me-2">
                                    {item.status}
                                  </Badge>
                                  <Badge bg={getPriorityColor(item.priority)}>
                                    {item.priority}
                                  </Badge>
                                </div>
                                <div className="text-end" style={{ fontSize: '0.75rem' }}>
                                  <div>{item.dateAdded.toLocaleDateString()}</div>
                                  {item.completedDate && (
                                    <div className="text-success">Completed {item.completedDate.toLocaleDateString()}</div>
                                  )}
                                </div>
                              </div>
                              {item.description && (
                                <Card.Text className="text-muted mt-2">
                                  {item.description.length > 120 ? `${item.description.substring(0, 120)}...` : item.description}
                                </Card.Text>
                              )}
                              {item.tags.length > 0 && (
                                <div className="mb-2">
                                  {item.tags.slice(0, 3).map(tag => (
                                    <Badge key={tag} bg="light" text="dark" className="me-1" style={{ fontSize: '0.7rem' }}>
                                      {tag}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                              {playtime ? (
                                <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                                  {playtime.toFixed(1)} hrs played
                                  {item.metadata?.lastPlayedAt ? ` · Last played ${item.metadata.lastPlayedAt.toLocaleDateString()}` : ''}
                                </div>
                              ) : null}
                            </Card.Body>
                            <Card.Footer className="d-flex flex-column gap-1">
                              {goals.length > 0 && item.status !== 'completed' && (
                                <Dropdown>
                                  <Dropdown.Toggle variant="outline-primary" size="sm" className="w-100">
                                    Convert to Story
                                  </Dropdown.Toggle>
                                  <Dropdown.Menu>
                                    <Dropdown.Header>Select Goal</Dropdown.Header>
                                    {goals.map(goal => (
                                      <Dropdown.Item
                                        key={goal.id}
                                        onClick={() => convertToStory(item, goal.id)}
                                      >
                                        <div className="d-flex justify-content-between align-items-center">
                                          <span>{goal.title}</span>
                                          <Badge bg={getThemeColor(goal.theme)} className="ms-1">
                                            {ChoiceHelper.getLabel('goal', 'theme', goal.theme)}
                                          </Badge>
                                        </div>
                                      </Dropdown.Item>
                                    ))}
                                  </Dropdown.Menu>
                                </Dropdown>
                              )}
                              <div className="d-flex gap-1">
                                <Form.Select
                                  size="sm"
                                  value={item.status}
                                  onChange={(e) => updateItemStatus(item.id, e.target.value as BacklogItem['status'])}
                                >
                                  <option value="wishlist">Wishlist</option>
                                  <option value="active">Active</option>
                                  <option value="completed">Completed</option>
                                  <option value="dropped">Dropped</option>
                                </Form.Select>
                                <Button
                                  variant="outline-danger"
                                  size="sm"
                                  onClick={() => deleteItem(item.id)}
                                >
                                  ×
                                </Button>
                              </div>
                            </Card.Footer>
                          </Card>
                        </Col>
                      );
                    })}
                  </Row>
                )}

              </Tab.Pane>
            </Tab.Content>
          </Col>
        </Row>
      </Tab.Container>

      {/* Add Item Modal */}
      <Modal show={showAddModal} onHide={() => setShowAddModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Add {activeTab.slice(0, -1).charAt(0).toUpperCase() + activeTab.slice(1, -1)}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Title</Form.Label>
              <Form.Control
                type="text"
                value={newItem.title}
                onChange={(e) => setNewItem({ ...newItem, title: e.target.value })}
                placeholder={`Enter ${activeTab.slice(0, -1)} title`}
              />
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={newItem.description}
                onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                placeholder="Optional description"
              />
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Label>Priority</Form.Label>
              <Form.Select
                value={newItem.priority}
                onChange={(e) => setNewItem({ ...newItem, priority: e.target.value as any })}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </Form.Select>
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Label>Tags</Form.Label>
              <Form.Control
                type="text"
                value={newItem.tags}
                onChange={(e) => setNewItem({ ...newItem, tags: e.target.value })}
                placeholder="Enter tags separated by commas"
              />
              <Form.Text className="text-muted">
                e.g., action, adventure, single-player
              </Form.Text>
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowAddModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={addItem} disabled={!newItem.title.trim()}>
            Add {activeTab.slice(0, -1).charAt(0).toUpperCase() + activeTab.slice(1, -1)}
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default BacklogManager;

export {};
