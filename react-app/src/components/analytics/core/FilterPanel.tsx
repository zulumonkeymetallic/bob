import React from 'react';
import { Form, Row, Col, Button, Dropdown, ButtonGroup } from 'react-bootstrap';
import { Calendar, User, Tag, RotateCcw } from 'lucide-react';
import { useDashboardFilters } from '../contexts/DashboardFiltersContext';
import { usePersona } from '../../../contexts/PersonaContext';
import { format } from 'date-fns';

const FilterPanel: React.FC = () => {
    const { filters, setDateRange, setPersona: setDashboardPersona, resetFilters, presetRanges } = useDashboardFilters();
    const { currentPersona, setPersona: setGlobalPersona } = usePersona();
    const personas = ['personal', 'work'];

    const handlePresetChange = (presetKey: string) => {
        const range = presetRanges[presetKey]();
        setDateRange(range);
    };

    const handlePersonaChange = (persona: string) => {
        setGlobalPersona(persona as any);
        setDashboardPersona(persona);
    };

    return (
        <div className="bg-light border rounded p-3 mb-4">
            <Row className="g-3 align-items-end">
                <Col md={3}>
                    <Form.Label className="small fw-semibold text-muted mb-1">
                        <Calendar size={14} className="me-1" />
                        Date Range
                    </Form.Label>
                    <Dropdown as={ButtonGroup} className="w-100">
                        <Button variant="outline-secondary" className="w-100 text-start">
                            {filters.dateRange.label}
                        </Button>
                        <Dropdown.Toggle split variant="outline-secondary" />
                        <Dropdown.Menu>
                            <Dropdown.Item onClick={() => handlePresetChange('today')}>Today</Dropdown.Item>
                            <Dropdown.Item onClick={() => handlePresetChange('yesterday')}>Yesterday</Dropdown.Item>
                            <Dropdown.Item onClick={() => handlePresetChange('last7Days')}>Last 7 Days</Dropdown.Item>
                            <Dropdown.Item onClick={() => handlePresetChange('last30Days')}>Last 30 Days</Dropdown.Item>
                            <Dropdown.Item onClick={() => handlePresetChange('thisWeek')}>This Week</Dropdown.Item>
                            <Dropdown.Item onClick={() => handlePresetChange('thisMonth')}>This Month</Dropdown.Item>
                        </Dropdown.Menu>
                    </Dropdown>
                    <div className="text-muted small mt-1">
                        {format(filters.dateRange.start, 'MMM d')} - {format(filters.dateRange.end, 'MMM d, yyyy')}
                    </div>
                </Col>

                <Col md={3}>
                    <Form.Label className="small fw-semibold text-muted mb-1">
                        <User size={14} className="me-1" />
                        Persona
                    </Form.Label>
                    <Form.Select
                        value={currentPersona}
                        onChange={(e) => handlePersonaChange(e.target.value)}
                    >
                        {personas.map((p) => (
                            <option key={p} value={p}>
                                {p}
                            </option>
                        ))}
                    </Form.Select>
                </Col>

                <Col md={3}>
                    <Form.Label className="small fw-semibold text-muted mb-1">
                        <Tag size={14} className="me-1" />
                        Quick Filters
                    </Form.Label>
                    <div className="d-flex gap-2">
                        <Button variant="outline-primary" size="sm" disabled>
                            High Priority
                        </Button>
                        <Button variant="outline-info" size="sm" disabled>
                            Due Soon
                        </Button>
                    </div>
                </Col>

                <Col md={3} className="text-end">
                    <Button
                        variant="outline-secondary"
                        size="sm"
                        onClick={resetFilters}
                        className="d-inline-flex align-items-center gap-1"
                    >
                        <RotateCcw size={14} />
                        Reset Filters
                    </Button>
                </Col>
            </Row>
        </div>
    );
};

export default FilterPanel;
