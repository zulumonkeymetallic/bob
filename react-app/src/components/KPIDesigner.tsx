import React, { useMemo, useState } from 'react';
import { Alert, Button, Col, Form, Modal, Row } from 'react-bootstrap';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Goal } from '../types';

type KpiType = 'health' | 'calendar' | 'progress' | 'manual';

interface KPIDesignerProps {
  show: boolean;
  onHide: () => void;
  goals: Goal[];
  ownerUid: string;
  onSaved?: () => void;
}

const KPI_TYPE_LABELS: Record<KpiType, string> = {
  health: 'Health Metric',
  calendar: 'Calendar Event',
  progress: 'Progress',
  manual: 'Manual Entry',
};

const KPI_TYPE_UNITS: Record<KpiType, string> = {
  health: '%',
  calendar: 'hours/week',
  progress: '%',
  manual: 'value',
};

const KPIDesigner: React.FC<KPIDesignerProps> = ({
  show,
  onHide,
  goals,
  ownerUid,
  onSaved,
}) => {
  const [goalId, setGoalId] = useState('');
  const [kpiType, setKpiType] = useState<KpiType>('health');
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const sortedGoals = useMemo(() => {
    return [...goals].sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  }, [goals]);

  const reset = () => {
    setGoalId('');
    setKpiType('health');
    setName('');
    setTarget('');
    setUnit('');
    setSaving(false);
    setError('');
    setSuccess('');
  };

  const close = () => {
    reset();
    onHide();
  };

  const handleSave = async () => {
    setError('');
    setSuccess('');

    const parsedTarget = Number(target);
    if (!ownerUid) {
      setError('Sign in required to save KPI.');
      return;
    }
    if (!goalId) {
      setError('Choose a goal before saving.');
      return;
    }
    if (!name.trim()) {
      setError('Enter a KPI name.');
      return;
    }
    if (!Number.isFinite(parsedTarget)) {
      setError('Enter a numeric target value.');
      return;
    }

    const selectedGoal = sortedGoals.find((goal) => goal.id === goalId);
    if (!selectedGoal || selectedGoal.ownerUid !== ownerUid) {
      setError('You can only edit your own goals.');
      return;
    }

    const nextKpi = {
      name: name.trim(),
      target: parsedTarget,
      unit: (unit.trim() || KPI_TYPE_UNITS[kpiType]),
      type: kpiType,
      updatedAt: new Date().toISOString(),
    };

    setSaving(true);
    try {
      const goalRef = doc(db, 'goals', goalId);
      const latestGoalSnap = await getDoc(goalRef);
      const latestGoal = latestGoalSnap.exists() ? latestGoalSnap.data() : null;
      const existingKpis = Array.isArray((latestGoal as any)?.kpis) ? (latestGoal as any).kpis : [];
      await updateDoc(doc(db, 'goals', goalId), {
        kpis: [...existingKpis, nextKpi],
        updatedAt: serverTimestamp(),
      });
      setSuccess('KPI saved to goal.');
      setName('');
      setTarget('');
      setUnit('');
      onSaved?.();
    } catch (e: any) {
      setError(e?.message || 'Failed to save KPI.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal show={show} onHide={close} centered>
      <Modal.Header closeButton>
        <Modal.Title>KPI Designer</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}

        <Form.Group className="mb-3">
          <Form.Label>Goal</Form.Label>
          <Form.Select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
            <option value="">Choose a goal...</option>
            {sortedGoals.map((goal) => (
              <option key={goal.id} value={goal.id}>{goal.title}</option>
            ))}
          </Form.Select>
        </Form.Group>

        <Row className="g-3">
          <Col md={6}>
            <Form.Group>
              <Form.Label>KPI Type</Form.Label>
              <Form.Select value={kpiType} onChange={(e) => setKpiType(e.target.value as KpiType)}>
                {Object.entries(KPI_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>Unit</Form.Label>
              <Form.Control
                value={unit}
                placeholder={KPI_TYPE_UNITS[kpiType]}
                onChange={(e) => setUnit(e.target.value)}
              />
            </Form.Group>
          </Col>
        </Row>

        <Row className="g-3 mt-1">
          <Col md={8}>
            <Form.Group>
              <Form.Label>KPI Name</Form.Label>
              <Form.Control
                value={name}
                placeholder={kpiType === 'calendar' ? 'Triathlon hours per week' : 'Body fat reduction'}
                onChange={(e) => setName(e.target.value)}
              />
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Target</Form.Label>
              <Form.Control
                type="number"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </Form.Group>
          </Col>
        </Row>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={close} disabled={saving}>Close</Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save KPI'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default KPIDesigner;
