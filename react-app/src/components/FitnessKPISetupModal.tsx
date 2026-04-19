import React, { useState } from 'react';
import { Modal, Form, Button, Card, Row, Col, Alert, Badge, ListGroup } from 'react-bootstrap';
import { Activity, RefreshCw, Plus, X } from 'lucide-react';

interface FitnessKPISetupModalProps {
  show: boolean;
  onHide: () => void;
  onSave: (kpis: any[]) => void;
  existingKpis?: any[];
  goalTitle?: string;
}

const FITNESS_KPI_TEMPLATES = [
  {
    name: 'Walk 10k steps daily',
    type: 'steps',
    target: 10000,
    unit: 'steps',
    timeframe: 'daily',
    description: 'Track daily steps from HealthKit/Apple Health'
  },
  {
    name: 'Run 5km daily',
    type: 'running_distance',
    target: 5,
    unit: 'km',
    timeframe: 'daily',
    description: 'Sync your daily Strava runs'
  },
  {
    name: 'Run 30km weekly',
    type: 'running_distance',
    target: 30,
    unit: 'km',
    timeframe: 'weekly',
    description: 'Track weekly running distance'
  },
  {
    name: 'Cycle 50km weekly',
    type: 'cycling_distance',
    target: 50,
    unit: 'km',
    timeframe: 'weekly',
    description: 'Track Strava cycling activities'
  },
  {
    name: 'Swim 5km weekly',
    type: 'swimming_distance',
    target: 5,
    unit: 'km',
    timeframe: 'weekly',
    description: 'Track Strava or HealthKit swimming'
  },
  {
    name: 'Walk 50km weekly',
    type: 'walking_distance',
    target: 50,
    unit: 'km',
    timeframe: 'weekly',
    description: 'Track walking + hiking distance'
  },
  {
    name: '3 workouts weekly',
    type: 'workout_count',
    target: 3,
    unit: 'workouts',
    timeframe: 'weekly',
    description: 'Count total workouts (any type)'
  },
  {
    name: 'Custom fitness metric',
    type: 'custom',
    target: 0,
    unit: '',
    timeframe: 'daily',
    description: 'Define your own target'
  }
];

/**
 * Modal for setting up fitness KPIs on a goal
 * Includes templates and custom entry
 */
export const FitnessKPISetupModal: React.FC<FitnessKPISetupModalProps> = ({
  show,
  onHide,
  onSave,
  existingKpis = [],
  goalTitle
}) => {
  const [selectedKpis, setSelectedKpis] = useState<any[]>(existingKpis);
  const [customName, setCustomName] = useState('');
  const [customTarget, setCustomTarget] = useState('');
  const [customUnit, setCustomUnit] = useState('');

  const addTemplate = (template: any) => {
    const newKpi = {
      name: template.name,
      target: template.target,
      unit: template.unit,
      fitnessKpiType: template.type,
      fitnessTimeframe: template.timeframe,
      description: template.description
    };
    setSelectedKpis([...selectedKpis, newKpi]);
  };

  const addCustom = () => {
    if (!customName.trim() || !customTarget) {
      alert('Please fill in name and target');
      return;
    }
    const newKpi = {
      name: customName,
      target: parseFloat(customTarget),
      unit: customUnit,
      description: 'Custom fitness metric'
    };
    setSelectedKpis([...selectedKpis, newKpi]);
    setCustomName('');
    setCustomTarget('');
    setCustomUnit('');
  };

  const removeKpi = (index: number) => {
    setSelectedKpis(selectedKpis.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    onSave(selectedKpis);
    onHide();
  };

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>
          <Activity size={20} className="me-2" style={{ display: 'inline' }} />
          Fitness KPI Setup
        </Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {goalTitle && (
          <Alert variant="info" style={{ fontSize: '13px' }}>
            📍 Setting up fitness metrics for: <strong>{goalTitle}</strong>
          </Alert>
        )}

        {/* Already Added KPIs */}
        {selectedKpis.length > 0 && (
          <div className="mb-4">
            <h6 className="mb-2 fw-semibold">Selected KPIs</h6>
            <ListGroup style={{ marginBottom: '12px' }}>
              {selectedKpis.map((kpi, idx) => (
                <ListGroup.Item
                  key={idx}
                  className="d-flex justify-content-between align-items-center"
                >
                  <div>
                    <div style={{ fontWeight: '500' }}>{kpi.name}</div>
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      Target: {kpi.target} {kpi.unit}
                      {kpi.fitnessTimeframe && ` • ${kpi.fitnessTimeframe}`}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline-danger"
                    onClick={() => removeKpi(idx)}
                  >
                    <X size={14} />
                  </Button>
                </ListGroup.Item>
              ))}
            </ListGroup>
          </div>
        )}

        {/* Quick Templates */}
        <div className="mb-4">
          <h6 className="mb-2 fw-semibold">Popular Templates</h6>
          <Row>
            {FITNESS_KPI_TEMPLATES.map((template, idx) => (
              <Col xs={12} sm={6} key={idx} className="mb-2">
                <Card
                  style={{
                    cursor: template.type === 'custom' ? 'default' : 'pointer',
                    opacity: selectedKpis.some(k => k.name === template.name) ? 0.5 : 1,
                    border:
                      selectedKpis.some(k => k.name === template.name)
                        ? '2px solid #28a745'
                        : '1px solid #ddd'
                  }}
                  onClick={() => {
                    if (template.type !== 'custom' && !selectedKpis.some(k => k.name === template.name)) {
                      addTemplate(template);
                    }
                  }}
                >
                  <Card.Body style={{ padding: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: '600', fontSize: '13px' }}>
                          {template.type === 'custom' ? '+ Add Custom' : template.name}
                        </div>
                        <div style={{ fontSize: '11px', color: '#666' }}>
                          {template.description}
                        </div>
                      </div>
                      {selectedKpis.some(k => k.name === template.name) && (
                        <Badge bg="success" style={{ marginLeft: '8px' }}>
                          ✓
                        </Badge>
                      )}
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            ))}
          </Row>
        </div>

        {/* Custom Entry */}
        <div className="mb-4 p-3 border rounded" style={{ background: '#f8f9fa' }}>
          <h6 className="mb-3 fw-semibold">
            <Plus size={16} style={{ display: 'inline', marginRight: '6px' }} />
            Custom Fitness Metric
          </h6>
          <Form.Group className="mb-2">
            <Form.Label style={{ fontSize: '12px' }}>Metric Name</Form.Label>
            <Form.Control
              size="sm"
              placeholder="e.g., Yoga sessions weekly"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
            />
          </Form.Group>
          <Row>
            <Col md={6}>
              <Form.Group className="mb-2">
                <Form.Label style={{ fontSize: '12px' }}>Target</Form.Label>
                <Form.Control
                  size="sm"
                  type="number"
                  placeholder="e.g., 100"
                  value={customTarget}
                  onChange={(e) => setCustomTarget(e.target.value)}
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-2">
                <Form.Label style={{ fontSize: '12px' }}>Unit</Form.Label>
                <Form.Control
                  size="sm"
                  placeholder="e.g., sessions, km, hours"
                  value={customUnit}
                  onChange={(e) => setCustomUnit(e.target.value)}
                />
              </Form.Group>
            </Col>
          </Row>
          <Button size="sm" variant="outline-primary" onClick={addCustom} className="mt-2">
            <Plus size={14} className="me-1" />
            Add Custom Metric
          </Button>
        </div>

        <Alert variant="info" style={{ fontSize: '12px' }}>
          <RefreshCw size={14} style={{ display: 'inline', marginRight: '6px' }} />
          <strong>Auto-sync:</strong> Your KPIs will sync with Strava and HealthKit every night. Track progress in
          your goal's detail view.
        </Alert>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave}>
          Save KPIs ({selectedKpis.length})
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default FitnessKPISetupModal;
