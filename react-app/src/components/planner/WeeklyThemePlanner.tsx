import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { Button, Modal, Form, Container, Spinner, Alert, Dropdown } from 'react-bootstrap';
import { Calendar as CalendarIcon, LayoutDashboard, RefreshCw, Save, Sparkles } from 'lucide-react';
import { GLOBAL_THEMES, type GlobalTheme } from '../../constants/globalThemes';
import { useGlobalThemes } from '../../hooks/useGlobalThemes';
import { useNavigate } from 'react-router-dom';
import { addWeeks, format, parseISO, startOfWeek, subWeeks } from 'date-fns';
import { db, functions } from '../../firebase';
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
const CLEAR_THEME_OPTION = 'Clear';
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

interface ThemeAllocationPlanDoc {
    allocations?: Allocation[];
    weeklyOverrides?: Record<string, Allocation[]>;
    updatedAt?: string;
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
const WEEK_OPTION_COUNT = 8;
const cloneAllocations = (source: Allocation[]) => source.map((alloc) => ({ ...alloc, subTheme: alloc.subTheme || null }));
const normalizeWeeklyOverrides = (value: unknown): Record<string, Allocation[]> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.entries(value as Record<string, unknown>).reduce((acc, [key, entry]) => {
        acc[key] = Array.isArray(entry) ? cloneAllocations(entry as Allocation[]) : [];
        return acc;
    }, {} as Record<string, Allocation[]>);
};
const weekKeyFromDate = (value: Date) => format(startOfWeek(value, { weekStartsOn: 1 }), 'yyyy-MM-dd');
const resolveAllocationsForWeek = (
    templateAllocations: Allocation[],
    weeklyOverrides: Record<string, Allocation[]>,
    weekKey: string,
) => {
    if (Object.prototype.hasOwnProperty.call(weeklyOverrides, weekKey)) {
        return cloneAllocations(weeklyOverrides[weekKey] || []);
    }
    return cloneAllocations(templateAllocations);
};

const normalizeCallableError = (error: any, fallbackMessage: string) => {
    const rawCode = String(error?.code || '').toLowerCase();
    const code = rawCode.includes('/') ? rawCode.split('/').pop() : rawCode;
    if (code === 'deadline-exceeded') {
        return 'The planner request timed out. This usually means orchestration is overloaded. Please retry and check planner stats in a minute.';
    }
    if (code === 'unavailable') {
        return 'Planner service is temporarily unavailable. Please retry shortly.';
    }
    if (code === 'permission-denied') {
        return 'Permission denied while calling planner orchestration. Please sign out/in and retry.';
    }
    if (code === 'failed-precondition') {
        return 'Planner preconditions failed (usually missing calendar/profile data). Please verify integrations and retry.';
    }
    return String(error?.message || fallbackMessage);
};

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
    const navigate = useNavigate();
    const { themes: globalThemes } = useGlobalThemes();
    const themeOptions = useMemo(() => {
        const base = globalThemes.length ? globalThemes : GLOBAL_THEMES;
        const hasMainGig = base.some((theme) => {
            const label = String(theme.name || theme.label || '').trim().toLowerCase();
            return label === 'work (main gig)' || label === 'work';
        });
        return hasMainGig ? base : [...base, WORK_MAIN_GIG_THEME];
    }, [globalThemes]);
    const [templateAllocations, setTemplateAllocations] = useState<Allocation[]>([]);
    const [weeklyOverrides, setWeeklyOverrides] = useState<Record<string, Allocation[]>>({});
    const [selectedWeekKey, setSelectedWeekKey] = useState(() => weekKeyFromDate(new Date()));
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
    const [deltaReplanLoading, setDeltaReplanLoading] = useState(false);
    const [nightlyRunning, setNightlyRunning] = useState(false);
    const [seedLoading, setSeedLoading] = useState(false);
    const [fitnessBlocksAutoCreate, setFitnessBlocksAutoCreate] = useState(true);
    const [planningMode, setPlanningMode] = useState<'smart' | 'strict'>('smart');
    const [savingSettings, setSavingSettings] = useState(false);

    const materializePlannerBlocks = httpsCallable(functions, 'materializeFitnessBlocksNow');
    const replanCalendarNowFn = httpsCallable(functions, 'replanCalendarNow', { timeout: 180000 });
    const runNightlyChainFn = httpsCallable(functions, 'runNightlyChainNow', { timeout: 540000 });
    const seedNextWeekPlannerOverridesFn = httpsCallable(functions, 'seedNextWeekPlannerOverridesNow');
    const selectedWeekDate = useMemo(() => parseISO(selectedWeekKey), [selectedWeekKey]);
    const selectedWeekLabel = useMemo(() => format(selectedWeekDate, 'd MMM yyyy'), [selectedWeekDate]);
    const hasWeekOverride = useMemo(
        () => Object.prototype.hasOwnProperty.call(weeklyOverrides, selectedWeekKey),
        [weeklyOverrides, selectedWeekKey],
    );
    const weekOptions = useMemo(() => {
        const base = startOfWeek(new Date(), { weekStartsOn: 1 });
        const options = Array.from({ length: WEEK_OPTION_COUNT }, (_, index) => {
            const start = addWeeks(base, index);
            const key = weekKeyFromDate(start);
            return {
                key,
                start,
                label: index === 0 ? `This week · ${format(start, 'd MMM')}` : `Week of ${format(start, 'd MMM')}`,
            };
        });
        if (!options.some((option) => option.key === selectedWeekKey)) {
            const selectedStart = startOfWeek(selectedWeekDate, { weekStartsOn: 1 });
            options.unshift({
                key: selectedWeekKey,
                start: selectedStart,
                label: `Week of ${format(selectedStart, 'd MMM')}`,
            });
        }
        return options;
    }, [selectedWeekDate, selectedWeekKey]);

    useEffect(() => {
        if (currentUser) loadAllocations();
    }, [currentUser]);

    useEffect(() => {
        if (!themeOptions.length) return;
        const exists = selectedTheme === CLEAR_THEME_OPTION
            || themeOptions.some((theme) => theme.name === selectedTheme || theme.label === selectedTheme);
        if (!exists) {
            setSelectedTheme(themeOptions[0].name || themeOptions[0].label);
        }
    }, [themeOptions, selectedTheme]);

    useEffect(() => {
        if (loading) return;
        setAllocations(resolveAllocationsForWeek(templateAllocations, weeklyOverrides, selectedWeekKey));
    }, [loading, selectedWeekKey, templateAllocations, weeklyOverrides]);

    const loadAllocations = async () => {
        if (!currentUser) return;
        setLoading(true);
        try {
            const [docSnap, profileSnap] = await Promise.all([
                getDoc(doc(db, 'theme_allocations', currentUser.uid)),
                getDoc(doc(db, 'profiles', currentUser.uid)),
            ]);
            const data = docSnap.exists() ? (docSnap.data() as ThemeAllocationPlanDoc) : null;
            const nextTemplateAllocations = Array.isArray(data?.allocations) ? cloneAllocations(data?.allocations || []) : [];
            const nextWeeklyOverrides = normalizeWeeklyOverrides(data?.weeklyOverrides);
            setTemplateAllocations(nextTemplateAllocations);
            setWeeklyOverrides(nextWeeklyOverrides);
            setAllocations(resolveAllocationsForWeek(nextTemplateAllocations, nextWeeklyOverrides, selectedWeekKey));
            if (profileSnap.exists()) {
                const pd = profileSnap.data() || {};
                if (typeof pd.fitnessBlocksAutoCreate === 'boolean') setFitnessBlocksAutoCreate(pd.fitnessBlocksAutoCreate);
                if (pd.plannerMode === 'strict') setPlanningMode('strict');
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const saveProfileSettings = async (updates: Record<string, unknown>) => {
        if (!currentUser) return;
        setSavingSettings(true);
        try {
            await updateDoc(doc(db, 'profiles', currentUser.uid), updates);
        } catch (e) {
            console.error(e);
        } finally {
            setSavingSettings(false);
        }
    };

    const persistPlan = async (
        nextTemplateAllocations: Allocation[],
        nextWeeklyOverrides: Record<string, Allocation[]>,
        successMessage?: string,
    ) => {
        if (!currentUser) return;
        setSaving(true);
        setApplyFeedback(null);
        try {
            const docRef = doc(db, 'theme_allocations', currentUser.uid);
            await setDoc(docRef, {
                allocations: cloneAllocations(nextTemplateAllocations),
                weeklyOverrides: nextWeeklyOverrides,
                updatedAt: new Date().toISOString()
            });
            setTemplateAllocations(cloneAllocations(nextTemplateAllocations));
            setWeeklyOverrides(nextWeeklyOverrides);
            setAllocations(resolveAllocationsForWeek(nextTemplateAllocations, nextWeeklyOverrides, selectedWeekKey));
            if (successMessage) {
                setApplyFeedback({ variant: 'success', message: successMessage });
            }
        } catch (e: any) {
            console.error(e);
            setApplyFeedback({ variant: 'danger', message: e?.message || 'Failed to save weekly plan.' });
        } finally {
            setSaving(false);
        }
    };

    const saveAllocations = async () => {
        const nextOverrides = {
            ...weeklyOverrides,
            [selectedWeekKey]: cloneAllocations(allocations),
        };
        await persistPlan(templateAllocations, nextOverrides, `Saved week plan for ${selectedWeekLabel}.`);
    };

    const saveAsDefaultTemplate = async () => {
        await persistPlan(cloneAllocations(allocations), weeklyOverrides, 'Saved current layout as the default weekly template.');
    };

    const copyPreviousWeek = async () => {
        const previousWeekDate = subWeeks(selectedWeekDate, 1);
        const previousWeekKey = weekKeyFromDate(previousWeekDate);
        const copied = resolveAllocationsForWeek(templateAllocations, weeklyOverrides, previousWeekKey);
        const nextOverrides = {
            ...weeklyOverrides,
            [selectedWeekKey]: cloneAllocations(copied),
        };
        setAllocations(copied);
        await persistPlan(templateAllocations, nextOverrides, `Copied the plan from ${format(previousWeekDate, 'd MMM')} into ${selectedWeekLabel}.`);
    };

    const resetWeekToTemplate = async () => {
        const nextOverrides = { ...weeklyOverrides };
        delete nextOverrides[selectedWeekKey];
        setAllocations(cloneAllocations(templateAllocations));
        await persistPlan(templateAllocations, nextOverrides, `Reset ${selectedWeekLabel} to the default template.`);
    };

    const applyPlannerBlocksNow = async () => {
        if (!currentUser) return;
        setApplying(true);
        setApplyFeedback(null);
        try {
            const res = await materializePlannerBlocks({ days: 7, startDate: selectedWeekKey });
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

    const replanAroundCalendar = async () => {
        if (!currentUser) return;
        setDeltaReplanLoading(true);
        setApplyFeedback(null);
        try {
            const res = await replanCalendarNowFn({ days: 7, startDate: selectedWeekKey, fitnessBlocksAutoCreate, planningMode });
            const data = res.data as { created?: number; rescheduled?: number; blocked?: number; shortfallMinutes?: number; unscheduledStories?: number; unscheduledTasks?: number };
            const parts: string[] = [];
            if (data?.created) parts.push(`${data.created} created`);
            if (data?.rescheduled) parts.push(`${data.rescheduled} moved`);
            if (data?.blocked) parts.push(`${data.blocked} blocked`);
            if (data?.shortfallMinutes) {
                const shortfallHours = Math.round((data.shortfallMinutes / 60) * 10) / 10;
                parts.push(`${shortfallHours}h short`);
            }
            if (data?.unscheduledStories) parts.push(`${data.unscheduledStories} stories unscheduled`);
            if (data?.unscheduledTasks) parts.push(`${data.unscheduledTasks} tasks unscheduled`);
            setApplyFeedback({
                variant: 'success',
                message: parts.length
                    ? `Delta replan complete: ${parts.join(', ')}.`
                    : 'Delta replan complete.',
            });
        } catch (e: any) {
            console.error('Weekly planner delta replan failed', e);
            setApplyFeedback({ variant: 'danger', message: normalizeCallableError(e, 'Failed to run delta replan.') });
        } finally {
            setDeltaReplanLoading(false);
        }
    };

    const runNightlyChainNow = async () => {
        if (!currentUser) return;
        setNightlyRunning(true);
        setApplyFeedback(null);
        try {
            const res = await runNightlyChainFn({
                planningMode,
                fitnessBlocksAutoCreate,
                startDate: selectedWeekKey,
                days: 7,
            });
            const data = res?.data as { results?: Array<{ step?: string; status?: string }> };
            const summary = Array.isArray(data?.results) && data.results.length
                ? data.results.map((item) => `${item.step || 'step'}:${item.status || 'ok'}`).join(', ')
                : 'Nightly chain triggered.';
            setApplyFeedback({ variant: 'success', message: `Nightly chain started. ${summary}` });
        } catch (e: any) {
            console.error('Weekly planner nightly orchestration failed', e);
            setApplyFeedback({ variant: 'danger', message: normalizeCallableError(e, 'Failed to run nightly chain.') });
        } finally {
            setNightlyRunning(false);
        }
    };

    const seedSelectedWeek = async () => {
        if (!currentUser) return;
        setSeedLoading(true);
        setApplyFeedback(null);
        try {
            const res = await seedNextWeekPlannerOverridesFn({ targetWeekKey: selectedWeekKey });
            const data = res?.data as { status?: string; source?: string; reason?: string };
            if (data?.status === 'seeded') {
                await loadAllocations();
                setApplyFeedback({
                    variant: 'success',
                    message: `Seeded ${selectedWeekLabel} from ${data?.source || 'template'}.`,
                });
            } else if (data?.reason === 'already_seeded') {
                setApplyFeedback({
                    variant: 'info',
                    message: `${selectedWeekLabel} already has a saved override.`,
                });
            } else {
                setApplyFeedback({
                    variant: 'info',
                    message: data?.reason
                        ? `No seed applied for ${selectedWeekLabel}: ${data.reason.replace(/_/g, ' ')}.`
                        : `No seed applied for ${selectedWeekLabel}.`,
                });
            }
        } catch (e: any) {
            console.error(e);
            setApplyFeedback({ variant: 'danger', message: e?.message || 'Failed to seed the selected week.' });
        } finally {
            setSeedLoading(false);
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
        if (theme !== CLEAR_THEME_OPTION) {
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
        if (!currentUser) return;
        setAllocations(nextAllocations);
        setShowModal(false);
        setPendingSelection(null);
        clearDragState();
        const nextOverrides = {
            ...weeklyOverrides,
            [selectedWeekKey]: cloneAllocations(nextAllocations),
        };
        await persistPlan(templateAllocations, nextOverrides);
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
            theme: CLEAR_THEME_OPTION,
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
        const isDarkTheme = typeof document !== 'undefined'
            && document.documentElement.getAttribute('data-theme') === 'dark';
        const theme = themeOptions.find(t => t.name === themeName || t.label === themeName);
        if (!theme) return isDarkTheme ? 'var(--panel)' : '#f1f3f4';
        if (isDarkTheme) return theme.darkColor || theme.color || theme.lightColor || 'var(--panel)';
        return theme.lightColor || theme.color || '#f1f3f4';
    };

    if (loading) return <div className="p-5 text-center"><Spinner animation="border" /></div>;

    return (
        <Container fluid className="p-4">
            <div className="mb-3">
                <h2 className="mb-2">Weekly Plan</h2>
                <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 8, overflowX: 'auto', paddingBottom: 4, alignItems: 'center' }}>
                    <Button
                        variant={fitnessBlocksAutoCreate ? 'success' : 'outline-secondary'}
                        size="sm"
                        onClick={async () => {
                            const next = !fitnessBlocksAutoCreate;
                            setFitnessBlocksAutoCreate(next);
                            await saveProfileSettings({ fitnessBlocksAutoCreate: next });
                        }}
                        disabled={savingSettings}
                        title="Toggle whether the AI auto-creates fitness sub-blocks (e.g. Walk, Run) from your weekly plan. Off = manage them manually in GCal."
                        style={{ whiteSpace: 'nowrap' }}
                    >
                        🏃 Fitness {fitnessBlocksAutoCreate ? 'On' : 'Off'}
                    </Button>
                    <Button
                        variant={planningMode === 'smart' ? 'primary' : 'outline-primary'}
                        size="sm"
                        onClick={async () => {
                            const next = planningMode === 'smart' ? 'strict' : 'smart';
                            setPlanningMode(next);
                            await saveProfileSettings({ plannerMode: next });
                        }}
                        disabled={savingSettings}
                        title={planningMode === 'smart'
                            ? 'Smart (active): Top 3 priorities scheduled first. ALWAYS respects user calendar plus Fitness and Work (Main Gig) blocks as hard constraints. Planned blocks act as theme hints and free time is used for auto-scheduling.'
                            : 'Strict (active): Fully respects planned blocks AND user calendar. Events are only inserted into their designated planned block window.'}
                        style={{ whiteSpace: 'nowrap' }}
                    >
                        {planningMode === 'smart' ? 'Smart' : 'Strict'}
                    </Button>
                    <Button
                        size="sm"
                        onClick={saveAllocations}
                        disabled={saving || applying || deltaReplanLoading || nightlyRunning || seedLoading}
                        title="Save the currently selected week layout as this week's override."
                        style={{ whiteSpace: 'nowrap' }}
                    >
                        {saving ? <Spinner size="sm" animation="border" className="me-2" /> : <Save size={14} className="me-1" />}
                        Save Week Plan
                    </Button>
                    <Dropdown>
                        <Dropdown.Toggle
                            size="sm"
                            variant="outline-secondary"
                            disabled={saving || applying || deltaReplanLoading || nightlyRunning || seedLoading}
                            title="Template actions: copy, seed, reset, or save default template."
                            style={{ whiteSpace: 'nowrap' }}
                        >
                            Template Actions
                        </Dropdown.Toggle>
                        <Dropdown.Menu>
                            <Dropdown.Item
                                onClick={copyPreviousWeek}
                                title="Copy the previous week's allocations into this week before making changes."
                            >
                                Copy Previous Week
                            </Dropdown.Item>
                            <Dropdown.Item
                                onClick={seedSelectedWeek}
                                title="Seed this week from prior data; falls back to default template when needed."
                            >
                                {seedLoading ? 'Seeding… ' : ''}Auto-seed Selected Week
                            </Dropdown.Item>
                            <Dropdown.Item
                                onClick={resetWeekToTemplate}
                                disabled={!hasWeekOverride}
                                title="Remove this week's override and use the default template."
                            >
                                Use Default Template
                            </Dropdown.Item>
                            <Dropdown.Item
                                onClick={saveAsDefaultTemplate}
                                title="Save the current week layout as the reusable default template."
                            >
                                Save as Default Template
                            </Dropdown.Item>
                        </Dropdown.Menu>
                    </Dropdown>
                    <Button
                        size="sm"
                        variant="outline-primary"
                        onClick={applyPlannerBlocksNow}
                        disabled={saving || applying || deltaReplanLoading || nightlyRunning || seedLoading}
                        title="Apply Planner Blocks Now: materializes Fitness and Work (Main Gig) allocations into calendar blocks for the next 7 days."
                        style={{ whiteSpace: 'nowrap' }}
                    >
                        {applying ? <Spinner size="sm" animation="border" className="me-1" /> : null}
                        Apply Planner Blocks Now
                    </Button>
                    <Button
                        size="sm"
                        variant="outline-secondary"
                        onClick={replanAroundCalendar}
                        disabled={saving || applying || deltaReplanLoading || nightlyRunning || seedLoading}
                        title="Replan Around Calendar (Delta): rebalances existing calendar blocks around your latest priorities and planner changes."
                        style={{ whiteSpace: 'nowrap' }}
                    >
                        {deltaReplanLoading ? <Spinner size="sm" animation="border" className="me-1" /> : <RefreshCw size={14} className="me-1" />}
                        Replan Around Calendar
                    </Button>
                    <Button
                        size="sm"
                        variant="primary"
                        onClick={runNightlyChainNow}
                        disabled={saving || applying || deltaReplanLoading || nightlyRunning || seedLoading}
                        title="Full replan: runs the complete nightly orchestration (pointing, conversions, priority scoring, and calendar planning)."
                        style={{ whiteSpace: 'nowrap' }}
                    >
                        {nightlyRunning ? <Spinner size="sm" animation="border" className="me-1" /> : <Sparkles size={14} className="me-1" />}
                        Full replan
                    </Button>
                    <Dropdown>
                        <Dropdown.Toggle size="sm" variant="outline-secondary" id="weekly-nav-dropdown" title="Navigation shortcuts to calendar and overview.">
                            Navigate
                        </Dropdown.Toggle>
                        <Dropdown.Menu>
                            <Dropdown.Item onClick={() => navigate('/calendar')} title="Open calendar view.">
                                <CalendarIcon size={14} className="me-1" />
                                View calendar
                            </Dropdown.Item>
                            <Dropdown.Item onClick={() => navigate('/dashboard')} title="Open overview dashboard.">
                                <LayoutDashboard size={14} className="me-1" />
                                View overview
                            </Dropdown.Item>
                        </Dropdown.Menu>
                    </Dropdown>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', paddingBottom: 4, marginTop: 8 }}>
                    <span className="text-muted small" style={{ whiteSpace: 'nowrap' }} title="Select which week to edit.">Week:</span>
                    {weekOptions.map((option) => (
                        <Button
                            key={option.key}
                            size="sm"
                            variant={option.key === selectedWeekKey ? 'primary' : 'outline-secondary'}
                            onClick={() => setSelectedWeekKey(option.key)}
                            disabled={saving || applying || deltaReplanLoading || nightlyRunning || seedLoading}
                            title={`Switch to ${option.label}.`}
                            style={{ whiteSpace: 'nowrap' }}
                        >
                            {option.label}
                        </Button>
                    ))}
                    <span
                        title={hasWeekOverride ? 'This week has its own saved override.' : 'This week is inheriting from your default template.'}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '2px 8px',
                            borderRadius: 999,
                            backgroundColor: hasWeekOverride ? 'rgba(37, 99, 235, 0.12)' : 'rgba(100, 116, 139, 0.12)',
                            color: hasWeekOverride ? '#2563eb' : 'var(--bs-secondary)',
                            fontSize: 12,
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {hasWeekOverride ? 'Week override active' : 'Using default template'}
                    </span>
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
                                    style={{ backgroundColor: alloc ? getThemeColor(alloc.theme) : 'var(--panel)' }}
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
                        title="Choose which theme this selected time range should represent."
                        value={selectedTheme}
                        onChange={e => {
                            const next = e.target.value;
                            setSelectedTheme(next);
                            if (!isHealthTheme(next)) setSelectedSubTheme('');
                        }}
                    >
                        {themeOptions.map(t => <option key={t.id} value={t.name}>{t.label}</option>)}
                        <option value={CLEAR_THEME_OPTION}>Clear (No Theme)</option>
                    </Form.Select>
                    {isHealthTheme(selectedTheme) && (
                        <Form.Group className="mt-3">
                            <Form.Label>Fitness subtype</Form.Label>
                            <Form.Select
                                title="Optional subtype for health/fitness blocks (for clearer scheduling labels)."
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
                    title="Close without applying changes."
                >
                    Cancel
                </Button>
                    <Button variant="primary" onClick={handleSaveTheme} title="Apply selected theme to the highlighted time range.">Set Theme</Button>
                </Modal.Footer>
            </Modal>
        </Container>
    );
};

export default WeeklyThemePlanner;
