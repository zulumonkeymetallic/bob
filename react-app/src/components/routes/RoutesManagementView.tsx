import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Modal, Form, Alert, Table, Badge } from 'react-bootstrap';
import { 
  MapPin, 
  Navigation, 
  Car, 
  Clock, 
  DollarSign,
  Zap,
  TrendingUp,
  Plus,
  Edit,
  Trash2,
  ExternalLink,
  Calendar,
  AlertCircle,
  CheckCircle
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { useTheme } from '../../contexts/ModernThemeContext';

// BOB v3.5.2 - Routes & Routines Management
// FTR-03 Implementation - Daily routine optimization and route planning

interface Routine {
  id: string;
  name: string;
  description?: string;
  category: 'Work' | 'Health' | 'Personal' | 'Travel';
  frequency: 'Daily' | 'Weekly' | 'Monthly' | 'Custom';
  routes: Route[];
  isActive: boolean;
  estimatedTime: number; // minutes
  energyLevel: 'Low' | 'Medium' | 'High';
  priority: number; // 1-5
  linkedGoalId?: string;
  notifications: {
    reminderMinutes: number;
    enableLocationTrigger: boolean;
    enableTimeBasedTrigger: boolean;
  };
  analytics: {
    completionRate: number;
    avgTimeSpent: number;
    lastCompleted?: Date;
    streak: number;
  };
}

interface Route {
  id: string;
  name: string;
  description?: string;
  routineId: string;
  waypoints: Waypoint[];
  transportMode: 'Walking' | 'Driving' | 'Transit' | 'Cycling';
  estimatedTime: number; // minutes
  estimatedDistance: number; // miles
  estimatedCost?: number;
  isOptimized: boolean;
  trafficAware: boolean;
  alternatives: RouteAlternative[];
  lastUsed?: Date;
  usageCount: number;
}

interface Waypoint {
  id: string;
  name: string;
  address: string;
  coordinates: { lat: number; lng: number };
  type: 'Start' | 'Stop' | 'End';
  estimatedDuration: number; // minutes at this location
  notes?: string;
  businessHours?: {
    open: string;
    close: string;
    days: string[];
  };
}

interface RouteAlternative {
  id: string;
  name: string;
  estimatedTime: number;
  estimatedDistance: number;
  estimatedCost?: number;
  trafficCondition: 'Light' | 'Moderate' | 'Heavy';
  avoidTolls: boolean;
  avoidHighways: boolean;
}

interface Goal {
  id: string;
  title: string;
  theme: string;
}

const RoutesManagementView: React.FC = () => {
  const { theme } = useTheme();
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  
  // State management
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedRoutine, setSelectedRoutine] = useState<Routine | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [showRoutineModal, setShowRoutineModal] = useState(false);
  const [showRouteModal, setShowRouteModal] = useState(false);
  const [showOptimizationModal, setShowOptimizationModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'routines' | 'routes' | 'analytics'>('routines');
  const [optimizationResult, setOptimizationResult] = useState<any>(null);
  
  // Load dummy data
  useEffect(() => {
    loadDummyData();
  }, []);
  
  const loadDummyData = () => {
    const dummyGoals: Goal[] = [
      { id: 'goal-1', title: 'Complete Marathon Training', theme: 'Health' },
      { id: 'goal-2', title: 'Launch Side Business', theme: 'Wealth' },
      { id: 'goal-3', title: 'Improve Work-Life Balance', theme: 'Growth' }
    ];
    
    const dummyWaypoints: Waypoint[] = [
      {
        id: 'wp-1',
        name: 'Home',
        address: '123 Main St, City, State',
        coordinates: { lat: 40.7128, lng: -74.0060 },
        type: 'Start',
        estimatedDuration: 0
      },
      {
        id: 'wp-2',
        name: 'Gym',
        address: '456 Fitness Ave, City, State',
        coordinates: { lat: 40.7589, lng: -73.9851 },
        type: 'Stop',
        estimatedDuration: 90,
        businessHours: {
          open: '05:00',
          close: '23:00',
          days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
        }
      },
      {
        id: 'wp-3',
        name: 'Office',
        address: '789 Business Blvd, City, State',
        coordinates: { lat: 40.7505, lng: -73.9934 },
        type: 'End',
        estimatedDuration: 0,
        businessHours: {
          open: '08:00',
          close: '18:00',
          days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
        }
      },
      {
        id: 'wp-4',
        name: 'Coffee Shop',
        address: '321 Cafe St, City, State',
        coordinates: { lat: 40.7614, lng: -73.9776 },
        type: 'Stop',
        estimatedDuration: 15,
        notes: 'Get morning coffee and check emails'
      },
      {
        id: 'wp-5',
        name: 'Grocery Store',
        address: '654 Market Ave, City, State',
        coordinates: { lat: 40.7282, lng: -73.9942 },
        type: 'Stop',
        estimatedDuration: 30
      }
    ];
    
    const dummyRoutes: Route[] = [
      {
        id: 'route-1',
        name: 'Morning Workout Commute',
        description: 'Home → Gym → Coffee → Office',
        routineId: 'routine-1',
        waypoints: [dummyWaypoints[0], dummyWaypoints[1], dummyWaypoints[3], dummyWaypoints[2]],
        transportMode: 'Driving',
        estimatedTime: 45,
        estimatedDistance: 8.5,
        estimatedCost: 12.50,
        isOptimized: true,
        trafficAware: true,
        usageCount: 23,
        lastUsed: new Date('2025-09-01'),
        alternatives: [
          {
            id: 'alt-1',
            name: 'Express Route',
            estimatedTime: 35,
            estimatedDistance: 9.2,
            estimatedCost: 15.00,
            trafficCondition: 'Light',
            avoidTolls: false,
            avoidHighways: false
          },
          {
            id: 'alt-2',
            name: 'Scenic Route',
            estimatedTime: 55,
            estimatedDistance: 7.8,
            estimatedCost: 10.00,
            trafficCondition: 'Moderate',
            avoidTolls: true,
            avoidHighways: true
          }
        ]
      },
      {
        id: 'route-2',
        name: 'Evening Errands',
        description: 'Office → Grocery → Home',
        routineId: 'routine-2',
        waypoints: [dummyWaypoints[2], dummyWaypoints[4], dummyWaypoints[0]],
        transportMode: 'Driving',
        estimatedTime: 25,
        estimatedDistance: 6.2,
        estimatedCost: 8.00,
        isOptimized: false,
        trafficAware: true,
        usageCount: 15,
        lastUsed: new Date('2025-08-30'),
        alternatives: []
      },
      {
        id: 'route-3',
        name: 'Weekend Run Route',
        description: 'Home → Park → Home',
        routineId: 'routine-3',
        waypoints: [dummyWaypoints[0], { ...dummyWaypoints[1], name: 'Central Park', estimatedDuration: 60 }, dummyWaypoints[0]],
        transportMode: 'Walking',
        estimatedTime: 75,
        estimatedDistance: 5.0,
        isOptimized: true,
        trafficAware: false,
        usageCount: 8,
        lastUsed: new Date('2025-08-31'),
        alternatives: []
      }
    ];
    
    const dummyRoutines: Routine[] = [
      {
        id: 'routine-1',
        name: 'Morning Productivity Routine',
        description: 'Workout, coffee, and arrive at office energized',
        category: 'Work',
        frequency: 'Daily',
        routes: [dummyRoutes[0]],
        isActive: true,
        estimatedTime: 135, // includes gym time
        energyLevel: 'High',
        priority: 5,
        linkedGoalId: 'goal-1',
        notifications: {
          reminderMinutes: 30,
          enableLocationTrigger: true,
          enableTimeBasedTrigger: true
        },
        analytics: {
          completionRate: 85,
          avgTimeSpent: 142,
          lastCompleted: new Date('2025-09-01'),
          streak: 12
        }
      },
      {
        id: 'routine-2',
        name: 'Evening Wind-down',
        description: 'Efficient errands and home preparation',
        category: 'Personal',
        frequency: 'Daily',
        routes: [dummyRoutes[1]],
        isActive: true,
        estimatedTime: 55, // includes grocery time
        energyLevel: 'Medium',
        priority: 3,
        notifications: {
          reminderMinutes: 15,
          enableLocationTrigger: true,
          enableTimeBasedTrigger: false
        },
        analytics: {
          completionRate: 92,
          avgTimeSpent: 48,
          lastCompleted: new Date('2025-08-30'),
          streak: 5
        }
      },
      {
        id: 'routine-3',
        name: 'Weekend Training Run',
        description: 'Long run for marathon training',
        category: 'Health',
        frequency: 'Weekly',
        routes: [dummyRoutes[2]],
        isActive: true,
        estimatedTime: 75,
        energyLevel: 'High',
        priority: 4,
        linkedGoalId: 'goal-1',
        notifications: {
          reminderMinutes: 60,
          enableLocationTrigger: false,
          enableTimeBasedTrigger: true
        },
        analytics: {
          completionRate: 75,
          avgTimeSpent: 82,
          lastCompleted: new Date('2025-08-31'),
          streak: 3
        }
      }
    ];
    
    setGoals(dummyGoals);
    setRoutes(dummyRoutes);
    setRoutines(dummyRoutines);
  };
  
  // Route optimization
  const optimizeRoute = async (routeId: string) => {
    const route = routes.find(r => r.id === routeId);
    if (!route) return;
    
    // Mock optimization process
    console.log('🔍 Optimizing route:', route.name);
    
    // Simulate optimization delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Mock optimization results
    const optimization = {
      originalTime: route.estimatedTime,
      optimizedTime: Math.max(route.estimatedTime - 8, route.estimatedTime * 0.8),
      timeSaved: 8,
      fuelSaved: 1.2,
      costSaved: 3.50,
      carbonReduced: 2.1, // kg CO2
      suggestedChanges: [
        'Avoid downtown area during rush hour',
        'Use highway entrance at 5th Street',
        'Stop at grocery store on the way back instead of separate trip'
      ],
      alternativeRoutes: 2,
      trafficPrediction: 'Light traffic expected for next 2 hours'
    };
    
    setOptimizationResult(optimization);
    setShowOptimizationModal(true);
    
    // Apply optimization
    setRoutes(prev => prev.map(r => 
      r.id === routeId 
        ? { 
            ...r, 
            estimatedTime: optimization.optimizedTime,
            isOptimized: true,
            estimatedCost: Math.max((r.estimatedCost || 0) - optimization.costSaved, 0)
          }
        : r
    ));
  };
  
  // Start routine
  const startRoutine = (routineId: string) => {
    const routine = routines.find(r => r.id === routineId);
    if (!routine) return;
    
    console.log('🚀 Starting routine:', routine.name);
    
    // Mock navigation launch (would integrate with Google Maps/Apple Maps)
    if (routine.routes.length > 0) {
      const firstRoute = routine.routes[0];
      console.log('🗺️ Launching navigation for route:', firstRoute.name);
      
      // Update analytics
      setRoutines(prev => prev.map(r => 
        r.id === routineId 
          ? {
              ...r,
              analytics: {
                ...r.analytics,
                lastCompleted: new Date(),
                streak: r.analytics.streak + 1
              }
            }
          : r
      ));
      
      // Mock notification
      alert(`Navigation started for "${firstRoute.name}"\n\nFirst waypoint: ${firstRoute.waypoints[0]?.name}\nEstimated time: ${firstRoute.estimatedTime} minutes`);
    }
  };
  
  // Calculate routine efficiency score
  const calculateEfficiencyScore = (routine: Routine) => {
    const completionWeight = 0.4;
    const timeEfficiencyWeight = 0.3;
    const streakWeight = 0.3;
    
    const completionScore = routine.analytics.completionRate;
    const timeEfficiency = routine.estimatedTime > 0 ? 
      Math.max(0, 100 - ((routine.analytics.avgTimeSpent - routine.estimatedTime) / routine.estimatedTime) * 100) : 100;
    const streakScore = Math.min(routine.analytics.streak * 10, 100);
    
    return Math.round(
      completionScore * completionWeight +
      timeEfficiency * timeEfficiencyWeight +
      streakScore * streakWeight
    );
  };
  
  // Theme colors
  const categoryColors = {
    Work: '#3b82f6',
    Health: '#ef4444',
    Personal: '#10b981',
    Travel: '#8b5cf6'
  };
  
  const energyColors = {
    Low: '#6b7280',
    Medium: '#f59e0b',
    High: '#ef4444'
  };
  
  return (
    <Container fluid className="routes-management">
      <Row className="mb-3">
        <Col>
          <div className="d-flex justify-content-between align-items-center">
            <h2>Routes & Routines</h2>
            <div className="d-flex gap-2">
              <Button 
                variant={activeTab === 'routines' ? 'primary' : 'outline-primary'} 
                size="sm"
                onClick={() => setActiveTab('routines')}
              >
                Routines
              </Button>
              <Button 
                variant={activeTab === 'routes' ? 'primary' : 'outline-primary'} 
                size="sm"
                onClick={() => setActiveTab('routes')}
              >
                Routes
              </Button>
              <Button 
                variant={activeTab === 'analytics' ? 'primary' : 'outline-primary'} 
                size="sm"
                onClick={() => setActiveTab('analytics')}
              >
                Analytics
              </Button>
              <Button 
                variant="primary" 
                size="sm"
                onClick={() => {
                  if (activeTab === 'routines') {
                    setSelectedRoutine(null);
                    setShowRoutineModal(true);
                  } else {
                    setSelectedRoute(null);
                    setShowRouteModal(true);
                  }
                }}
              >
                <Plus size={16} />
                New {activeTab === 'routines' ? 'Routine' : 'Route'}
              </Button>
            </div>
          </div>
        </Col>
      </Row>
      
      {/* Routines Tab */}
      {activeTab === 'routines' && (
        <Row>
          {routines.map(routine => {
            const efficiencyScore = calculateEfficiencyScore(routine);
            const linkedGoal = goals.find(g => g.id === routine.linkedGoalId);
            
            return (
              <Col md={6} lg={4} key={routine.id} className="mb-3">
                <Card className="h-100">
                  <Card.Header>
                    <div className="d-flex justify-content-between align-items-center">
                      <h6 className="mb-0">{routine.name}</h6>
                      <div className="d-flex gap-2">
                        <Badge 
                          bg="secondary"
                          style={{ backgroundColor: categoryColors[routine.category] }}
                        >
                          {routine.category}
                        </Badge>
                        <Badge bg={routine.isActive ? 'success' : 'secondary'}>
                          {routine.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                    </div>
                  </Card.Header>
                  <Card.Body>
                    <p className="text-muted small mb-3">{routine.description}</p>
                    
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <span className="small">
                        <Clock size={12} className="me-1" />
                        {routine.estimatedTime} min
                      </span>
                      <span className="small">
                        <Zap size={12} className="me-1" style={{ color: energyColors[routine.energyLevel] }} />
                        {routine.energyLevel}
                      </span>
                    </div>
                    
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <span className="small">Frequency: {routine.frequency}</span>
                      <span className="small">Priority: {routine.priority}/5</span>
                    </div>
                    
                    {linkedGoal && (
                      <div className="mb-2">
                        <Badge bg="info" className="small">
                          Goal: {linkedGoal.title}
                        </Badge>
                      </div>
                    )}
                    
                    <div className="mb-3">
                      <div className="d-flex justify-content-between small mb-1">
                        <span>Completion Rate</span>
                        <span>{routine.analytics.completionRate}%</span>
                      </div>
                      <div className="progress" style={{ height: '6px' }}>
                        <div 
                          className="progress-bar bg-success" 
                          style={{ width: `${routine.analytics.completionRate}%` }}
                        />
                      </div>
                    </div>
                    
                    <div className="mb-3">
                      <div className="d-flex justify-content-between small mb-1">
                        <span>Efficiency Score</span>
                        <span>{efficiencyScore}/100</span>
                      </div>
                      <div className="progress" style={{ height: '6px' }}>
                        <div 
                          className={`progress-bar ${efficiencyScore >= 80 ? 'bg-success' : efficiencyScore >= 60 ? 'bg-warning' : 'bg-danger'}`}
                          style={{ width: `${efficiencyScore}%` }}
                        />
                      </div>
                    </div>
                    
                    <div className="small text-muted">
                      <div>Streak: {routine.analytics.streak} days</div>
                      <div>Routes: {routine.routes.length}</div>
                      <div>Avg Time: {routine.analytics.avgTimeSpent} min</div>
                    </div>
                  </Card.Body>
                  <Card.Footer>
                    <div className="d-flex gap-2">
                      <Button 
                        size="sm" 
                        variant="success"
                        onClick={() => startRoutine(routine.id)}
                        disabled={!routine.isActive}
                      >
                        <Navigation size={12} className="me-1" />
                        Start
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline-secondary"
                        onClick={() => {
                          setSelectedRoutine(routine);
                          setShowRoutineModal(true);
                        }}
                      >
                        <Edit size={12} />
                      </Button>
                      {routine.routes.length > 0 && (
                        <Button 
                          size="sm" 
                          variant="outline-primary"
                          onClick={() => optimizeRoute(routine.routes[0].id)}
                        >
                          <TrendingUp size={12} />
                        </Button>
                      )}
                    </div>
                  </Card.Footer>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
      
      {/* Routes Tab */}
      {activeTab === 'routes' && (
        <Row>
          <Col>
            <Card>
              <Card.Header>
                <h5>Routes</h5>
              </Card.Header>
              <Card.Body>
                <Table responsive>
                  <thead>
                    <tr>
                      <th>Route Name</th>
                      <th>Transport</th>
                      <th>Distance</th>
                      <th>Time</th>
                      <th>Cost</th>
                      <th>Usage</th>
                      <th>Optimized</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routes.map(route => (
                      <tr key={route.id}>
                        <td>
                          <div>
                            <strong>{route.name}</strong>
                            <div className="small text-muted">{route.description}</div>
                          </div>
                        </td>
                        <td>
                          <Badge bg="secondary">
                            {route.transportMode === 'Driving' && <Car size={12} className="me-1" />}
                            {route.transportMode === 'Walking' && <MapPin size={12} className="me-1" />}
                            {route.transportMode}
                          </Badge>
                        </td>
                        <td>{route.estimatedDistance} mi</td>
                        <td>
                          <Clock size={12} className="me-1" />
                          {route.estimatedTime} min
                        </td>
                        <td>
                          {route.estimatedCost && (
                            <>
                              <DollarSign size={12} className="me-1" />
                              ${route.estimatedCost.toFixed(2)}
                            </>
                          )}
                        </td>
                        <td>
                          <div className="small">
                            <div>Used {route.usageCount}x</div>
                            {route.lastUsed && (
                              <div className="text-muted">
                                Last: {route.lastUsed.toLocaleDateString()}
                              </div>
                            )}
                          </div>
                        </td>
                        <td>
                          {route.isOptimized ? (
                            <Badge bg="success">
                              <CheckCircle size={12} className="me-1" />
                              Optimized
                            </Badge>
                          ) : (
                            <Badge bg="warning">
                              <AlertCircle size={12} className="me-1" />
                              Can Optimize
                            </Badge>
                          )}
                        </td>
                        <td>
                          <div className="d-flex gap-1">
                            <Button 
                              size="sm" 
                              variant="outline-secondary"
                              onClick={() => {
                                setSelectedRoute(route);
                                setShowRouteModal(true);
                              }}
                            >
                              <Edit size={12} />
                            </Button>
                            {!route.isOptimized && (
                              <Button 
                                size="sm" 
                                variant="outline-primary"
                                onClick={() => optimizeRoute(route.id)}
                              >
                                <TrendingUp size={12} />
                              </Button>
                            )}
                            <Button 
                              size="sm" 
                              variant="outline-success"
                              onClick={() => {
                                // Mock external navigation
                                window.open(`https://maps.google.com/`, '_blank');
                              }}
                            >
                              <ExternalLink size={12} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}
      
      {/* Analytics Tab */}
      {activeTab === 'analytics' && (
        <Row>
          <Col md={8}>
            <Card className="mb-3">
              <Card.Header>
                <h5>Routine Performance</h5>
              </Card.Header>
              <Card.Body>
                <Table responsive>
                  <thead>
                    <tr>
                      <th>Routine</th>
                      <th>Completion Rate</th>
                      <th>Efficiency Score</th>
                      <th>Streak</th>
                      <th>Time Variance</th>
                      <th>Last Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routines.map(routine => {
                      const efficiencyScore = calculateEfficiencyScore(routine);
                      const timeVariance = routine.analytics.avgTimeSpent - routine.estimatedTime;
                      
                      return (
                        <tr key={routine.id}>
                          <td>
                            <strong>{routine.name}</strong>
                            <div className="small text-muted">{routine.category}</div>
                          </td>
                          <td>
                            <div className="d-flex align-items-center">
                              <span className="me-2">{routine.analytics.completionRate}%</span>
                              <div className="progress flex-grow-1" style={{ height: '6px' }}>
                                <div 
                                  className="progress-bar bg-success" 
                                  style={{ width: `${routine.analytics.completionRate}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td>
                            <Badge bg={efficiencyScore >= 80 ? 'success' : efficiencyScore >= 60 ? 'warning' : 'danger'}>
                              {efficiencyScore}/100
                            </Badge>
                          </td>
                          <td>{routine.analytics.streak} days</td>
                          <td>
                            <span className={timeVariance > 0 ? 'text-warning' : 'text-success'}>
                              {timeVariance > 0 ? '+' : ''}{timeVariance} min
                            </span>
                          </td>
                          <td>
                            {routine.analytics.lastCompleted?.toLocaleDateString() || 'Never'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
            
            <Card>
              <Card.Header>
                <h5>Route Optimization Opportunities</h5>
              </Card.Header>
              <Card.Body>
                {routes.filter(r => !r.isOptimized).length === 0 ? (
                  <div className="text-center py-4">
                    <CheckCircle size={48} className="text-success mb-3" />
                    <h6>All Routes Optimized!</h6>
                    <p className="text-muted">Your routes are running at peak efficiency.</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-muted mb-3">
                      {routes.filter(r => !r.isOptimized).length} routes can be optimized for better efficiency.
                    </p>
                    
                    {routes
                      .filter(r => !r.isOptimized)
                      .map(route => (
                        <div key={route.id} className="border rounded p-3 mb-2">
                          <div className="d-flex justify-content-between align-items-center">
                            <div>
                              <strong>{route.name}</strong>
                              <div className="small text-muted">
                                Current: {route.estimatedTime} min, {route.estimatedDistance} mi
                              </div>
                            </div>
                            <Button 
                              size="sm" 
                              variant="primary"
                              onClick={() => optimizeRoute(route.id)}
                            >
                              <TrendingUp size={12} className="me-1" />
                              Optimize
                            </Button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </Card.Body>
            </Card>
          </Col>
          
          <Col md={4}>
            <Card className="mb-3">
              <Card.Header>
                <h6>Overall Stats</h6>
              </Card.Header>
              <Card.Body>
                <div className="mb-3">
                  <div className="d-flex justify-content-between">
                    <span>Active Routines</span>
                    <strong>{routines.filter(r => r.isActive).length}</strong>
                  </div>
                </div>
                
                <div className="mb-3">
                  <div className="d-flex justify-content-between">
                    <span>Total Routes</span>
                    <strong>{routes.length}</strong>
                  </div>
                </div>
                
                <div className="mb-3">
                  <div className="d-flex justify-content-between">
                    <span>Optimized Routes</span>
                    <strong>{routes.filter(r => r.isOptimized).length}/{routes.length}</strong>
                  </div>
                </div>
                
                <div className="mb-3">
                  <div className="d-flex justify-content-between">
                    <span>Avg Completion Rate</span>
                    <strong>
                      {Math.round(routines.reduce((sum, r) => sum + r.analytics.completionRate, 0) / routines.length)}%
                    </strong>
                  </div>
                </div>
                
                <div className="mb-3">
                  <div className="d-flex justify-content-between">
                    <span>Longest Streak</span>
                    <strong>
                      {Math.max(...routines.map(r => r.analytics.streak))} days
                    </strong>
                  </div>
                </div>
              </Card.Body>
            </Card>
            
            <Card>
              <Card.Header>
                <h6>Quick Actions</h6>
              </Card.Header>
              <Card.Body>
                <div className="d-grid gap-2">
                  <Button 
                    variant="outline-primary" 
                    size="sm"
                    onClick={() => {
                      // Optimize all routes
                      routes.filter(r => !r.isOptimized).forEach(route => {
                        optimizeRoute(route.id);
                      });
                    }}
                  >
                    <TrendingUp size={16} className="me-2" />
                    Optimize All Routes
                  </Button>
                  
                  <Button 
                    variant="outline-success" 
                    size="sm"
                    onClick={() => {
                      // Start best routine
                      const bestRoutine = routines
                        .filter(r => r.isActive)
                        .sort((a, b) => calculateEfficiencyScore(b) - calculateEfficiencyScore(a))[0];
                      if (bestRoutine) startRoutine(bestRoutine.id);
                    }}
                  >
                    <Navigation size={16} className="me-2" />
                    Start Best Routine
                  </Button>
                  
                  <Button 
                    variant="outline-info" 
                    size="sm"
                    onClick={() => {
                      // Export data
                      const exportData = { routines, routes };
                      console.log('📁 Exporting data:', exportData);
                      alert('Route data exported to console');
                    }}
                  >
                    Export Data
                  </Button>
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}
      
      {/* Routine Modal */}
      <Modal show={showRoutineModal} onHide={() => setShowRoutineModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>
            {selectedRoutine ? 'Edit Routine' : 'Create New Routine'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Row>
              <Col md={8}>
                <Form.Group className="mb-3">
                  <Form.Label>Routine Name</Form.Label>
                  <Form.Control 
                    type="text" 
                    defaultValue={selectedRoutine?.name || ''}
                    placeholder="e.g., Morning Productivity Routine"
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Category</Form.Label>
                  <Form.Select defaultValue={selectedRoutine?.category || 'Personal'}>
                    <option value="Work">Work</option>
                    <option value="Health">Health</option>
                    <option value="Personal">Personal</option>
                    <option value="Travel">Travel</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            
            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control 
                as="textarea" 
                rows={2}
                defaultValue={selectedRoutine?.description || ''}
                placeholder="Brief description of this routine"
              />
            </Form.Group>
            
            <Row>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Frequency</Form.Label>
                  <Form.Select defaultValue={selectedRoutine?.frequency || 'Daily'}>
                    <option value="Daily">Daily</option>
                    <option value="Weekly">Weekly</option>
                    <option value="Monthly">Monthly</option>
                    <option value="Custom">Custom</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Energy Level</Form.Label>
                  <Form.Select defaultValue={selectedRoutine?.energyLevel || 'Medium'}>
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Priority (1-5)</Form.Label>
                  <Form.Control 
                    type="number" 
                    min={1}
                    max={5}
                    defaultValue={selectedRoutine?.priority || 3}
                  />
                </Form.Group>
              </Col>
            </Row>
            
            <Form.Group className="mb-3">
              <Form.Label>Linked Goal</Form.Label>
              <Form.Select defaultValue={selectedRoutine?.linkedGoalId || ''}>
                <option value="">No Goal</option>
                {goals.map(goal => (
                  <option key={goal.id} value={goal.id}>
                    {goal.title} ({goal.theme})
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            
            <Form.Check 
              type="checkbox" 
              label="Active routine"
              defaultChecked={selectedRoutine?.isActive ?? true}
              className="mb-3"
            />
            
            <h6>Notifications</h6>
            <Row>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Reminder (minutes before)</Form.Label>
                  <Form.Control 
                    type="number" 
                    defaultValue={selectedRoutine?.notifications.reminderMinutes || 30}
                    min={0}
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Check 
                  type="checkbox" 
                  label="Location-based triggers"
                  defaultChecked={selectedRoutine?.notifications.enableLocationTrigger ?? true}
                  className="mt-4"
                />
              </Col>
              <Col md={4}>
                <Form.Check 
                  type="checkbox" 
                  label="Time-based triggers"
                  defaultChecked={selectedRoutine?.notifications.enableTimeBasedTrigger ?? true}
                  className="mt-4"
                />
              </Col>
            </Row>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowRoutineModal(false)}>
            Cancel
          </Button>
          <Button variant="primary">
            {selectedRoutine ? 'Update Routine' : 'Create Routine'}
          </Button>
        </Modal.Footer>
      </Modal>
      
      {/* Route Modal */}
      <Modal show={showRouteModal} onHide={() => setShowRouteModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>
            {selectedRoute ? 'Edit Route' : 'Create New Route'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Row>
              <Col md={8}>
                <Form.Group className="mb-3">
                  <Form.Label>Route Name</Form.Label>
                  <Form.Control 
                    type="text" 
                    defaultValue={selectedRoute?.name || ''}
                    placeholder="e.g., Home to Office via Gym"
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Transport Mode</Form.Label>
                  <Form.Select defaultValue={selectedRoute?.transportMode || 'Driving'}>
                    <option value="Driving">Driving</option>
                    <option value="Walking">Walking</option>
                    <option value="Transit">Transit</option>
                    <option value="Cycling">Cycling</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            
            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control 
                type="text" 
                defaultValue={selectedRoute?.description || ''}
                placeholder="Brief description of the route"
              />
            </Form.Group>
            
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Estimated Time (minutes)</Form.Label>
                  <Form.Control 
                    type="number" 
                    defaultValue={selectedRoute?.estimatedTime || 30}
                    min={1}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Estimated Distance (miles)</Form.Label>
                  <Form.Control 
                    type="number" 
                    step="0.1"
                    defaultValue={selectedRoute?.estimatedDistance || 5}
                    min={0.1}
                  />
                </Form.Group>
              </Col>
            </Row>
            
            <Row>
              <Col md={6}>
                <Form.Check 
                  type="checkbox" 
                  label="Traffic-aware routing"
                  defaultChecked={selectedRoute?.trafficAware ?? true}
                  className="mb-3"
                />
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Estimated Cost ($)</Form.Label>
                  <Form.Control 
                    type="number" 
                    step="0.01"
                    defaultValue={selectedRoute?.estimatedCost || 0}
                    min={0}
                  />
                </Form.Group>
              </Col>
            </Row>
            
            <h6>Waypoints</h6>
            <Alert variant="info">
              <MapPin size={16} className="me-2" />
              Waypoint management would include address autocomplete, drag-and-drop reordering, 
              and integration with mapping services for real-time routing.
            </Alert>
            
            <div className="border rounded p-3">
              <p className="text-muted mb-2">Mock waypoints for demonstration:</p>
              <ol className="mb-0">
                <li>Home (Start)</li>
                <li>Gym (Stop - 90 min)</li>
                <li>Coffee Shop (Stop - 15 min)</li>
                <li>Office (End)</li>
              </ol>
            </div>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowRouteModal(false)}>
            Cancel
          </Button>
          <Button variant="primary">
            {selectedRoute ? 'Update Route' : 'Create Route'}
          </Button>
        </Modal.Footer>
      </Modal>
      
      {/* Optimization Results Modal */}
      <Modal show={showOptimizationModal} onHide={() => setShowOptimizationModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Route Optimization Results</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {optimizationResult && (
            <div>
              <Alert variant="success">
                <CheckCircle size={16} className="me-2" />
                Route successfully optimized!
              </Alert>
              
              <Row className="mb-3">
                <Col md={6}>
                  <Card>
                    <Card.Body className="text-center">
                      <h5 className="text-success">{optimizationResult.timeSaved} min</h5>
                      <small>Time Saved</small>
                    </Card.Body>
                  </Card>
                </Col>
                <Col md={6}>
                  <Card>
                    <Card.Body className="text-center">
                      <h5 className="text-success">${optimizationResult.costSaved.toFixed(2)}</h5>
                      <small>Cost Saved</small>
                    </Card.Body>
                  </Card>
                </Col>
              </Row>
              
              <Row className="mb-3">
                <Col md={6}>
                  <Card>
                    <Card.Body className="text-center">
                      <h5 className="text-info">{optimizationResult.fuelSaved.toFixed(1)} gal</h5>
                      <small>Fuel Saved</small>
                    </Card.Body>
                  </Card>
                </Col>
                <Col md={6}>
                  <Card>
                    <Card.Body className="text-center">
                      <h5 className="text-success">{optimizationResult.carbonReduced.toFixed(1)} kg</h5>
                      <small>CO₂ Reduced</small>
                    </Card.Body>
                  </Card>
                </Col>
              </Row>
              
              <h6>Optimization Changes:</h6>
              <ul>
                {optimizationResult.suggestedChanges.map((change: string, index: number) => (
                  <li key={index}>{change}</li>
                ))}
              </ul>
              
              <Alert variant="info">
                <span className="fw-bold">Traffic Prediction:</span> {optimizationResult.trafficPrediction}
              </Alert>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={() => setShowOptimizationModal(false)}>
            Great!
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default RoutesManagementView;
