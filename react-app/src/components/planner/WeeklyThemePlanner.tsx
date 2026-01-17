import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Button, Modal, Form, Container, Spinner, Alert } from 'react-bootstrap';
import { Save } from 'lucide-react';
import { GLOBAL_THEMES, type GlobalTheme } from '../../constants/globalThemes';
import { useGlobalThemes } from '../../hooks/useGlobalThemes';
import './WeeklyThemePlanner.css';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const START_HOUR = 6;
const END_HOUR = 22;
const SLOT_MINUTES = 30;
const TIME_SLOTS = Array.from(
    { length: ((END_HOUR - START_HOUR) * 60) / SLOT_MINUTES },
    (_, i) => START_HOUR * 60 + i * SLOT_MINUTES
);
const HEALTH_SUBTHEMES = ['Bike', 'Run', 'Swim', 'S&C', 'Crossfit', 'Meal Prep'];
const WORK_SHIFT_THEME: GlobalTheme = {
    id: 999,
    name: 'Work Shift',
    label: 'Work Shift',
    color: '#0f172a',
    darkColor: '#0b1120',
    lightColor: '#e2e8f0',
    textColor: '#ffffff',
    description: 'Work shift blocks planned in the weekly view',
};

interface Allocation {
    dayOfWeek: number; // 0=Sun, 1=Mon...
    startTime: string; // HH:mm
    endTime: string; // HH:mm
    theme: string;
    subTheme?: string | null;
}

const toMinutes = (hhmm: string) => {
    const [h = '0', m = '0'] = String(hhmm || '0:0').split(':');
    return Number(h) * 60 + Number(m);
};

const toTimeString = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const isHealthTheme = (themeName: string) => String(themeName || '').toLowerCase().includes('health');

const WeeklyThemePlanner: React.FC = () => {
    const { currentUser } = useAuth();
    const { themes: globalThemes } = useGlobalThemes();
    const themeOptions = useMemo(() => {
        const base = globalThemes.length ? globalThemes : GLOBAL_THEMES;
        const hasWorkShift = base.some((theme) =>
            String(theme.name || theme.label || '').trim().toLowerCase() === 'work shift',
        );
        return hasWorkShift ? base : [...base, WORK_SHIFT_THEME];
    }, [globalThemes]);
    const [allocations, setAllocations] = useState<Allocation[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [selectedCell, setSelectedCell] = useState<{ day: number, minutes: number } | null>(null);
    const [dragStart, setDragStart] = useState<{ day: number, minutes: number } | null>(null);
    const [dragEnd, setDragEnd] = useState<{ day: number, minutes: number } | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [selectedTheme, setSelectedTheme] = useState(themeOptions[0]?.name || 'General');
    const [selectedSubTheme, setSelectedSubTheme] = useState('');
    const [applyFeedback, setApplyFeedback] = useState<{ variant: 'success' | 'danger' | 'info'; message: string } | null>(null);
    const [applying, setApplying] = useState(false);
    const [nightlyRunning, setNightlyRunning] = useState(false);

    const functions = getFunctions();
    const getAllocations = httpsCallable(functions, 'getThemeAllocations');
    const saveAllocationsFn = httpsCallable(functions, 'saveThemeAllocations');
    const materializePlannerBlocks = httpsCallable(functions, 'materializeFitnessBlocksNow');
    const runNightlyChainFn = httpsCallable(functions, 'runNightlyChainNow');

    useEffect(() => {
        if (currentUser) loadAllocations();
    }, [currentUser]);

    useEffect(() => {
        if (!themeOptions.length) return;
        const exists = themeOptions.some((theme) => theme.name === selectedTheme || theme.label === selectedTheme);
        if (!exists) {
            setSelectedTheme(themeOptions[0].name || themeOptions[0].label);
        }
    }, [themeOptions, selectedTheme]);

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
        setApplyFeedback(null);
        try {
            await saveAllocationsFn({ allocations });
        } catch (e) {
            console.error(e);
        } finally {
            setSaving(false);
        }
    };

    const applyPlannerBlocksNow = async () => {
        if (!currentUser) return;
        setApplying(true);
        setApplyFeedback(null);
        try {
            const res = await materializePlannerBlocks({ days: 7 });
            const data = res.data as any;
            const created = Number(data?.created || 0);
            const skipped = Number(data?.skipped || 0);
            const total = Number(data?.total || 0);
            if (!total) {
                setApplyFeedback({ variant: 'info', message: 'No fitness or work-shift blocks found in the weekly plan.' });
            } else {
                setApplyFeedback({ variant: 'success', message: `Planner blocks created: ${created}. Skipped: ${skipped}.` });
            }
        } catch (e: any) {
            setApplyFeedback({ variant: 'danger', message: e?.message || 'Failed to apply planner blocks.' });
        } finally {
            setApplying(false);
        }
    };

    const runNightlyChainNow = async () => {
        if (!currentUser) return;
        setNightlyRunning(true);
        setApplyFeedback(null);
        try {
            const res = await runNightlyChainFn({});
            const data = res?.data as { results?: Array<{ step?: string; status?: string }> };
            const summary = Array.isArray(data?.results) && data.results.length
                ? data.results.map((item) => `${item.step || 'step'}:${item.status || 'ok'}`).join(', ')
                : 'Nightly chain triggered.';
            setApplyFeedback({ variant: 'success', message: `Nightly chain started. ${summary}` });
        } catch (e: any) {
            setApplyFeedback({ variant: 'danger', message: e?.message || 'Failed to run nightly chain.' });
        } finally {
            setNightlyRunning(false);
        }
    };

    const beginSelection = (dayIndex: number, minutes: number) => {
        const jsDay = (dayIndex + 1) % 7;
        setDragStart({ day: jsDay, minutes });
        setDragEnd({ day: jsDay, minutes });
        setSelectedCell({ day: jsDay, minutes });
        const existing = allocations.find(a =>
            a.dayOfWeek === jsDay &&
            toMinutes(a.startTime) <= minutes &&
            toMinutes(a.endTime) > minutes
        );
        setSelectedTheme(existing ? existing.theme : (themeOptions[0]?.name || 'General'));
        setSelectedSubTheme(existing?.subTheme || '');
    };

    const finalizeSelection = (dayIndex: number, minutes: number) => {
        const jsDay = (dayIndex + 1) % 7;
        if (!dragStart) {
            beginSelection(dayIndex, minutes);
        }
        setDragEnd({ day: jsDay, minutes });
        setSelectedCell({ day: jsDay, minutes });
        setShowModal(true);
    };

    const mergeAllocations = (allocationsToMerge: Allocation[]) => {
        const mergedByDay = new Map<number, Allocation[]>();
        allocationsToMerge.forEach((alloc) => {
            const list = mergedByDay.get(alloc.dayOfWeek) || [];
            list.push(alloc);
            mergedByDay.set(alloc.dayOfWeek, list);
        });
        const merged: Allocation[] = [];
        mergedByDay.forEach((dayAllocations) => {
            const sorted = dayAllocations
                .slice()
                .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
            let current = sorted[0];
            for (let i = 1; i < sorted.length; i += 1) {
                const next = sorted[i];
                const currentEnd = toMinutes(current.endTime);
                const nextStart = toMinutes(next.startTime);
                const sameTheme = current.theme === next.theme;
                const sameSubTheme = (current.subTheme || '') === (next.subTheme || '');
                if (sameTheme && sameSubTheme && currentEnd >= nextStart) {
                    const nextEnd = toMinutes(next.endTime);
                    current = {
                        ...current,
                        endTime: toTimeString(Math.max(currentEnd, nextEnd)),
                    };
                } else {
                    merged.push(current);
                    current = next;
                }
            }
            if (current) merged.push(current);
        });
        return merged;
    };

    const handleApplySelection = async ({
        day,
        startMinutes,
        endMinutes,
        theme,
        subTheme,
    }: {
        day: number;
        startMinutes: number;
        endMinutes: number;
        theme: string;
        subTheme: string | null;
    }) => {
        const startStr = toTimeString(startMinutes);
        const endStr = toTimeString(endMinutes);

        const dayAllocations = allocations.filter((alloc) => alloc.dayOfWeek === day);
        const otherAllocations = allocations.filter((alloc) => alloc.dayOfWeek !== day);
        const updatedDayAllocations: Allocation[] = [];

        dayAllocations.forEach((alloc) => {
            const allocStart = toMinutes(alloc.startTime);
            const allocEnd = toMinutes(alloc.endTime);
            if (allocEnd <= startMinutes || allocStart >= endMinutes) {
                updatedDayAllocations.push(alloc);
                return;
            }
            if (allocStart < startMinutes) {
                updatedDayAllocations.push({
                    ...alloc,
                    endTime: toTimeString(startMinutes),
                });
            }
            if (allocEnd > endMinutes) {
                updatedDayAllocations.push({
                    ...alloc,
                    startTime: toTimeString(endMinutes),
                });
            }
        });

        const nextAllocations: Allocation[] = [...otherAllocations, ...updatedDayAllocations];
        if (theme !== 'Clear') {
            nextAllocations.push({
                dayOfWeek: day,
                startTime: startStr,
                endTime: endStr,
                theme,
                subTheme: isHealthTheme(theme) ? (subTheme || null) : null,
            });
        }

        const merged = mergeAllocations(nextAllocations);
        setAllocations(merged);
        setShowModal(false);
        setDragStart(null);
        setDragEnd(null);
        setSaving(true);
        try {
            await saveAllocationsFn({ allocations: merged });
        } catch (e) {
            console.error('save allocations failed', e);
        } finally {
            setSaving(false);
        }
    };

    const handleSaveTheme = async () => {
        if (!selectedCell) return;
        const { day, minutes } = selectedCell;
        const baseStart = dragStart?.minutes ?? minutes;
        const baseEnd = dragEnd?.minutes ?? minutes;
        const startMinutes = Math.min(baseStart, baseEnd);
        const endMinutes = Math.max(baseStart, baseEnd) + SLOT_MINUTES;
        await handleApplySelection({
            day,
            startMinutes,
            endMinutes,
            theme: selectedTheme,
            subTheme: selectedSubTheme || null,
        });
    };

    const getThemeForCell = (dayIndex: number, minutes: number) => {
        const jsDay = (dayIndex + 1) % 7;
        return allocations.find(a =>
            a.dayOfWeek === jsDay &&
            toMinutes(a.startTime) <= minutes &&
            toMinutes(a.endTime) > minutes
        );
    };

    const getThemeColor = (themeName: string) => {
        const theme = themeOptions.find(t => t.name === themeName || t.label === themeName);
        return theme ? theme.lightColor : '#f1f3f4';
    };

    if (loading) return <div className="p-5 text-center"><Spinner animation="border" /></div>;

    return (
        <Container fluid className="p-4">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h2>Weekly Plan</h2>
                    <p className="text-muted">Define your ideal week by assigning themes to time blocks. The AI will prioritize these themes when scheduling.</p>
                    <small className="text-muted d-block">Tip: click and drag across time slots to create or resize a block. Use Clear to remove only the selected range.</small>
                </div>
                <div className="d-flex flex-wrap gap-2">
                    <Button onClick={saveAllocations} disabled={saving || applying || nightlyRunning}>
                    {saving ? <Spinner size="sm" animation="border" className="me-2" /> : <Save size={18} className="me-2" />}
                    Save Changes
                    </Button>
                    <Button variant="outline-primary" onClick={applyPlannerBlocksNow} disabled={saving || applying || nightlyRunning}>
                        {applying ? <Spinner size="sm" animation="border" className="me-2" /> : null}
                        Apply Planner Blocks Now
                    </Button>
                    <Button variant="outline-secondary" onClick={runNightlyChainNow} disabled={saving || applying || nightlyRunning}>
                        {nightlyRunning ? <Spinner size="sm" animation="border" className="me-2" /> : null}
                        Run Nightly Chain Now
                    </Button>
                </div>
            </div>

            {applyFeedback && (
                <Alert variant={applyFeedback.variant} className="mb-3">
                    {applyFeedback.message}
                </Alert>
            )}

            <div className="theme-grid">
                <div className="header-row">
                    <div className="time-col"></div>
                    {DAYS.map(d => <div key={d} className="day-header">{d}</div>)}
                </div>
                {TIME_SLOTS.map(slot => (
                    <div key={slot} className="time-row">
                        <div className="time-label">{toTimeString(slot)}</div>
                        {DAYS.map((_, dIndex) => {
                            const alloc = getThemeForCell(dIndex, slot);
                            return (
                                <div
                                    key={dIndex}
                                    className="grid-cell"
                                    style={{ backgroundColor: alloc ? getThemeColor(alloc.theme) : 'white' }}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        beginSelection(dIndex, slot);
                                    }}
                                    onMouseEnter={(e) => {
                                        if (dragStart && e.buttons === 1) {
                                            const jsDay = (dIndex + 1) % 7;
                                            if (jsDay === dragStart.day) {
                                                setDragEnd({ day: jsDay, minutes: slot });
                                            }
                                        }
                                    }}
                                    onMouseUp={() => finalizeSelection(dIndex, slot)}
                                >
                                    {alloc && <span className="theme-label">{alloc.subTheme || alloc.theme}</span>}
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
                    <Form.Label>Select Theme for this time range</Form.Label>
                    <Form.Select
                        value={selectedTheme}
                        onChange={e => {
                            const next = e.target.value;
                            setSelectedTheme(next);
                            if (!isHealthTheme(next)) setSelectedSubTheme('');
                        }}
                    >
                        {themeOptions.map(t => <option key={t.id} value={t.name}>{t.label}</option>)}
                        <option value="Clear">Clear (No Theme)</option>
                    </Form.Select>
                    {isHealthTheme(selectedTheme) && (
                        <Form.Group className="mt-3">
                            <Form.Label>Fitness subtype</Form.Label>
                            <Form.Select
                                value={selectedSubTheme}
                                onChange={(e) => setSelectedSubTheme(e.target.value)}
                            >
                                <option value="">None</option>
                                {HEALTH_SUBTHEMES.map((sub) => (
                                    <option key={sub} value={sub}>{sub}</option>
                                ))}
                            </Form.Select>
                        </Form.Group>
                    )}
                </Form.Group>
            </Modal.Body>
            <Modal.Footer>
                <Button
                    variant="secondary"
                    onClick={() => {
                        setShowModal(false);
                        setDragStart(null);
                        setDragEnd(null);
                    }}
                >
                    Cancel
                </Button>
                    <Button variant="primary" onClick={handleSaveTheme}>Set Theme</Button>
                </Modal.Footer>
            </Modal>
        </Container>
    );
};

export default WeeklyThemePlanner;
