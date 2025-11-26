import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Button, Modal, Form, Container, Spinner } from 'react-bootstrap';
import { Save } from 'lucide-react';
import { GLOBAL_THEMES } from '../../constants/globalThemes';
import './WeeklyThemePlanner.css';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 6 to 22 (10pm)

interface Allocation {
    dayOfWeek: number; // 0=Sun, 1=Mon...
    startTime: string; // HH:mm
    endTime: string; // HH:mm
    theme: string;
}

const WeeklyThemePlanner: React.FC = () => {
    const { currentUser } = useAuth();
    const [allocations, setAllocations] = useState<Allocation[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [selectedCell, setSelectedCell] = useState<{ day: number, hour: number } | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [selectedTheme, setSelectedTheme] = useState(GLOBAL_THEMES[0].name);

    const functions = getFunctions();
    const getAllocations = httpsCallable(functions, 'getThemeAllocations');
    const saveAllocationsFn = httpsCallable(functions, 'saveThemeAllocations');

    useEffect(() => {
        if (currentUser) loadAllocations();
    }, [currentUser]);

    const loadAllocations = async () => {
        setLoading(true);
        try {
            const res = await getAllocations();
            const data = res.data as { allocations: Allocation[] };
            setAllocations(data.allocations || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const saveAllocations = async () => {
        setSaving(true);
        try {
            await saveAllocationsFn({ allocations });
        } catch (e) {
            console.error(e);
        } finally {
            setSaving(false);
        }
    };

    const handleCellClick = (dayIndex: number, hour: number) => {
        // dayIndex 0=Mon, 1=Tue... 
        // Map to JS Day: Mon(0)->1, ..., Sun(6)->0
        const jsDay = (dayIndex + 1) % 7;
        setSelectedCell({ day: jsDay, hour });

        const existing = allocations.find(a =>
            a.dayOfWeek === jsDay &&
            parseInt(a.startTime) <= hour &&
            parseInt(a.endTime) > hour
        );
        if (existing) setSelectedTheme(existing.theme);
        else setSelectedTheme(GLOBAL_THEMES[0].name);
        setShowModal(true);
    };

    const handleSaveTheme = () => {
        if (!selectedCell) return;
        const { day, hour } = selectedCell;
        const startStr = `${hour.toString().padStart(2, '0')}:00`;
        const endStr = `${(hour + 1).toString().padStart(2, '0')}:00`;

        // Remove overlapping/existing for this slot
        // Note: This simple logic splits blocks if you overwrite the middle.
        // For MVP, we just replace the exact hour slot.
        // Ideally we should merge adjacent slots of same theme.

        const filtered = allocations.filter(a =>
            !(a.dayOfWeek === day &&
                ((parseInt(a.startTime) <= hour && parseInt(a.endTime) > hour)))
        );

        let newAllocations = filtered;
        if (selectedTheme !== 'Clear') {
            newAllocations.push({
                dayOfWeek: day,
                startTime: startStr,
                endTime: endStr,
                theme: selectedTheme
            });
        }

        // Merge adjacent blocks logic could go here

        setAllocations(newAllocations);
        setShowModal(false);
    };

    const getThemeForCell = (dayIndex: number, hour: number) => {
        const jsDay = (dayIndex + 1) % 7;
        return allocations.find(a =>
            a.dayOfWeek === jsDay &&
            parseInt(a.startTime) <= hour &&
            parseInt(a.endTime) > hour
        );
    };

    const getThemeColor = (themeName: string) => {
        const theme = GLOBAL_THEMES.find(t => t.name === themeName || t.label === themeName);
        return theme ? theme.lightColor : '#f1f3f4';
    };

    if (loading) return <div className="p-5 text-center"><Spinner animation="border" /></div>;

    return (
        <Container fluid className="p-4">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h2>Weekly Plan</h2>
                    <p className="text-muted">Define your ideal week by assigning themes to time blocks. The AI will prioritize these themes when scheduling.</p>
                </div>
                <Button onClick={saveAllocations} disabled={saving}>
                    {saving ? <Spinner size="sm" animation="border" className="me-2" /> : <Save size={18} className="me-2" />}
                    Save Changes
                </Button>
            </div>

            <div className="theme-grid">
                <div className="header-row">
                    <div className="time-col"></div>
                    {DAYS.map(d => <div key={d} className="day-header">{d}</div>)}
                </div>
                {HOURS.map(h => (
                    <div key={h} className="time-row">
                        <div className="time-label">{h}:00</div>
                        {DAYS.map((_, dIndex) => {
                            const alloc = getThemeForCell(dIndex, h);
                            return (
                                <div
                                    key={dIndex}
                                    className="grid-cell"
                                    style={{ backgroundColor: alloc ? getThemeColor(alloc.theme) : 'white' }}
                                    onClick={() => handleCellClick(dIndex, h)}
                                >
                                    {alloc && <span className="theme-label">{alloc.theme}</span>}
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>

            <Modal show={showModal} onHide={() => setShowModal(false)} centered>
                <Modal.Header closeButton><Modal.Title>Set Theme</Modal.Title></Modal.Header>
                <Modal.Body>
                    <Form.Group>
                        <Form.Label>Select Theme for this hour</Form.Label>
                        <Form.Select value={selectedTheme} onChange={e => setSelectedTheme(e.target.value)}>
                            {GLOBAL_THEMES.map(t => <option key={t.id} value={t.name}>{t.label}</option>)}
                            <option value="Clear">Clear (No Theme)</option>
                        </Form.Select>
                    </Form.Group>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
                    <Button variant="primary" onClick={handleSaveTheme}>Set Theme</Button>
                </Modal.Footer>
            </Modal>
        </Container>
    );
};

export default WeeklyThemePlanner;
