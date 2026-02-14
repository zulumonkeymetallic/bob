import React, { useState, useEffect } from 'react';
import { Card, Row, Col, ProgressBar, Alert, Spinner, Form, Badge } from 'react-bootstrap';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { useSprint } from '../contexts/SprintContext';
import { Bar } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend,
} from 'chart.js';

ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend
);

const CapacityDashboard: React.FC = () => {
    const { sprints, selectedSprintId: contextSelectedSprintId } = useSprint();
    const NEXT_WEEK_ID = '__next_week__';
    const [selectedSprintId, setSelectedSprintId] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    // Default to context selection or first sprint
    useEffect(() => {
        if (!selectedSprintId) {
            if (contextSelectedSprintId) {
                setSelectedSprintId(contextSelectedSprintId);
            } else if (sprints.length > 0) {
                setSelectedSprintId(sprints[0].id);
            } else {
                setSelectedSprintId(NEXT_WEEK_ID);
            }
        }
    }, [contextSelectedSprintId, sprints, selectedSprintId]);

    // Fetch capacity data when sprint changes
    useEffect(() => {
        if (!selectedSprintId) return;

        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                if (selectedSprintId === NEXT_WEEK_ID) {
                    const calculateCapacity = httpsCallable(functions, 'calculateNextWeekCapacity');
                    const result = await calculateCapacity({ days: 7 });
                    setData(result.data);
                    return;
                }
                const calculateCapacity = httpsCallable(functions, 'calculateSprintCapacity');
                const result = await calculateCapacity({ sprintId: selectedSprintId });
                setData(result.data);
            } catch (err: any) {
                console.error("Failed to fetch capacity:", err);
                setError(err.message || "Failed to load capacity data.");
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [selectedSprintId]);

    if (!selectedSprintId && sprints.length === 0) {
        return <Alert variant="info">No sprints found. Showing next week capacity from Google Calendar.</Alert>;
    }

    const utilizationColor = (util: number) => {
        if (util > 1.0) return 'danger';
        if (util > 0.8) return 'warning';
        return 'success';
    };

    // Chart Data Preparation
    // Goal Breakdown now has { allocated, utilized }
    const goalLabels = data?.breakdownByGoal ? Object.keys(data.breakdownByGoal) : [];
    const goalAllocated = data?.breakdownByGoal ? goalLabels.map(g => data.breakdownByGoal[g].allocated) : [];
    const goalUtilized = data?.breakdownByGoal ? goalLabels.map(g => data.breakdownByGoal[g].utilized) : [];

    const goalChartData = {
        labels: goalLabels,
        datasets: [
            {
                label: 'Allocated (h)',
                data: goalAllocated,
                backgroundColor: 'rgba(53, 162, 235, 0.5)',
            },
            {
                label: 'Utilized (h)',
                data: goalUtilized,
                backgroundColor: 'rgba(75, 192, 192, 0.5)',
            }
        ]
    };

    const themeLabels = data ? Object.keys(data.scheduledByTheme || data.breakdownByTheme || {}) : [];
    const themeValues = data ? Object.values(data.scheduledByTheme || data.breakdownByTheme || {}) : [];
    const plannedCapacity = data?.plannedCapacityHours ?? data?.totalCapacityHours ?? 0;
    const plannedFree = data?.plannedFreeHours ?? Math.max(0, plannedCapacity - (data?.scheduledHours ?? 0));
    const plannerWeeks = data?.sprintWeeks ?? 0;
    const plannedUtilPercent = Math.min(100, Math.round((data?.plannedUtilization ?? 0) * 100));

    const themeChartData = {
        labels: themeLabels,
        datasets: [
            {
                label: 'Scheduled (h)',
                data: themeValues,
                backgroundColor: 'rgba(153, 102, 255, 0.5)',
            }
        ]
    };

    const isCalendarMode = data?.mode === 'calendar' || selectedSprintId === NEXT_WEEK_ID;

    return (
        <div className="p-4">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <h2>{isCalendarMode ? 'Next Week Capacity' : 'Sprint Capacity'}</h2>
                <Form.Select
                    style={{ width: '250px' }}
                    value={selectedSprintId}
                    onChange={(e) => setSelectedSprintId(e.target.value)}
                >
                    <option value={NEXT_WEEK_ID}>Next Week (Google Calendar)</option>
                    {sprints.map(s => (
                        <option key={s.id} value={s.id}>
                            {s.name} ({new Date(s.startDate).toLocaleDateString()} - {new Date(s.endDate).toLocaleDateString()})
                        </option>
                    ))}
                </Form.Select>
            </div>

            {loading && <div className="text-center"><Spinner animation="border" /></div>}

            {error && <Alert variant="danger">{error}</Alert>}

            {data && !loading && (
                <>
                    {isCalendarMode && (
                        <Alert variant="info" className="mb-3">
                            Capacity is calculated from Google Calendar entries for the next 7 days.
                        </Alert>
                    )}
                    {/* KPI Cards */}
                    <Row className="mb-4">
                        <Col md={3}>
                            <Card className="text-center h-100">
                                <Card.Body>
                                    <h6 className="text-muted">{isCalendarMode ? 'Total Available' : 'Total Capacity'}</h6>
                                    <h3>{data.totalCapacityHours} h</h3>
                                    <small>{isCalendarMode ? 'Assumes 16h per day' : 'Net Available (Work/Sleep Deducted)'}</small>
                                </Card.Body>
                            </Card>
                        </Col>
                        <Col md={3}>
                            <Card className="text-center h-100">
                                <Card.Body>
                                    <h6 className="text-muted">{isCalendarMode ? 'Scheduled' : 'Allocated'}</h6>
                                    <h3>{data.allocatedHours.toFixed(1)} h</h3>
                                    <small>{isCalendarMode ? 'Planned calendar hours' : 'Tasks + Stories'}</small>
                                </Card.Body>
                            </Card>
                        </Col>
                        <Col md={3}>
                            <Card className="text-center h-100">
                                <Card.Body>
                                    <h6 className="text-muted">{isCalendarMode ? 'Free Time' : 'Free Capacity'}</h6>
                                    <h3 className={data.freeCapacityHours < 0 ? 'text-danger' : 'text-success'}>
                                        {data.freeCapacityHours.toFixed(1)} h
                                    </h3>
                                </Card.Body>
                            </Card>
                        </Col>
                        <Col md={3}>
                            <Card className="text-center h-100">
                                <Card.Body>
                                    <h6 className="text-muted">{isCalendarMode ? 'Busy' : 'Utilization'}</h6>
                                    <h3 className={`text-${utilizationColor(data.utilization)}`}>
                                        {(data.utilization * 100).toFixed(0)}%
                                    </h3>
                                    <ProgressBar
                                        now={data.utilization * 100}
                                        variant={utilizationColor(data.utilization)}
                                        style={{ height: '8px', marginTop: '8px' }}
                                    />
                                </Card.Body>
                            </Card>
                        </Col>
                        {!isCalendarMode && (
                            <Col md={3}>
                                <Card className="text-center h-100">
                                    <Card.Body>
                                        <h6 className="text-muted">Scheduled Hours</h6>
                                        <h3>{(data.scheduledHours ?? 0).toFixed(1)} h</h3>
                                        <small>Calendar blocks in this sprint</small>
                                    </Card.Body>
                                </Card>
                            </Col>
                        )}
                    </Row>

                    {!isCalendarMode && plannedCapacity > 0 && (
                        <Row className="mb-4">
                            <Col md={4}>
                                <Card className="text-center h-100">
                                    <Card.Body>
                                        <h6 className="text-muted">Planned Capacity</h6>
                                        <h3>{plannedCapacity.toFixed(1)} h</h3>
                                        <small>Weekly plan × {plannerWeeks} wk</small>
                                    </Card.Body>
                                </Card>
                            </Col>
                            <Col md={4}>
                                <Card className="text-center h-100">
                                    <Card.Body>
                                        <h6 className="text-muted">Planner Utilization</h6>
                                        <h3>{plannedUtilPercent}%</h3>
                                        <small>{(data.weeklyPlannerHours ?? 0).toFixed(1)} h per week</small>
                                    </Card.Body>
                                </Card>
                            </Col>
                            <Col md={4}>
                                <Card className="text-center h-100">
                                    <Card.Body>
                                        <h6 className="text-muted">Planned Free</h6>
                                        <h3>{plannedFree.toFixed(1)} h</h3>
                                        <small>Difference vs scheduled hours</small>
                                    </Card.Body>
                                </Card>
                            </Col>
                        </Row>
                    )}

                    {!isCalendarMode && (
                        <Row className="mb-4">
                            <Col md={12}>
                                <Card>
                                    <Card.Header className="d-flex justify-content-between align-items-center">
                                        <span>Sprint Progress (Points Completed)</span>
                                        <Badge bg="info">{data.remainingHours.toFixed(1)} h Remaining Effort</Badge>
                                    </Card.Header>
                                    <Card.Body>
                                        <div className="mb-2 d-flex justify-content-between">
                                            <span>Progress: {(data.progressPercent * 100).toFixed(0)}%</span>
                                            <span>Allocated: {data.allocatedHours.toFixed(1)} h</span>
                                        </div>
                                        <ProgressBar>
                                            <ProgressBar
                                                variant="success"
                                                now={data.progressPercent * 100}
                                                label={`${(data.progressPercent * 100).toFixed(0)}%`}
                                                key={1}
                                            />
                                        </ProgressBar>
                                        <div className="mt-2 text-muted small">
                                            Based on completed story points vs total allocated points.
                                        </div>
                                    </Card.Body>
                                </Card>
                            </Col>
                        </Row>
                    )}

                    {/* Charts */}
                    <Row>
                        {!isCalendarMode && (
                            <Col md={6}>
                                <Card>
                                    <Card.Header>Allocation vs Utilization by Goal</Card.Header>
                                    <Card.Body>
                                        <Bar options={{ responsive: true }} data={goalChartData} />
                                    </Card.Body>
                                </Card>
                            </Col>
                        )}
                        <Col md={6}>
                            <Card>
                                <Card.Header>Scheduled Hours by Theme</Card.Header>
                                <Card.Body>
                                    <Bar options={{ responsive: true }} data={themeChartData} />
                                </Card.Body>
                            </Card>
                        </Col>
                    </Row>
                </>
            )}
        </div>
    );
};

export default CapacityDashboard;
