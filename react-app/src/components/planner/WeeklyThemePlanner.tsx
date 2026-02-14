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
const HEALTH_SUBTHEMES = ['Bike', 'Run', 'Swim', 'Walk', 'S&C', 'Crossfit', 'Meal Prep'];
const WORK_MAIN_GIG_THEME: GlobalTheme = {
    id: 12,
    name: 'Work (Main Gig)',
    label: 'Work (Main Gig)',
    color: '#0f172a',
    darkColor: '#0b1120',
    lightColor: '#e2e8f0',
    textColor: '#ffffff',
    description: 'Main gig work blocks planned in the weekly view',
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
const getJsDay = (dayIndex: number) => (dayIndex + 1) % 7;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

type DragMode = 'create' | 'resize-start' | 'resize-end' | 'move' | null;

interface DragSelection {
    day: number;
    startMinutes: number;
    endMinutes: number;
    theme: string;
    subTheme: string | null;
}

const WeeklyThemePlanner: React.FC = () => {
    const { currentUser } = useAuth();
    const { themes: globalThemes } = useGlobalThemes();
    const themeOptions = useMemo(() => {
        const base = globalThemes.length ? globalThemes : GLOBAL_THEMES;
        const hasMainGig = base.some((theme) => {
            const label = String(theme.name || theme.label || '').trim().toLowerCase();
            return label === 'work (main gig)' || label === 'work';
        });
        return hasMainGig ? base : [...base, WORK_MAIN_GIG_THEME];
    }, [globalThemes]);
    const [allocations, setAllocations] = useState<Allocation[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dragMode, setDragMode] = useState<DragMode>(null);
    const [dragSelection, setDragSelection] = useState<DragSelection | null>(null);
    const [dragAnchor, setDragAnchor] = useState<{ day: number; minutes: number } | null>(null);
    const [dragAlloc, setDragAlloc] = useState<Allocation | null>(null);
    const [dragOffsetMinutes, setDragOffsetMinutes] = useState(0);
    const [pendingSelection, setPendingSelection] = useState<{ day: number; startMinutes: number; endMinutes: number } | null>(null);
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
    const runNightlyChainFn = httpsCallable(functions, 'runNightlyChain');

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
                setApplyFeedback({ variant: 'info', message: 'No fitness or Work (Main Gig) blocks found in the weekly plan.' });
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

    const findAllocationForCell = (day: number, minutes: number, source = allocations) => source.find((alloc) =>
        alloc.dayOfWeek === day &&
        toMinutes(alloc.startTime) <= minutes &&
        toMinutes(alloc.endTime) > minutes
    );

    const clearDragState = () => {
        setDragMode(null);
        setDragAnchor(null);
        setDragSelection(null);
        setDragAlloc(null);
        setDragOffsetMinutes(0);
    };

    const beginSelection = (dayIndex: number, minutes: number) => {
        const jsDay = getJsDay(dayIndex);
        const existing = findAllocationForCell(jsDay, minutes);
        const nextTheme = existing ? existing.theme : (themeOptions[0]?.name || 'General');
        const nextSubTheme = existing?.subTheme || '';
        setSelectedTheme(nextTheme);
        setSelectedSubTheme(nextSubTheme);
        setDragAlloc(null);
        setDragOffsetMinutes(0);
        setDragMode('create');
        setDragAnchor({ day: jsDay, minutes });
        setDragSelection({
            day: jsDay,
            startMinutes: minutes,
            endMinutes: minutes + SLOT_MINUTES,
            theme: nextTheme,
            subTheme: nextSubTheme || null,
        });
        setPendingSelection(null);
    };

    const beginResize = (alloc: Allocation, direction: 'start' | 'end') => {
        const startMinutes = toMinutes(alloc.startTime);
        const endMinutes = toMinutes(alloc.endTime);
        setDragMode(direction === 'start' ? 'resize-start' : 'resize-end');
        setDragAlloc(alloc);
        setDragAnchor(null);
        setDragOffsetMinutes(0);
        setDragSelection({
            day: alloc.dayOfWeek,
            startMinutes,
            endMinutes,
            theme: alloc.theme,
            subTheme: alloc.subTheme || null,
        });
    };

    const beginMove = (alloc: Allocation, minutes: number) => {
        const startMinutes = toMinutes(alloc.startTime);
        const endMinutes = toMinutes(alloc.endTime);
        setDragMode('move');
        setDragAlloc(alloc);
        setDragAnchor(null);
        setDragOffsetMinutes(minutes - startMinutes);
        setDragSelection({
            day: alloc.dayOfWeek,
            startMinutes,
            endMinutes,
            theme: alloc.theme,
            subTheme: alloc.subTheme || null,
        });
    };

    const updateSelection = (dayIndex: number, minutes: number) => {
        if (!dragMode || !dragSelection) return;
        const jsDay = getJsDay(dayIndex);

        if (dragMode === 'create') {
            if (!dragAnchor || jsDay !== dragAnchor.day) return;
            const startMinutes = Math.min(dragAnchor.minutes, minutes);
            const endMinutes = Math.max(dragAnchor.minutes, minutes) + SLOT_MINUTES;
            if (startMinutes === dragSelection.startMinutes && endMinutes === dragSelection.endMinutes) return;
            setDragSelection({ ...dragSelection, startMinutes, endMinutes });
            return;
        }

        if (dragMode === 'resize-start') {
            if (jsDay !== dragSelection.day) return;
            const nextStart = Math.min(minutes, dragSelection.endMinutes - SLOT_MINUTES);
            if (nextStart === dragSelection.startMinutes) return;
            setDragSelection({ ...dragSelection, startMinutes: nextStart });
            return;
        }

        if (dragMode === 'resize-end') {
            if (jsDay !== dragSelection.day) return;
            const nextEnd = Math.max(minutes + SLOT_MINUTES, dragSelection.startMinutes + SLOT_MINUTES);
            if (nextEnd === dragSelection.endMinutes) return;
            setDragSelection({ ...dragSelection, endMinutes: nextEnd });
            return;
        }

        if (dragMode === 'move') {
            const duration = dragSelection.endMinutes - dragSelection.startMinutes;
            const minStart = START_HOUR * 60;
            const maxStart = END_HOUR * 60 - duration;
            const nextStart = clamp(minutes - dragOffsetMinutes, minStart, maxStart);
            const nextEnd = nextStart + duration;
            if (nextStart === dragSelection.startMinutes && jsDay === dragSelection.day) return;
            setDragSelection({ ...dragSelection, day: jsDay, startMinutes: nextStart, endMinutes: nextEnd });
        }
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

    const applySelectionToAllocations = (
        source: Allocation[],
        {
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
        },
    ) => {
        if (endMinutes <= startMinutes) return source.slice();
        const startStr = toTimeString(startMinutes);
        const endStr = toTimeString(endMinutes);

        const dayAllocations = source.filter((alloc) => alloc.dayOfWeek === day);
        const otherAllocations = source.filter((alloc) => alloc.dayOfWeek !== day);
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
        return merged;
    };

    const commitAllocations = async (nextAllocations: Allocation[]) => {
        setAllocations(nextAllocations);
        setShowModal(false);
        setPendingSelection(null);
        clearDragState();
        setSaving(true);
        try {
            await saveAllocationsFn({ allocations: nextAllocations });
        } catch (e) {
            console.error('save allocations failed', e);
        } finally {
            setSaving(false);
        }
    };

    const finalizeSelection = async () => {
        if (!dragMode) return;
        if (dragMode === 'create') {
            if (dragSelection) {
                setPendingSelection({
                    day: dragSelection.day,
                    startMinutes: dragSelection.startMinutes,
                    endMinutes: dragSelection.endMinutes,
                });
                setShowModal(true);
            }
            setDragMode(null);
            setDragAnchor(null);
            setDragAlloc(null);
            setDragOffsetMinutes(0);
            return;
        }

        if (!dragSelection || !dragAlloc) {
            clearDragState();
            return;
        }

        const originalStart = toMinutes(dragAlloc.startTime);
        const originalEnd = toMinutes(dragAlloc.endTime);
        const selectionChanged = (
            dragSelection.day !== dragAlloc.dayOfWeek ||
            dragSelection.startMinutes !== originalStart ||
            dragSelection.endMinutes !== originalEnd
        );
        if (!selectionChanged) {
            clearDragState();
            return;
        }

        let next = applySelectionToAllocations(allocations, {
            day: dragAlloc.dayOfWeek,
            startMinutes: originalStart,
            endMinutes: originalEnd,
            theme: 'Clear',
            subTheme: null,
        });
        next = applySelectionToAllocations(next, {
            day: dragSelection.day,
            startMinutes: dragSelection.startMinutes,
            endMinutes: dragSelection.endMinutes,
            theme: dragAlloc.theme,
            subTheme: dragAlloc.subTheme || null,
        });
        await commitAllocations(next);
    };

    const handleSaveTheme = async () => {
        if (!pendingSelection) return;
        const next = applySelectionToAllocations(allocations, {
            day: pendingSelection.day,
            startMinutes: pendingSelection.startMinutes,
            endMinutes: pendingSelection.endMinutes,
            theme: selectedTheme,
            subTheme: selectedSubTheme || null,
        });
        await commitAllocations(next);
    };

    const handleModalClose = () => {
        setShowModal(false);
        setPendingSelection(null);
        clearDragState();
    };

    const getDisplayAllocation = (dayIndex: number, minutes: number) => {
        const jsDay = getJsDay(dayIndex);
        if (
            dragSelection &&
            dragSelection.day === jsDay &&
            minutes >= dragSelection.startMinutes &&
            minutes < dragSelection.endMinutes
        ) {
            return {
                allocation: {
                    dayOfWeek: dragSelection.day,
                    startTime: toTimeString(dragSelection.startMinutes),
                    endTime: toTimeString(dragSelection.endMinutes),
                    theme: dragSelection.theme,
                    subTheme: dragSelection.subTheme || null,
                },
                preview: true,
            };
        }

        if (dragAlloc && dragMode && dragMode !== 'create' && jsDay === dragAlloc.dayOfWeek) {
            const dragStart = toMinutes(dragAlloc.startTime);
            const dragEnd = toMinutes(dragAlloc.endTime);
            if (minutes >= dragStart && minutes < dragEnd) {
                return { allocation: null, preview: false };
            }
        }

        const allocation = findAllocationForCell(jsDay, minutes);
        return { allocation: allocation || null, preview: false };
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
                    <small className="text-muted d-block">Tip: click and drag across time slots to create. Use the top/bottom handles to resize and drag the label to move. Use Clear to remove only the selected range.</small>
                </div>
                <div className="d-flex flex-wrap gap-2">
                    <Button onClick={saveAllocations} disabled={saving || applying}>
                    {saving ? <Spinner size="sm" animation="border" className="me-2" /> : <Save size={18} className="me-2" />}
                    Save Changes
                    </Button>
                    <Button variant="outline-primary" onClick={applyPlannerBlocksNow} disabled={saving || applying}>
                        {applying ? <Spinner size="sm" animation="border" className="me-2" /> : null}
                        Apply Planner Blocks Now
                    </Button>
                    <Button variant="outline-secondary" onClick={() => window.open('https://bob.jc1.tech/calendar/planner', '_blank', 'noopener,noreferrer')} disabled={saving || applying}>
                        Replan Around Calendar
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
                            const { allocation: alloc, preview } = getDisplayAllocation(dIndex, slot);
                            const isStart = Boolean(alloc && toMinutes(alloc.startTime) === slot);
                            const isEnd = Boolean(alloc && toMinutes(alloc.endTime) === slot + SLOT_MINUTES);
                            const cellClasses = [
                                'grid-cell',
                                alloc ? 'has-alloc' : '',
                                preview ? 'drag-preview' : '',
                            ].filter(Boolean).join(' ');
                            return (
                                <div
                                    key={dIndex}
                                    className={cellClasses}
                                    style={{ backgroundColor: alloc ? getThemeColor(alloc.theme) : 'white' }}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        beginSelection(dIndex, slot);
                                    }}
                                    onMouseEnter={(e) => {
                                        if (e.buttons === 1) updateSelection(dIndex, slot);
                                    }}
                                    onMouseUp={() => { void finalizeSelection(); }}
                                >
                                    {alloc && isStart && (
                                        <div
                                            className={`block-label${preview ? ' block-label-preview' : ''}`}
                                            onMouseDown={(e) => {
                                                if (preview) return;
                                                e.preventDefault();
                                                e.stopPropagation();
                                                beginMove(alloc, slot);
                                            }}
                                            title={preview ? undefined : 'Drag to move block'}
                                        >
                                            <span className="block-grip" aria-hidden="true" />
                                            <span className="block-text">{alloc.subTheme || alloc.theme}</span>
                                        </div>
                                    )}
                                    {alloc && isStart && !preview && (
                                        <div
                                            className="resize-handle resize-handle-top"
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                beginResize(alloc, 'start');
                                            }}
                                            title="Drag to resize start"
                                        />
                                    )}
                                    {alloc && isEnd && !preview && (
                                        <div
                                            className="resize-handle resize-handle-bottom"
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                beginResize(alloc, 'end');
                                            }}
                                            title="Drag to resize end"
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>

            <Modal show={showModal} onHide={handleModalClose} centered>
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
                    onClick={handleModalClose}
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
