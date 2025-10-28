import React, { useState, useEffect, useCallback } from 'react';
import { Container, Row, Col, Card, Button, Table, Badge, Alert, Form, ProgressBar } from 'react-bootstrap';
import { 
  collection, query, orderBy, limit, onSnapshot, where, 
  startAfter, getDocs, doc, getDoc 
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

// TypeScript interfaces
interface AIUsageLog {
  id: string;
  userId: string;
  functionName: string;
  aiService: string;
  model: string;
  purpose?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    tokensPerSecond: number;
  };
  cost?: {
    estimatedUSD: number;
    promptCostUSD: number;
    completionCostUSD: number;
  };
  performance?: {
    latencyMs: number;
    requestTime: string;
    timestamp: any;
  };
  metadata?: any;
}

interface DailyAggregate {
  id: string;
  date: string;
  totalRequests: number;
  totalTokens: number;
  totalCostUSD: number;
  byService?: Record<string, { requests: number; tokens: number; costUSD: number }>;
  byModel?: Record<string, { requests: number; tokens: number; costUSD: number }>;
  byFunction?: Record<string, { requests: number; tokens: number; costUSD: number }>;
}

interface BreakdownData {
  name: string;
  requests: number;
  tokens: number;
  costUSD: number;
}

/**
 * AI Usage Analytics Dashboard
 * Comprehensive monitoring of LLM usage, costs, and performance
 */
const AIUsageDashboard = () => {
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('7d'); // 7d, 30d, 90d, all
  const [selectedFunction, setSelectedFunction] = useState('all');
  
  // State for different analytics views
  const [usageLogs, setUsageLogs] = useState<AIUsageLog[]>([]);
  const [dailyAggregates, setDailyAggregates] = useState<DailyAggregate[]>([]);
  const [summary, setSummary] = useState({
    totalRequests: 0,
    totalTokens: 0,
    totalCostUSD: 0,
    avgLatency: 0,
    topFunction: '',
    topModel: '',
    currentMonthCost: 0,
    projectedMonthlyCost: 0
  });
  
  const [serviceBreakdown, setServiceBreakdown] = useState<BreakdownData[]>([]);
  const [modelBreakdown, setModelBreakdown] = useState<BreakdownData[]>([]);
  const [functionBreakdown, setFunctionBreakdown] = useState<BreakdownData[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadRecentLogs = useCallback(async () => {
    if (!currentUser) return;
    try {
      const logsRef = collection(db, 'ai_usage_logs');
      let logsQuery = query(
        logsRef,
        where('userId', '==', currentUser.uid),
        orderBy('performance.timestamp', 'desc'),
        limit(100)
      );

      // Add function filter if not 'all'
      if (selectedFunction !== 'all') {
        logsQuery = query(
          logsRef,
          where('userId', '==', currentUser.uid),
          where('functionName', '==', selectedFunction),
          orderBy('performance.timestamp', 'desc'),
          limit(100)
        );
      }

      const snapshot = await getDocs(logsQuery);
      const logs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as AIUsageLog[];

      setUsageLogs(logs);
      console.log(`📊 Loaded ${logs.length} usage logs`);
    } catch (error) {
      console.error('Failed to load recent logs:', error);
    }
  }, [currentUser, selectedFunction]);

  const processServiceBreakdown = useCallback((aggregates: DailyAggregate[]) => {
    const serviceData: Record<string, BreakdownData> = {};
    aggregates.forEach(day => {
      if (day.byService) {
        Object.entries(day.byService).forEach(([service, data]) => {
          if (!serviceData[service]) {
            serviceData[service] = { name: service, requests: 0, tokens: 0, costUSD: 0 };
          }
          serviceData[service].requests += data.requests || 0;
          serviceData[service].tokens += data.tokens || 0;
          serviceData[service].costUSD += data.costUSD || 0;
        });
      }
    });
    setServiceBreakdown(Object.values(serviceData));
  }, []);

  const processModelBreakdown = useCallback((aggregates: DailyAggregate[]) => {
    const modelData: Record<string, BreakdownData> = {};
    aggregates.forEach(day => {
      if (day.byModel) {
        Object.entries(day.byModel).forEach(([model, data]) => {
          if (!modelData[model]) {
            modelData[model] = { name: model, requests: 0, tokens: 0, costUSD: 0 };
          }
          modelData[model].requests += data.requests || 0;
          modelData[model].tokens += data.tokens || 0;
          modelData[model].costUSD += data.costUSD || 0;
        });
      }
    });
    setModelBreakdown(Object.values(modelData));
  }, []);

  const processFunctionBreakdown = useCallback((aggregates: DailyAggregate[]) => {
    const functionData: Record<string, BreakdownData> = {};
    aggregates.forEach(day => {
      if (day.byFunction) {
        Object.entries(day.byFunction).forEach(([func, data]) => {
          if (!functionData[func]) {
            functionData[func] = { name: func, requests: 0, tokens: 0, costUSD: 0 };
          }
          functionData[func].requests += data.requests || 0;
          functionData[func].tokens += data.tokens || 0;
          functionData[func].costUSD += data.costUSD || 0;
        });
      }
    });
    setFunctionBreakdown(Object.values(functionData));
  }, []);

  const loadDailyAggregates = useCallback(async () => {
    if (!currentUser) return;
    try {
      const aggregatesRef = collection(db, 'ai_usage_aggregates');
      const aggregatesQuery = query(
        aggregatesRef,
        orderBy('date', 'desc'),
        limit(parseInt(dateRange.replace('d', '')) || 30)
      );

      const snapshot = await getDocs(aggregatesQuery);
      const aggregates = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as DailyAggregate[];

      setDailyAggregates(aggregates);
      console.log(`📊 Loaded ${aggregates.length} daily aggregates`);
      
      // Process breakdowns
      processServiceBreakdown(aggregates);
      processModelBreakdown(aggregates);
      processFunctionBreakdown(aggregates);
      
    } catch (error) {
      console.error('Failed to load daily aggregates:', error);
    }
  }, [currentUser, dateRange, processServiceBreakdown, processModelBreakdown, processFunctionBreakdown]);

  const calculateSummaryMetrics = useCallback(() => {
    if (usageLogs.length === 0) {
      setSummary(prev => ({
        ...prev,
        totalRequests: 0,
        totalTokens: 0,
        totalCostUSD: 0,
        avgLatency: 0,
        topFunction: '',
        topModel: '',
        currentMonthCost: 0,
        projectedMonthlyCost: 0
      }));
      return;
    }

    const totalRequests = usageLogs.length;
    const totalTokens = usageLogs.reduce((sum, log) => sum + (log.usage?.totalTokens || 0), 0);
    const totalCostUSD = usageLogs.reduce((sum, log) => sum + (log.cost?.estimatedUSD || 0), 0);
    const avgLatency = usageLogs.reduce((sum, log) => sum + (log.performance?.latencyMs || 0), 0) / totalRequests;

    // Find top function and model
    const functionCounts: Record<string, number> = {};
    const modelCounts: Record<string, number> = {};
    usageLogs.forEach(log => {
      functionCounts[log.functionName] = (functionCounts[log.functionName] || 0) + 1;
      modelCounts[log.model] = (modelCounts[log.model] || 0) + 1;
    });

    const topFunction = Object.keys(functionCounts).reduce((a, b) => 
      functionCounts[a] > functionCounts[b] ? a : b, '');
    const topModel = Object.keys(modelCounts).reduce((a, b) => 
      modelCounts[a] > modelCounts[b] ? a : b, '');

    // Calculate current month cost and projection
    const currentMonth = new Date().toISOString().substring(0, 7);
    const currentMonthLogs = usageLogs.filter(log => 
      log.performance?.requestTime?.startsWith(currentMonth)
    );
    const currentMonthCost = currentMonthLogs.reduce((sum, log) => sum + (log.cost?.estimatedUSD || 0), 0);
    
    const daysIntoMonth = new Date().getDate();
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const projectedMonthlyCost = (currentMonthCost / daysIntoMonth) * daysInMonth;

    setSummary({
      totalRequests,
      totalTokens,
      totalCostUSD,
      avgLatency,
      topFunction,
      topModel,
      currentMonthCost,
      projectedMonthlyCost
    });
  }, [usageLogs]);

  useEffect(() => {
    if (!currentUser) return;

    const loadAIUsageData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        console.log('🤖 Loading AI usage analytics...');
        
        await loadRecentLogs();
        await loadDailyAggregates();
        
      } catch (error: any) {
        console.error('❌ Failed to load AI usage data:', error);
        setError(`Failed to load analytics: ${error.message}`);
      } finally {
        setLoading(false);
      }
    };

    loadAIUsageData();
  }, [currentUser, dateRange, selectedFunction, loadRecentLogs, loadDailyAggregates]);

  useEffect(() => {
    calculateSummaryMetrics();
  }, [calculateSummaryMetrics]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4
    }).format(amount);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  if (loading) {
    return (
      <Container className="mt-4">
        <div className="text-center">
          <h4>🤖 Loading AI Usage Analytics...</h4>
          <p>Analyzing token consumption and costs...</p>
        </div>
      </Container>
    );
  }

  return (
    <Container fluid className="mt-4">
      <Row className="mb-4">
        <Col>
          <h2>🤖 AI Usage Analytics Dashboard</h2>
          <p className="text-muted">Monitor LLM usage, token consumption, and costs</p>
        </Col>
      </Row>

      {error && (
        <Alert variant="danger" className="mb-4">
          <strong>Error:</strong> {error}
        </Alert>
      )}

      {/* Controls */}
      <Row className="mb-4">
        <Col md={6}>
          <Form.Group>
            <Form.Label>Date Range</Form.Label>
            <Form.Select 
              value={dateRange} 
              onChange={(e) => setDateRange(e.target.value)}
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="all">All time</option>
            </Form.Select>
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group>
            <Form.Label>Function Filter</Form.Label>
            <Form.Select 
              value={selectedFunction} 
              onChange={(e) => setSelectedFunction(e.target.value)}
            >
              <option value="all">All Functions</option>
              <option value="planCalendar">Calendar Planning</option>
              <option value="prioritizeBacklog">Task Prioritization</option>
            </Form.Select>
          </Form.Group>
        </Col>
      </Row>

      {/* Summary Cards */}
      <Row className="mb-4">
        <Col md={3}>
          <Card className="h-100">
            <Card.Body className="text-center">
              <h5 className="text-primary">{formatNumber(summary.totalRequests)}</h5>
              <small className="text-muted">Total Requests</small>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="h-100">
            <Card.Body className="text-center">
              <h5 className="text-success">{formatNumber(summary.totalTokens)}</h5>
              <small className="text-muted">Total Tokens</small>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="h-100">
            <Card.Body className="text-center">
              <h5 className="text-warning">{formatCurrency(summary.totalCostUSD)}</h5>
              <small className="text-muted">Total Cost</small>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="h-100">
            <Card.Body className="text-center">
              <h5 className="text-info">{Math.round(summary.avgLatency)}ms</h5>
              <small className="text-muted">Avg Latency</small>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Cost Projection */}
      <Row className="mb-4">
        <Col md={6}>
          <Card>
            <Card.Header>💰 Monthly Cost Analysis</Card.Header>
            <Card.Body>
              <div className="d-flex justify-content-between mb-2">
                <span>Current Month:</span>
                <strong>{formatCurrency(summary.currentMonthCost)}</strong>
              </div>
              <div className="d-flex justify-content-between mb-2">
                <span>Projected Monthly:</span>
                <strong className={summary.projectedMonthlyCost > 50 ? 'text-warning' : 'text-success'}>
                  {formatCurrency(summary.projectedMonthlyCost)}
                </strong>
              </div>
              <div className="mt-3">
                <small className="text-muted">Progress toward $50/month</small>
                <ProgressBar 
                  now={(summary.projectedMonthlyCost / 50) * 100} 
                  variant={summary.projectedMonthlyCost > 50 ? 'warning' : 'success'}
                  className="mt-1"
                />
              </div>
              {summary.projectedMonthlyCost > 50 && (
                <Alert variant="warning" className="mt-2 mb-0">
                  <small>⚠️ Projected monthly cost exceeds $50</small>
                </Alert>
              )}
            </Card.Body>
          </Card>
        </Col>
        <Col md={6}>
          <Card>
            <Card.Header>🏆 Top Usage</Card.Header>
            <Card.Body>
              <div className="d-flex justify-content-between mb-2">
                <span>Most Used Function:</span>
                <Badge bg="primary">{summary.topFunction}</Badge>
              </div>
              <div className="d-flex justify-content-between">
                <span>Most Used Model:</span>
                <Badge bg="success">{summary.topModel}</Badge>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Breakdown Tables */}
      <Row className="mb-4">
        <Col md={4}>
          <Card>
            <Card.Header>� Usage by Service</Card.Header>
            <Card.Body>
              <Table size="sm">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Requests</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {serviceBreakdown.map((service, idx) => (
                    <tr key={idx}>
                      <td><Badge bg="info">{service.name}</Badge></td>
                      <td>{formatNumber(service.requests)}</td>
                      <td>{formatCurrency(service.costUSD)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4}>
          <Card>
            <Card.Header>🤖 Usage by Model</Card.Header>
            <Card.Body>
              <Table size="sm">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Tokens</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {modelBreakdown.map((model, idx) => (
                    <tr key={idx}>
                      <td><Badge bg="success">{model.name}</Badge></td>
                      <td>{formatNumber(model.tokens)}</td>
                      <td>{formatCurrency(model.costUSD)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4}>
          <Card>
            <Card.Header>⚙️ Usage by Function</Card.Header>
            <Card.Body>
              <Table size="sm">
                <thead>
                  <tr>
                    <th>Function</th>
                    <th>Requests</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {functionBreakdown.map((func, idx) => (
                    <tr key={idx}>
                      <td><Badge bg="primary">{func.name}</Badge></td>
                      <td>{formatNumber(func.requests)}</td>
                      <td>{formatCurrency(func.costUSD)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Recent Logs Table */}
      <Row>
        <Col>
          <Card>
            <Card.Header>
              📋 Recent AI Requests
              <Badge bg="secondary" className="ms-2">{usageLogs.length}</Badge>
            </Card.Header>
            <Card.Body>
              <Table responsive size="sm">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Function</th>
                    <th>Model</th>
                    <th>Purpose</th>
                    <th>Tokens</th>
                    <th>Cost</th>
                    <th>Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {usageLogs.slice(0, 20).map((log) => (
                    <tr key={log.id}>
                      <td>
                        <small>
                          {log.performance?.requestTime ? 
                            new Date(log.performance.requestTime).toLocaleString() : 
                            'Unknown'
                          }
                        </small>
                      </td>
                      <td>
                        <Badge bg="primary" pill>{log.functionName}</Badge>
                      </td>
                      <td>
                        <Badge bg="success" pill>{log.model}</Badge>
                      </td>
                      <td>
                        <small>{log.purpose || 'N/A'}</small>
                      </td>
                      <td className="text-end">
                        {formatNumber(log.usage?.totalTokens || 0)}
                      </td>
                      <td className="text-end">
                        {formatCurrency(log.cost?.estimatedUSD || 0)}
                      </td>
                      <td className="text-end">
                        <small>{log.performance?.latencyMs || 0}ms</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {usageLogs.length === 0 && (
                <div className="text-center text-muted py-4">
                  No AI usage data found for the selected criteria.
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default AIUsageDashboard;
