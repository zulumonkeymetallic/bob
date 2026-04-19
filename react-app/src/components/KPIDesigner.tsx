import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, ListGroup, Modal, Row, Spinner, Tab, Tabs } from 'react-bootstrap';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { Goal } from '../types';
import type { Kpi, KpiDataSource, KpiSourceFieldType, KpiType, MetricBinding } from '../types/KpiTypes';
import {
  KPI_SOURCE_CATALOG,
  KPI_VISUALIZATION_OPTIONS,
  findKpiField,
  findKpiMetric,
  findKpiSource,
} from '../utils/kpiDesignerCatalog';
import { appendGoalKpi } from '../utils/kpiPersistence';

interface LinkedItemOption {
  id: string;
  name: string;
}

interface ObservationRow {
  id: string;
  metricKey: string;
  source: KpiDataSource;
  value: number;
  unit?: string;
  observedAt?: number;
  periodKey?: string;
}

interface KPIDesignerProps {
  show: boolean;
  onHide: () => void;
  goals: Goal[];
  ownerUid: string;
  onSaved?: () => void;
  initialGoalId?: string;
}

const KPI_TYPE_OPTIONS: Array<{ value: KpiType; label: string }> = [
  { value: 'fitness_steps', label: 'Fitness: steps' },
  { value: 'fitness_running', label: 'Fitness: running distance' },
  { value: 'fitness_cycling', label: 'Fitness: cycling distance' },
  { value: 'fitness_swimming', label: 'Fitness: swimming distance' },
  { value: 'fitness_walking', label: 'Fitness: walking distance' },
  { value: 'fitness_workouts', label: 'Fitness: workout count' },
  { value: 'story_points', label: 'Execution: story points' },
  { value: 'tasks_completed', label: 'Execution: tasks completed' },
  { value: 'savings_target', label: 'Finance: savings target' },
  { value: 'budget_tracking', label: 'Finance: budget tracking' },
  { value: 'time_tracked', label: 'Time tracked' },
  { value: 'habit_streak', label: 'Habit streak' },
  { value: 'routine_compliance', label: 'Routine compliance' },
  { value: 'content_production', label: 'Content production' },
  { value: 'custom', label: 'Custom metric' },
];

const DEFAULT_TAB = 'curated';

const catalogSourceToDataSource = (sourceId: string, kpiType?: KpiType): KpiDataSource => {
  if (sourceId === 'healthkit') return 'healthkit';
  if (sourceId === 'strava') return 'strava';
  if (sourceId === 'finance') return 'finance';
  if (sourceId === 'habits') return 'habit_occurrence';
  if (sourceId === 'manual') return 'user_input';
  if (sourceId === 'execution') {
    if (kpiType === 'story_points') return 'story_progress';
    if (kpiType === 'tasks_completed' || kpiType === 'time_tracked') return 'task_progress';
    return 'manual_task';
  }
  return 'user_input';
};

const defaultSourcePriorityFor = (sourceId: string, kpiType?: KpiType): KpiDataSource[] => {
  const primary = catalogSourceToDataSource(sourceId, kpiType);
  if (primary === 'healthkit') return ['healthkit', 'user_input'];
  if (primary === 'strava') return ['strava', 'manual_task', 'user_input'];
  if (primary === 'habit_occurrence') return ['habit_occurrence', 'user_input'];
  if (primary === 'finance') return ['finance', 'user_input'];
  if (primary === 'story_progress') return ['story_progress', 'manual_task'];
  if (primary === 'task_progress') return ['task_progress', 'manual_task'];
  if (primary === 'manual_task') return ['manual_task', 'user_input'];
  return ['user_input'];
};

const defaultGoalId = (goals: Goal[], initialGoalId?: string) => {
  if (initialGoalId && goals.some((goal) => goal.id === initialGoalId)) return initialGoalId;
  return goals[0]?.id || '';
};

const slugify = (value: string) => (
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
);

const KPIDesigner: React.FC<KPIDesignerProps> = ({
  show,
  onHide,
  goals,
  ownerUid,
  onSaved,
  initialGoalId,
}) => {
  const [designerTab, setDesignerTab] = useState<string>(DEFAULT_TAB);
  const [goalId, setGoalId] = useState('');

  const [sourceId, setSourceId] = useState('');
  const [metricId, setMetricId] = useState('');
  const [sourcePriority, setSourcePriority] = useState<KpiDataSource[]>([]);

  const [customSourceId, setCustomSourceId] = useState('manual');
  const [customFieldId, setCustomFieldId] = useState('');
  const [customKpiType, setCustomKpiType] = useState<KpiType>('custom');
  const [customDataType, setCustomDataType] = useState<KpiSourceFieldType>('number');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [target, setTarget] = useState('');
  const [baseline, setBaseline] = useState('');
  const [unit, setUnit] = useState('');
  const [timeframe, setTimeframe] = useState<'daily' | 'weekly' | 'monthly' | 'sprint' | 'quarterly' | 'annual'>('weekly');
  const [aggregation, setAggregation] = useState<'sum' | 'average' | 'min' | 'max' | 'count' | 'latest'>('sum');
  const [targetDirection, setTargetDirection] = useState<'increase' | 'decrease' | 'maintain'>('increase');
  const [visualizationType, setVisualizationType] = useState<'metric' | 'progress' | 'line' | 'bar' | 'table'>('progress');
  const [displayOnDashboard, setDisplayOnDashboard] = useState(true);

  const [categoryFilter, setCategoryFilter] = useState('');
  const [contentType, setContentType] = useState('');
  const [platform, setPlatform] = useState('');
  const [formula, setFormula] = useState('');
  const [linkedRoutineIds, setLinkedRoutineIds] = useState<string[]>([]);
  const [linkedHabitIds, setLinkedHabitIds] = useState<string[]>([]);
  const [lookbackDays, setLookbackDays] = useState('100');
  const [complianceThreshold, setComplianceThreshold] = useState('80');
  const [routines, setRoutines] = useState<LinkedItemOption[]>([]);
  const [habits, setHabits] = useState<LinkedItemOption[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [observations, setObservations] = useState<ObservationRow[]>([]);

  const sortedGoals = useMemo(
    () => [...goals].sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''))),
    [goals],
  );

  const selectedGoal = useMemo(
    () => sortedGoals.find((goal) => goal.id === goalId) || null,
    [goalId, sortedGoals],
  );

  const selectedSource = useMemo(() => findKpiSource(sourceId), [sourceId]);
  const selectedMetric = useMemo(() => findKpiMetric(sourceId, metricId), [metricId, sourceId]);
  const selectedCustomSource = useMemo(() => findKpiSource(customSourceId), [customSourceId]);
  const selectedCustomField = useMemo(() => findKpiField(customSourceId, customFieldId), [customFieldId, customSourceId]);
  const isCuratedMode = designerTab === 'curated';
  const effectiveType = isCuratedMode ? selectedMetric?.kpiType : customKpiType;

  useEffect(() => {
    if (!show) return;
    setGoalId(defaultGoalId(sortedGoals, initialGoalId));
    setDesignerTab(DEFAULT_TAB);
  }, [initialGoalId, show, sortedGoals]);

  useEffect(() => {
    if (!show || !ownerUid) return;
    let mounted = true;

    const loadLinkedItems = async () => {
      try {
        const [routineSnap, habitSnap, observationSnap] = await Promise.all([
          getDocs(query(collection(db, 'routines'), where('ownerUid', '==', ownerUid))),
          getDocs(query(collection(db, 'habits'), where('ownerUid', '==', ownerUid))),
          getDocs(query(collection(db, 'metric_values'), where('ownerUid', '==', ownerUid))),
        ]);

        if (!mounted) return;
        setRoutines(
          routineSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            name: String((docSnap.data() as any)?.title || (docSnap.data() as any)?.name || 'Routine'),
          })),
        );
        setHabits(
          habitSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            name: String((docSnap.data() as any)?.name || 'Habit'),
          })),
        );
        setObservations(
          observationSnap.docs
            .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
            .filter((row: any) => Number.isFinite(Number(row?.value)))
            .sort((a: any, b: any) => Number(b?.observedAt || 0) - Number(a?.observedAt || 0)) as ObservationRow[],
        );
      } catch {
        if (!mounted) return;
        setRoutines([]);
        setHabits([]);
        setObservations([]);
      }
    };

    void loadLinkedItems();
    return () => {
      mounted = false;
    };
  }, [ownerUid, show]);

  useEffect(() => {
    if (!selectedMetric || !isCuratedMode) return;
    setSourcePriority(defaultSourcePriorityFor(sourceId, selectedMetric.kpiType));
    setName(selectedMetric.label);
    setDescription(selectedMetric.description);
    setTarget(String(selectedMetric.defaultTarget));
    setUnit(selectedMetric.unit);
    setTimeframe(selectedMetric.defaultTimeframe);
    setAggregation(selectedMetric.defaultAggregation);
    setTargetDirection(selectedMetric.defaultTargetDirection);
    setVisualizationType(selectedMetric.defaultVisualization);
  }, [isCuratedMode, selectedMetric]);

  useEffect(() => {
    if (!selectedCustomField || isCuratedMode) return;
    setCustomDataType(selectedCustomField.dataType);
    setUnit((current) => current || selectedCustomField.unit || '');
    setName((current) => current || selectedCustomField.label);
    setDescription((current) => current || selectedCustomField.description);
    setSourcePriority(defaultSourcePriorityFor(customSourceId, customKpiType));
  }, [customSourceId, isCuratedMode, selectedCustomField, selectedCustomSource?.label]);

  const clearTypeSpecificFields = () => {
    setCategoryFilter('');
    setContentType('');
    setPlatform('');
    setFormula('');
    setLinkedRoutineIds([]);
    setLinkedHabitIds([]);
    setLookbackDays('100');
    setComplianceThreshold('80');
  };

  const reset = () => {
    setDesignerTab(DEFAULT_TAB);
    setGoalId(defaultGoalId(sortedGoals, initialGoalId));
    setSourceId('');
    setMetricId('');
    setSourcePriority([]);
    setCustomSourceId('manual');
    setCustomFieldId('');
    setCustomKpiType('custom');
    setCustomDataType('number');
    setName('');
    setDescription('');
    setTarget('');
    setBaseline('');
    setUnit('');
    setTimeframe('weekly');
    setAggregation('sum');
    setTargetDirection('increase');
    setVisualizationType('progress');
    setDisplayOnDashboard(true);
    clearTypeSpecificFields();
    setError('');
    setSuccess('');
    setSaving(false);
  };

  const close = () => {
    reset();
    onHide();
  };

  const handleToggleLinkedId = (current: string[], id: string, setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    setter(current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };

  const validateCommon = () => {
    if (!ownerUid) return 'Sign in required to save KPI.';
    if (!goalId || !selectedGoal) return 'Choose a goal before saving.';
    if (!name.trim()) return 'Enter a KPI name.';
    const parsedTarget = Number(target);
    if (!Number.isFinite(parsedTarget)) return 'Enter a numeric target value.';
    if (baseline.trim() && !Number.isFinite(Number(baseline))) return 'Baseline must be numeric when provided.';
    return null;
  };

  const buildCommonPayload = () => {
    const parsedTarget = Number(target);
    const parsedBaseline = baseline.trim() ? Number(baseline) : null;
    const effectivePriority = sourcePriority.length > 0 ? sourcePriority : defaultSourcePriorityFor(isCuratedMode ? sourceId : customSourceId, effectiveType);

    return {
      id: `kpi_${Date.now()}`,
      name: name.trim(),
      description: description.trim(),
      timeframe,
      target: parsedTarget,
      unit: unit.trim(),
      baseline: parsedBaseline,
      aggregation,
      targetDirection,
      visualizationType,
      displayOnDashboard,
      freshnessWindowHours: 24,
      sourcePriority: effectivePriority,
      tags: [] as string[],
      goalId,
    };
  };

  const buildBinding = (params: {
    source: KpiDataSource;
    metricKey: string;
    fieldId?: string;
    collection?: string | null;
    fieldPath?: string | null;
    dataType?: KpiSourceFieldType;
    unit?: string;
    label?: string;
  }): MetricBinding => ({
    source: params.source,
    metricKey: params.metricKey,
    fieldId: params.fieldId,
    collection: params.collection || null,
    fieldPath: params.fieldPath || null,
    aggregation,
    timeframe,
    dataType: params.dataType,
    unit: params.unit || unit.trim(),
    label: params.label,
  });

  const buildCuratedKpi = (): Kpi | null => {
    if (!selectedMetric || !selectedSource) {
      setError('Choose a curated source and metric.');
      return null;
    }

    const payload: Record<string, any> = {
      ...buildCommonPayload(),
      type: selectedMetric.kpiType,
      sourceId,
      sourceLabel: selectedSource.label,
      metricId,
      metricKey: metricId,
      sourceCollection: selectedSource.fields[0]?.collection || null,
      sourceMetricLabel: selectedMetric.label,
      designerMode: 'curated',
      icon: selectedMetric.tags?.[0] || 'target',
      tags: [sourceId, metricId, ...(selectedMetric.tags || [])].filter(Boolean),
    };

    const primarySource = catalogSourceToDataSource(sourceId, selectedMetric.kpiType);
    const matchedField = selectedSource.fields.find((field) => field.unit === selectedMetric.unit) || selectedSource.fields[0];
    payload.sourceBindings = {
      [primarySource]: buildBinding({
        source: primarySource,
        metricKey: metricId,
        fieldId: matchedField?.id,
        collection: matchedField?.collection || null,
        fieldPath: matchedField?.fieldPath || null,
        dataType: matchedField?.dataType,
        unit: selectedMetric.unit,
        label: selectedMetric.label,
      }),
    };

    return payload as Kpi;
  };

  const buildCustomKpi = (): Kpi | null => {
    if (!customSourceId) {
      setError('Choose a source family for the KPI.');
      return null;
    }
    if (!selectedCustomField || !selectedCustomSource) {
      setError('Choose a source field from the explorer.');
      return null;
    }

    const source = selectedCustomSource;
    const primarySource = catalogSourceToDataSource(customSourceId, customKpiType);
    const metricKey = selectedCustomField.fieldPath || selectedCustomField.id;
    const payload: Record<string, any> = {
      ...buildCommonPayload(),
      type: customKpiType,
      sourceId: customSourceId,
      sourceLabel: source?.label || customSourceId,
      metricId: metricKey,
      metricKey,
      sourceCollection: selectedCustomField.collection || source?.fields[0]?.collection || 'manual',
      sourceFieldPath: selectedCustomField.fieldPath,
      sourceDataType: customDataType,
      sourceMetricLabel: selectedCustomField.label,
      designerMode: 'registry',
      icon: source?.metrics[0]?.tags?.[0] || 'target',
      tags: [customSourceId, metricKey, 'registry-designed'].filter(Boolean),
      sourceBindings: {
        [primarySource]: buildBinding({
          source: primarySource,
          metricKey,
          fieldId: selectedCustomField.id,
          collection: selectedCustomField.collection,
          fieldPath: selectedCustomField.fieldPath,
          dataType: selectedCustomField.dataType,
          unit: selectedCustomField.unit || unit.trim(),
          label: selectedCustomField.label,
        }),
      },
    };

    return payload as Kpi;
  };

  const applyTypeSpecificPayload = (payload: Record<string, any>) => {
    switch (effectiveType) {
      case 'story_points':
        payload.linkedStories = [];
        break;
      case 'tasks_completed':
        payload.linkedTasks = [];
        break;
      case 'savings_target':
        payload.potId = selectedGoal?.linkedPotId || selectedGoal?.potId || selectedGoal?.monzoPotId || null;
        payload.currencyCode = payload.unit || 'GBP';
        break;
      case 'budget_tracking':
        payload.categoryFilter = categoryFilter.trim() || null;
        payload.currencyCode = payload.unit || 'GBP';
        break;
      case 'habit_streak':
        payload.linkedHabitIds = linkedHabitIds;
        payload.weeklyGoal = Number(payload.target || 0);
        break;
      case 'routine_compliance':
        payload.linkedRoutineIds = linkedRoutineIds;
        payload.lookbackDays = Number(lookbackDays || 100);
        payload.complianceThreshold = Number(complianceThreshold || 80);
        payload.linkedMetric = description.trim() || name.trim();
        break;
      case 'content_production':
        payload.contentType = contentType.trim() || 'article';
        payload.platform = platform.trim() || 'general';
        break;
      case 'custom':
        payload.formula = formula.trim() || undefined;
        payload.dataSource = payload.sourceId === 'manual' ? 'manual' : 'external';
        break;
      default:
        break;
    }
  };

  const handleSave = async () => {
    setError('');
    setSuccess('');

    const commonError = validateCommon();
    if (commonError) {
      setError(commonError);
      return;
    }

    const payload = isCuratedMode ? buildCuratedKpi() : buildCustomKpi();
    if (!payload) return;

    const nextKpi: Record<string, any> = { ...payload };
    applyTypeSpecificPayload(nextKpi);

    setSaving(true);
    try {
      await appendGoalKpi({
        goalId,
        ownerUid,
        kpi: nextKpi as Kpi,
      });
      setSuccess(isCuratedMode ? 'Curated KPI saved to goal.' : 'Custom KPI saved to goal.');
      onSaved?.();
      clearTypeSpecificFields();
    } catch (e: any) {
      setError(e?.message || 'Failed to save KPI.');
    } finally {
      setSaving(false);
    }
  };

  const renderTypeSpecificFields = () => {
    if (!effectiveType) return null;

    if (effectiveType === 'budget_tracking') {
      return (
        <Form.Group className="mb-3">
          <Form.Label>Budget category filter</Form.Label>
          <Form.Control
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            placeholder="eating_out, groceries, discretionary"
          />
        </Form.Group>
      );
    }

    if (effectiveType === 'content_production') {
      return (
        <Row className="g-3 mb-3">
          <Col md={6}>
            <Form.Group>
              <Form.Label>Content type</Form.Label>
              <Form.Control value={contentType} onChange={(e) => setContentType(e.target.value)} placeholder="article, video, post" />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>Platform</Form.Label>
              <Form.Control value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="substack, youtube, linkedin" />
            </Form.Group>
          </Col>
        </Row>
      );
    }

    if (effectiveType === 'routine_compliance') {
      return (
        <>
          <Row className="g-3 mb-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label>Lookback days</Form.Label>
                <Form.Control type="number" value={lookbackDays} onChange={(e) => setLookbackDays(e.target.value)} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Compliance threshold (%)</Form.Label>
                <Form.Control type="number" value={complianceThreshold} onChange={(e) => setComplianceThreshold(e.target.value)} />
              </Form.Group>
            </Col>
          </Row>
          <Form.Group className="mb-3">
            <Form.Label>Linked routines</Form.Label>
            <div className="d-flex flex-wrap gap-3">
              {routines.length === 0 && <div className="text-muted small">No routines found.</div>}
              {routines.map((routine) => (
                <Form.Check
                  key={routine.id}
                  type="checkbox"
                  id={`routine-${routine.id}`}
                  label={routine.name}
                  checked={linkedRoutineIds.includes(routine.id)}
                  onChange={() => handleToggleLinkedId(linkedRoutineIds, routine.id, setLinkedRoutineIds)}
                />
              ))}
            </div>
          </Form.Group>
        </>
      );
    }

    if (effectiveType === 'habit_streak') {
      return (
        <Form.Group className="mb-3">
          <Form.Label>Linked habits</Form.Label>
          <div className="d-flex flex-wrap gap-3">
            {habits.length === 0 && <div className="text-muted small">No habits found.</div>}
            {habits.map((habit) => (
              <Form.Check
                key={habit.id}
                type="checkbox"
                id={`habit-${habit.id}`}
                label={habit.name}
                checked={linkedHabitIds.includes(habit.id)}
                onChange={() => handleToggleLinkedId(linkedHabitIds, habit.id, setLinkedHabitIds)}
              />
            ))}
          </div>
        </Form.Group>
      );
    }

    if (effectiveType === 'custom') {
      return (
        <Form.Group className="mb-3">
          <Form.Label>Formula / interpretation notes</Form.Label>
          <Form.Control
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
            placeholder="Optional formula, manual rule, or transformation notes"
          />
        </Form.Group>
      );
    }

    return null;
  };

  const promoteObservation = (observation: ObservationRow) => {
    const matchedSource = KPI_SOURCE_CATALOG.find((source) => catalogSourceToDataSource(source.id, customKpiType) === observation.source)
      || KPI_SOURCE_CATALOG.find((source) => source.id === 'manual');
    const matchedField = matchedSource?.fields.find((field) => field.fieldPath === observation.metricKey || field.id === observation.metricKey)
      || matchedSource?.fields[0];
    setDesignerTab('custom');
    if (matchedSource) setCustomSourceId(matchedSource.id);
    if (matchedField) {
      setCustomFieldId(matchedField.id);
      setCustomDataType(matchedField.dataType);
      setUnit(matchedField.unit || observation.unit || '');
      setName(matchedField.label);
      setDescription(matchedField.description);
    } else {
      setName(observation.metricKey);
    }
    setTarget((current) => current || String(Math.max(1, Math.round(Number(observation.value || 0)))));
    setSourcePriority((prev) => prev.length > 0 ? prev : [observation.source, 'user_input']);
  };

  return (
    <Modal show={show} onHide={close} size="xl" centered>
      <Modal.Header closeButton>
        <Modal.Title>KPI Designer</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}

        <Row className="g-3 mb-3">
          <Col md={5}>
            <Form.Group>
              <Form.Label>Goal</Form.Label>
              <Form.Select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                <option value="">Choose a goal…</option>
                {sortedGoals.map((goal) => (
                  <option key={goal.id} value={goal.id}>{goal.title}</option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={7}>
            <Card className="border-0" style={{ background: 'var(--bs-light-bg-subtle, #f8f9fa)' }}>
              <Card.Body className="py-2">
                <div className="fw-semibold">Design modes</div>
                <div className="text-muted small">
                  `Curated metrics` gives a guided KPI setup from supported metrics. `Source explorer` lets users browse structured source fields, define source priority, and map the KPI without free-form field paths.
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        <Tabs activeKey={designerTab} onSelect={(key) => setDesignerTab(key || DEFAULT_TAB)} className="mb-3">
          <Tab eventKey="curated" title="Curated metrics">
            <Row className="g-3 mt-1">
              <Col lg={4}>
                <Card className="h-100">
                  <Card.Body className="p-0">
                    <ListGroup variant="flush">
                      {KPI_SOURCE_CATALOG.map((source) => (
                        <ListGroup.Item
                          key={source.id}
                          action
                          active={sourceId === source.id}
                          onClick={() => {
                            setSourceId(source.id);
                            setMetricId('');
                          }}
                        >
                          <div className="fw-semibold">{source.label}</div>
                          <div className="small opacity-75">{source.description}</div>
                        </ListGroup.Item>
                      ))}
                    </ListGroup>
                  </Card.Body>
                </Card>
              </Col>
              <Col lg={8}>
                <Row className="g-3">
                  <Col xl={6}>
                    <Card className="mb-3">
                      <Card.Header className="fw-semibold">Available curated metrics</Card.Header>
                      <Card.Body className="p-0">
                        {!selectedSource ? (
                          <div className="p-3 text-muted small">Choose a source to browse curated metrics.</div>
                        ) : (
                          <ListGroup variant="flush">
                            {selectedSource.metrics.map((metric) => (
                              <ListGroup.Item
                                key={metric.id}
                                action
                                active={metricId === metric.id}
                                onClick={() => setMetricId(metric.id)}
                              >
                                <div className="d-flex align-items-center justify-content-between gap-2">
                                  <div>
                                    <div className="fw-semibold">{metric.label}</div>
                                    <div className="small opacity-75">{metric.description}</div>
                                  </div>
                                  <Badge bg="light" text="dark">{metric.unit}</Badge>
                                </div>
                              </ListGroup.Item>
                            ))}
                          </ListGroup>
                        )}
                      </Card.Body>
                    </Card>

                    <Card>
                      <Card.Header className="fw-semibold">Curated metric details</Card.Header>
                      <Card.Body>
                        {!selectedMetric ? (
                          <div className="text-muted small">Select a curated metric to prefill the KPI form.</div>
                        ) : (
                          <>
                            <div className="fw-semibold">{selectedMetric.label}</div>
                            <div className="text-muted small mb-2">{selectedMetric.description}</div>
                            <div className="d-flex gap-2 flex-wrap">
                              <Badge bg="primary">{selectedMetric.kpiType}</Badge>
                              <Badge bg="secondary">{selectedMetric.defaultTimeframe}</Badge>
                              <Badge bg="light" text="dark">{selectedMetric.defaultAggregation}</Badge>
                              <Badge bg="light" text="dark">{selectedMetric.defaultTarget} {selectedMetric.unit}</Badge>
                            </div>
                          </>
                        )}
                      </Card.Body>
                    </Card>
                  </Col>

                  <Col xl={6}>
                    <Card>
                      <Card.Header className="fw-semibold">Curated KPI form</Card.Header>
                      <Card.Body>
                        <Form.Group className="mb-3">
                          <Form.Label>KPI name</Form.Label>
                          <Form.Control value={name} onChange={(e) => setName(e.target.value)} placeholder="Run 10k a day" />
                        </Form.Group>
                        <Form.Group className="mb-3">
                          <Form.Label>Description</Form.Label>
                          <Form.Control as="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
                        </Form.Group>
                        <Row className="g-3 mb-3">
                          <Col md={4}>
                            <Form.Group>
                              <Form.Label>Target</Form.Label>
                              <Form.Control type="number" value={target} onChange={(e) => setTarget(e.target.value)} />
                            </Form.Group>
                          </Col>
                          <Col md={4}>
                            <Form.Group>
                              <Form.Label>Baseline</Form.Label>
                              <Form.Control type="number" value={baseline} onChange={(e) => setBaseline(e.target.value)} />
                            </Form.Group>
                          </Col>
                          <Col md={4}>
                            <Form.Group>
                              <Form.Label>Unit</Form.Label>
                              <Form.Control value={unit} onChange={(e) => setUnit(e.target.value)} />
                            </Form.Group>
                          </Col>
                        </Row>
                        <Row className="g-3 mb-3">
                          <Col md={4}>
                            <Form.Group>
                              <Form.Label>Timeframe</Form.Label>
                              <Form.Select value={timeframe} onChange={(e) => setTimeframe(e.target.value as any)}>
                                <option value="daily">Daily</option>
                                <option value="weekly">Weekly</option>
                                <option value="monthly">Monthly</option>
                                <option value="sprint">Sprint</option>
                                <option value="quarterly">Quarterly</option>
                                <option value="annual">Annual</option>
                              </Form.Select>
                            </Form.Group>
                          </Col>
                          <Col md={4}>
                            <Form.Group>
                              <Form.Label>Aggregation</Form.Label>
                              <Form.Select value={aggregation} onChange={(e) => setAggregation(e.target.value as any)}>
                                <option value="sum">Sum</option>
                                <option value="average">Average</option>
                                <option value="min">Minimum</option>
                                <option value="max">Maximum</option>
                                <option value="count">Count</option>
                                <option value="latest">Latest</option>
                              </Form.Select>
                            </Form.Group>
                          </Col>
                          <Col md={4}>
                            <Form.Group>
                              <Form.Label>Target direction</Form.Label>
                              <Form.Select value={targetDirection} onChange={(e) => setTargetDirection(e.target.value as any)}>
                                <option value="increase">Increase</option>
                                <option value="decrease">Decrease</option>
                                <option value="maintain">Maintain</option>
                              </Form.Select>
                            </Form.Group>
                          </Col>
                        </Row>
                        <Form.Group className="mb-3">
                          <Form.Label>Source priority / fallback</Form.Label>
                          <div className="d-flex flex-wrap gap-3">
                            {defaultSourcePriorityFor(sourceId, selectedMetric?.kpiType).map((candidate) => (
                              <Form.Check
                                key={`curated-priority-${candidate}`}
                                type="checkbox"
                                id={`curated-priority-${candidate}`}
                                label={candidate}
                                checked={sourcePriority.includes(candidate)}
                                onChange={() => {
                                  setSourcePriority((prev) => (
                                    prev.includes(candidate)
                                      ? prev.filter((value) => value !== candidate)
                                      : [...prev, candidate]
                                  ));
                                }}
                              />
                            ))}
                          </div>
                          <div className="text-muted small mt-2">
                            Automated sources fall back when their latest data is older than 24 hours.
                          </div>
                        </Form.Group>
                        {renderTypeSpecificFields()}
                      </Card.Body>
                    </Card>
                  </Col>
                </Row>
              </Col>
            </Row>
          </Tab>

          <Tab eventKey="custom" title="Source explorer">
            <Row className="g-3 mt-1">
              <Col lg={4}>
                <Card className="mb-3">
                  <Card.Header className="fw-semibold">Source family</Card.Header>
                  <Card.Body>
                    <Form.Select
                      value={customSourceId}
                      onChange={(e) => {
                        setCustomSourceId(e.target.value);
                        setCustomFieldId('');
                        setCustomDataType('number');
                        setSourcePriority(defaultSourcePriorityFor(e.target.value, customKpiType));
                      }}
                    >
                      {KPI_SOURCE_CATALOG.map((source) => (
                        <option key={source.id} value={source.id}>{source.label}</option>
                      ))}
                    </Form.Select>
                    <div className="text-muted small mt-2">
                      {selectedCustomSource?.description || 'Choose a source family.'}
                    </div>
                  </Card.Body>
                </Card>

                <Card className="h-100">
                  <Card.Header className="fw-semibold">Available data points</Card.Header>
                  <Card.Body className="p-0">
                    {!selectedCustomSource ? (
                      <div className="p-3 text-muted small">Choose a source family to browse fields.</div>
                    ) : (
                      <ListGroup variant="flush">
                        {selectedCustomSource.fields.map((field) => (
                          <ListGroup.Item
                            key={field.id}
                            action
                            active={customFieldId === field.id}
                            onClick={() => setCustomFieldId(field.id)}
                          >
                            <div className="d-flex align-items-center justify-content-between gap-2">
                              <div>
                                <div className="fw-semibold">{field.label}</div>
                                <div className="small opacity-75">{field.description}</div>
                                <code className="small">{field.collection}.{field.fieldPath}</code>
                              </div>
                              <Badge bg="light" text="dark">{field.unit || field.dataType}</Badge>
                            </div>
                          </ListGroup.Item>
                        ))}
                      </ListGroup>
                    )}
                  </Card.Body>
                </Card>
              </Col>

              <Col lg={8}>
                <Card className="mb-3">
                  <Card.Header className="fw-semibold">Registry mapping</Card.Header>
                  <Card.Body>
                    <Row className="g-3 mb-3">
                      <Col md={6}>
                        <Form.Group>
                          <Form.Label>Semantic KPI type</Form.Label>
                          <Form.Select value={customKpiType} onChange={(e) => setCustomKpiType(e.target.value as KpiType)}>
                            {KPI_TYPE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </Form.Select>
                        </Form.Group>
                      </Col>
                      <Col md={6}>
                        <Form.Group>
                          <Form.Label>Data type</Form.Label>
                          <Form.Select value={customDataType} onChange={(e) => setCustomDataType(e.target.value as KpiSourceFieldType)}>
                            <option value="number">number</option>
                            <option value="percentage">percentage</option>
                            <option value="duration">duration</option>
                            <option value="count">count</option>
                            <option value="currency">currency</option>
                            <option value="string">string</option>
                            <option value="date">date</option>
                            <option value="boolean">boolean</option>
                          </Form.Select>
                        </Form.Group>
                      </Col>
                    </Row>

                    <div className="border rounded p-2 mb-3" style={{ background: 'var(--bs-light-bg-subtle, #f8f9fa)' }}>
                      <div className="fw-semibold small">Selected field</div>
                      <div className="text-muted small">
                        {selectedCustomSource?.label || customSourceId} → {selectedCustomField?.collection || 'collection'}.{selectedCustomField?.fieldPath || 'fieldPath'}
                      </div>
                    </div>

                    <Form.Group>
                      <Form.Label>Source priority / fallback</Form.Label>
                      <div className="d-flex flex-wrap gap-3">
                        {defaultSourcePriorityFor(customSourceId, customKpiType).map((candidate) => (
                          <Form.Check
                            key={`priority-${candidate}`}
                            type="checkbox"
                            id={`priority-${candidate}`}
                            label={candidate}
                            checked={sourcePriority.includes(candidate)}
                            onChange={() => {
                              setSourcePriority((prev) => (
                                prev.includes(candidate)
                                  ? prev.filter((value) => value !== candidate)
                                  : [...prev, candidate]
                              ));
                            }}
                          />
                        ))}
                      </div>
                      <div className="text-muted small mt-2">
                        The resolver checks sources in order and falls back when automated data is stale.
                      </div>
                    </Form.Group>
                  </Card.Body>
                </Card>

                <Card>
                  <Card.Header className="fw-semibold">Source-explorer KPI definition</Card.Header>
                  <Card.Body>
                    <Form.Group className="mb-3">
                      <Form.Label>KPI name</Form.Label>
                      <Form.Control value={name} onChange={(e) => setName(e.target.value)} placeholder="Run 10k a day" />
                    </Form.Group>
                    <Form.Group className="mb-3">
                      <Form.Label>Description</Form.Label>
                      <Form.Control as="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Explain how this KPI should be calculated or interpreted." />
                    </Form.Group>
                    <Row className="g-3 mb-3">
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Target</Form.Label>
                          <Form.Control type="number" value={target} onChange={(e) => setTarget(e.target.value)} />
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Baseline</Form.Label>
                          <Form.Control type="number" value={baseline} onChange={(e) => setBaseline(e.target.value)} />
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Unit</Form.Label>
                          <Form.Control value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={selectedCustomField?.unit || 'unit'} />
                        </Form.Group>
                      </Col>
                    </Row>
                    <Row className="g-3 mb-3">
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Timeframe</Form.Label>
                          <Form.Select value={timeframe} onChange={(e) => setTimeframe(e.target.value as any)}>
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                            <option value="sprint">Sprint</option>
                            <option value="quarterly">Quarterly</option>
                            <option value="annual">Annual</option>
                          </Form.Select>
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Aggregation</Form.Label>
                          <Form.Select value={aggregation} onChange={(e) => setAggregation(e.target.value as any)}>
                            <option value="sum">Sum</option>
                            <option value="average">Average</option>
                            <option value="min">Minimum</option>
                            <option value="max">Maximum</option>
                            <option value="count">Count</option>
                            <option value="latest">Latest</option>
                          </Form.Select>
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Target direction</Form.Label>
                          <Form.Select value={targetDirection} onChange={(e) => setTargetDirection(e.target.value as any)}>
                            <option value="increase">Increase</option>
                            <option value="decrease">Decrease</option>
                            <option value="maintain">Maintain</option>
                          </Form.Select>
                        </Form.Group>
                      </Col>
                    </Row>
                    {renderTypeSpecificFields()}
                  </Card.Body>
                </Card>
              </Col>
            </Row>
          </Tab>
          <Tab eventKey="observations" title="Observations">
            <Card className="mt-2">
              <Card.Header className="fw-semibold">Observation stream</Card.Header>
              <Card.Body>
                <div className="text-muted small mb-3">
                  Review recent observed metrics before promoting them to a leaf-goal KPI.
                </div>
                {observations.length === 0 ? (
                  <div className="text-muted small">No observed metrics found yet.</div>
                ) : (
                  <div className="d-flex flex-column gap-2">
                    {observations.slice(0, 20).map((row) => (
                      <div key={row.id} className="border rounded p-2 d-flex justify-content-between align-items-center gap-3 flex-wrap">
                        <div>
                          <div className="fw-semibold">{row.metricKey}</div>
                          <div className="text-muted small">
                            {row.source} · {row.periodKey || 'current'} · {row.observedAt ? new Date(row.observedAt).toLocaleString() : '—'}
                          </div>
                        </div>
                        <div className="d-flex align-items-center gap-3">
                          <Badge bg="light" text="dark">{row.value}{row.unit ? ` ${row.unit}` : ''}</Badge>
                          <Button size="sm" variant="outline-primary" onClick={() => promoteObservation(row)}>
                            Promote to KPI
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card.Body>
            </Card>
          </Tab>
        </Tabs>

        <Row className="g-3 mt-1">
          <Col lg={7}>
            <Card>
              <Card.Header className="fw-semibold">Dashboard visualisation</Card.Header>
              <Card.Body>
                <div className="d-flex flex-column gap-2">
                  {KPI_VISUALIZATION_OPTIONS.map((option) => (
                    <label key={option.value} className="border rounded p-2" style={{ cursor: 'pointer', background: visualizationType === option.value ? 'var(--bs-primary-bg-subtle)' : undefined }}>
                      <Form.Check
                        type="radio"
                        name="kpi-visualization"
                        checked={visualizationType === option.value}
                        onChange={() => setVisualizationType(option.value)}
                        label={
                          <span>
                            <strong>{option.label}</strong>
                            <span className="d-block text-muted small">{option.description}</span>
                          </span>
                        }
                      />
                    </label>
                  ))}
                </div>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={5}>
            <Card className="h-100">
              <Card.Header className="fw-semibold">Preview</Card.Header>
              <Card.Body>
                <div className="border rounded p-3">
                  <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
                    <div>
                      <div className="fw-semibold">{name || selectedCustomField?.label || selectedMetric?.label || 'KPI name'}</div>
                      <div className="text-muted small">{selectedGoal?.title || 'Goal link pending'}</div>
                    </div>
                    <Badge bg="light" text="dark">{visualizationType}</Badge>
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>
                    {target ? `${baseline || '0'} → ${target}` : '0 → target'}
                  </div>
                  <div className="text-muted small mt-1">
                    {isCuratedMode
                      ? `${selectedSource?.label || 'Source'} · ${selectedMetric?.label || 'Metric'}`
                      : `${selectedCustomSource?.label || customSourceId} · ${selectedCustomField?.collection || 'collection'}.${selectedCustomField?.fieldPath || 'fieldPath'}`}
                  </div>
                  <div className="text-muted small mt-1">
                    {effectiveType || 'type'} · {timeframe} · {aggregation}
                  </div>
                  <Form.Check
                    className="mt-3"
                    type="switch"
                    id="pin-kpi-dashboard"
                    label="Pin this KPI to the dashboard widget"
                    checked={displayOnDashboard}
                    onChange={(e) => setDisplayOnDashboard(e.target.checked)}
                  />
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={close} disabled={saving}>Close</Button>
        <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>
          {saving ? (
            <>
              <Spinner animation="border" size="sm" className="me-2" />
              Saving…
            </>
          ) : (
            isCuratedMode ? 'Save curated KPI' : 'Save source-mapped KPI'
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default KPIDesigner;
