import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Form, Badge, ProgressBar, Modal } from 'react-bootstrap';
import {
  addDoc, collection, deleteDoc, doc, getDocs, query,
  serverTimestamp, Timestamp, updateDoc, where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  DndContext, PointerSensor, useDroppable, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { Goal, Story } from '../../types';
import { generateRef } from '../../utils/referenceGenerator';
import { geocodePlace, GeocodeResult } from '../../utils/geocoding';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { continentForIso2 } from '../../utils/geoUtils';
import worldCountries from 'world-atlas/countries-50m.json';
import isoCountries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';
import ModernGoalsTable from '../ModernGoalsTable';
import GoalListPanel from './GoalListPanel';
import ConfirmDialog from '../ConfirmDialog';
import { feature as topojsonFeature } from 'topojson-client';
import { useTravelFirestore } from './hooks/useTravelFirestore';
import {
  TravelEntry, PlaceStatus, PlaceType,
  CONTINENTS, TRAVEL_THEME_ID, AUTO_LINK_THRESHOLD, SUGGEST_LINK_THRESHOLD,
  PLACE_STATUS_COLORS, PLACE_STATUS_LABELS, PLACE_STATUS_PRIORITY,
} from './TravelMapTypes';
isoCountries.registerLocale(enLocale as any);

// ─── types ──────────────────────────────────────────────────────────────────

type GoalMatchCandidate = Pick<Goal, 'id' | 'title' | 'theme' | 'description' | 'tags'>;

interface TravelGoalMatchResponse {
  matchedGoalId?: string | null;
  confidence?: number;
  rationale?: string;
  suggestNewGoalTitle?: string | null;
  promptVersion?: string;
}

interface MapClickPopupInfo {
  screenX: number;
  screenY: number;
  lng: number;
  lat: number;
  iso2?: string;
  countryName?: string;
  existingEntryId?: string;
  cityName?: string;
  regionName?: string;
  resolving?: boolean;
}

// ─── constants ───────────────────────────────────────────────────────────────

const GEO_DATA: any = worldCountries as any;
const MAP_INITIAL_CENTER: [number, number] = [0, 20];
const MAP_INITIAL_ZOOM = 1.2;
const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

// ─── PromptModal ─────────────────────────────────────────────────────────────

interface PromptModalProps {
  show: boolean;
  title: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const PromptModal: React.FC<PromptModalProps> = ({
  show, title, label, placeholder, value, onChange, onConfirm, onCancel,
}) => (
  <Modal show={show} onHide={onCancel} centered>
    <Modal.Header closeButton>
      <Modal.Title>{title}</Modal.Title>
    </Modal.Header>
    <Modal.Body>
      <Form.Group>
        <Form.Label>{label}</Form.Label>
        <Form.Control
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) onConfirm(); }}
        />
      </Form.Group>
    </Modal.Body>
    <Modal.Footer>
      <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      <Button variant="primary" onClick={onConfirm} disabled={!value.trim()}>Create</Button>
    </Modal.Footer>
  </Modal>
);

// ─── MapClickPopup ────────────────────────────────────────────────────────────

interface MapClickPopupProps {
  info: MapClickPopupInfo;
  onMarkVisited: () => void;
  onBucketList: () => void;
  onCreateStory: () => void;
  onClose: () => void;
}

const MapClickPopup: React.FC<MapClickPopupProps> = ({
  info, onMarkVisited, onBucketList, onCreateStory, onClose,
}) => {
  const LEFT_OFFSET = 8;
  const TOP_OFFSET = 8;
  const style: React.CSSProperties = {
    position: 'absolute',
    left: Math.min(info.screenX + LEFT_OFFSET, window.innerWidth - 200),
    top: info.screenY + TOP_OFFSET,
    background: 'white',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
    zIndex: 500,
    minWidth: 180,
    overflow: 'hidden',
  };
  const rowStyle: React.CSSProperties = {
    display: 'block', width: '100%', padding: '9px 14px',
    border: 'none', background: 'none', textAlign: 'left',
    cursor: 'pointer', fontSize: 13,
  };
  return (
    <div style={style}>
      {info.countryName && (
        <div style={{ padding: '8px 14px 6px', borderBottom: '1px solid #f1f5f9', fontWeight: 600, fontSize: 13, color: '#374151' }}>
          {info.countryName}
        </div>
      )}
      <button style={rowStyle} onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')} onMouseLeave={e => (e.currentTarget.style.background = 'none')} onClick={onMarkVisited}>
        ✓ Mark Visited
      </button>
      <button style={rowStyle} onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')} onMouseLeave={e => (e.currentTarget.style.background = 'none')} onClick={onBucketList}>
        ★ Add to Bucket List
      </button>
      <button style={{ ...rowStyle, borderTop: '1px solid #f1f5f9' }} onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')} onMouseLeave={e => (e.currentTarget.style.background = 'none')} onClick={onCreateStory}>
        + Create Story
      </button>
      <button style={{ ...rowStyle, borderTop: '1px solid #f1f5f9', color: '#94a3b8' }} onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')} onMouseLeave={e => (e.currentTarget.style.background = 'none')} onClick={onClose}>
        ✕ Close
      </button>
    </div>
  );
};

// ─── Helpers (pure, no state) ─────────────────────────────────────────────────

const getCountryCode = (entry: TravelEntry): string =>
  (entry.countryCode || entry.country_code || '').toUpperCase();

const getEntryStoryId = (entry: TravelEntry): string | null =>
  entry.storyId || entry.linked_story_id || null;

const parsePlaceStatus = (raw?: unknown): PlaceStatus | null => {
  if (!raw) return null;
  const v = String(raw).trim().toUpperCase();
  if (v === 'UNVISITED') return 'UNVISITED';
  if (v === 'BUCKET_LIST' || v === 'BUCKET-LIST') return 'BUCKET_LIST';
  if (v === 'STORY_CREATED' || v === 'STORY-CREATED') return 'STORY_CREATED';
  if (v === 'COMPLETED' || v === 'COMPLETE') return 'COMPLETED';
  return null;
};

const isStoryDone = (story?: Story | null): boolean => {
  if (!story) return false;
  if (typeof story.status === 'number') return story.status >= 4;
  const raw = String(story.status || '').trim().toLowerCase();
  return ['done', 'complete', 'completed', 'closed', 'finished'].includes(raw);
};

const normalizePlaceStatus = (entry: TravelEntry, story?: Story | null): PlaceStatus => {
  const explicit = parsePlaceStatus(entry.status);
  if (explicit) return explicit;
  if (entry.bucketListFlaggedAt) return 'BUCKET_LIST';
  if (getEntryStoryId(entry)) return isStoryDone(story) ? 'COMPLETED' : 'STORY_CREATED';
  if (entry.visited) return 'COMPLETED';
  return 'UNVISITED';
};

const getPlaceName = (entry: TravelEntry): string => {
  if (entry.name) return entry.name;
  if (entry.city) return entry.city;
  const code = getCountryCode(entry);
  if (code) return isoCountries.getName(code, 'en') || code;
  return entry.locationName || 'Unknown place';
};

const getPlaceType = (entry: TravelEntry): PlaceType => {
  if (entry.placeType) return entry.placeType;
  if (entry.city) return 'city';
  if (getCountryCode(entry)) return 'country';
  return 'region';
};

const isTravelGoal = (goal: Goal): boolean => {
  if (goal.theme === TRAVEL_THEME_ID) return true;
  return (goal.tags || []).map(t => t.toLowerCase()).includes('travel');
};

const derivePlannedVisitAt = (goal?: Goal | null): number | null => {
  if (!goal) return null;
  if (typeof goal.endDate === 'number' && Number.isFinite(goal.endDate)) return goal.endDate;
  if (typeof goal.dueDate === 'number' && Number.isFinite(goal.dueDate)) return goal.dueDate;
  if (goal.targetDate) {
    const p = Date.parse(goal.targetDate);
    if (!Number.isNaN(p)) return p;
  }
  return null;
};

const formatPlannedDate = (timestamp?: number | null): string =>
  timestamp ? new Date(timestamp).toLocaleDateString() : '';

const parseCSV = (content: string): Array<{ country: string; city?: string; status?: string }> => {
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const ci = headers.indexOf('country');
  const cityI = headers.indexOf('city');
  const statusI = headers.indexOf('status');
  if (ci === -1) return [];
  return lines.slice(1).map(l => {
    const parts = l.trim().split(',').map(p => p.trim());
    return { country: parts[ci], city: cityI >= 0 ? parts[cityI] : undefined, status: statusI >= 0 ? parts[statusI] : undefined };
  }).filter(r => r.country);
};

const parseJSON = (content: string): Array<{ country: string; city?: string; status?: string }> => {
  try {
    const data = JSON.parse(content);
    if (!Array.isArray(data)) return [];
    return data.map(item => ({
      country: item.country || item.iso2 || '',
      city: item.city,
      status: item.status,
    })).filter(r => r.country);
  } catch { return []; }
};

const countryFillExpression: any = [
  'case', ['boolean', ['get', 'isSupported'], false],
  ['match', ['get', 'status'],
    'BUCKET_LIST', PLACE_STATUS_COLORS.BUCKET_LIST.fill,
    'STORY_CREATED', PLACE_STATUS_COLORS.STORY_CREATED.fill,
    'COMPLETED', PLACE_STATUS_COLORS.COMPLETED.fill,
    PLACE_STATUS_COLORS.UNVISITED.fill],
  '#e5e7eb',
];

// ─── Main component ───────────────────────────────────────────────────────────

const TravelMapV2: React.FC = () => {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid;

  // ─── data ──────────────────────────────────────────────────────────────────
  const { entries, goals, stories, loading } = useTravelFirestore(uid);

  // ─── UI state ──────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<GeocodeResult | null>(null);
  const [newStatus, setNewStatus] = useState<PlaceStatus>('BUCKET_LIST');
  const [showPlaceMarkers, setShowPlaceMarkers] = useState(true);
  const [showBelowFold, setShowBelowFold] = useState(false);
  const [travelGoalsOnly, setTravelGoalsOnly] = useState(true);

  // selection
  const [selectedIso2, setSelectedIso2] = useState<string | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [manualGoalId, setManualGoalId] = useState('');
  const [newCityForSelected, setNewCityForSelected] = useState('');

  // map click popup
  const [mapClickPopup, setMapClickPopup] = useState<MapClickPopupInfo | null>(null);

  // goal list sidebar
  const [goalListExpanded, setGoalListExpanded] = useState(false);
  const [isDraggingGoal, setIsDraggingGoal] = useState(false);
  const [dragFeedback, setDragFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pendingDuplicateLink, setPendingDuplicateLink] = useState<{ entryId: string; goalId: string } | null>(null);
  const [isLinkingDuplicate, setIsLinkingDuplicate] = useState(false);

  // auto-link toast
  const [autoLinkToast, setAutoLinkToast] = useState<string | null>(null);

  // accessibility picker
  const [showAccessibilityPicker, setShowAccessibilityPicker] = useState(false);
  const [accessibilityGoalId, setAccessibilityGoalId] = useState('');
  const [accessibilityLocationQuery, setAccessibilityLocationQuery] = useState('');
  const [accessibilitySubmitting, setAccessibilitySubmitting] = useState(false);
  const [accessibilityError, setAccessibilityError] = useState<string | null>(null);

  // import
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<{ success: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // map
  const [mapReady, setMapReady] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const resultMarkerRef = useRef<maplibregl.Marker | null>(null);
  const hoveredFeatureIdRef = useRef<string | number | null>(null);
  const selectedFeatureIdRef = useRef<string | number | null>(null);
  const countriesGeojsonRef = useRef<any>(null);
  const mapDropZoneRef = useRef<HTMLDivElement | null>(null);
  const mouseCoordsDuringDragRef = useRef<{ x: number; y: number } | null>(null);
  // stable ref so map event handlers don't need to be re-registered
  const showMapClickPopupRef = useRef<(info: MapClickPopupInfo) => void>(() => {});

  // ─── modal state ───────────────────────────────────────────────────────────
  const [confirmState, setConfirmState] = useState<{
    show: boolean; title: string; message: string; confirmText: string;
    resolve: ((v: boolean) => void) | null;
  }>({ show: false, title: '', message: '', confirmText: 'Confirm', resolve: null });

  const [promptState, setPromptState] = useState<{
    show: boolean; label: string; placeholder: string;
    resolve: ((v: string | null) => void) | null;
  }>({ show: false, label: '', placeholder: '', resolve: null });
  const [promptValue, setPromptValue] = useState('');

  // ─── dnd ───────────────────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const { setNodeRef: setDropZoneNodeRef, isOver: isDraggingOverMap } = useDroppable({ id: 'map-drop-zone' });
  const setMapDropZoneNode = useCallback((node: HTMLDivElement | null) => {
    mapDropZoneRef.current = node;
    setDropZoneNodeRef(node);
  }, [setDropZoneNodeRef]);

  // ─── derived state ─────────────────────────────────────────────────────────
  const storiesById = useMemo(() => {
    const m = new Map<string, Story>();
    stories.forEach(s => m.set(s.id, s));
    return m;
  }, [stories]);

  const travelGoals = useMemo(() => goals.filter(isTravelGoal), [goals]);

  const travelGoalsForTable = useMemo(
    () => (travelGoalsOnly ? travelGoals : goals),
    [travelGoalsOnly, travelGoals, goals]
  );

  const linkedEntriesByGoalId = useMemo(() =>
    entries.reduce<Record<string, number>>((acc, e) => {
      if (e.goalId) acc[e.goalId] = (acc[e.goalId] || 0) + 1;
      return acc;
    }, {}),
    [entries]
  );

  const entriesWithStatus = useMemo(() =>
    entries.map(entry => {
      const sid = getEntryStoryId(entry);
      const story = sid ? storiesById.get(sid) : undefined;
      return { entry, status: normalizePlaceStatus(entry, story || null) };
    }),
    [entries, storiesById]
  );

  const statusByCountry = useMemo(() => {
    const m = new Map<string, PlaceStatus>();
    entriesWithStatus.forEach(({ entry, status }) => {
      const code = getCountryCode(entry);
      if (!code) return;
      const existing = m.get(code);
      if (!existing || PLACE_STATUS_PRIORITY[status] > PLACE_STATUS_PRIORITY[existing]) m.set(code, status);
    });
    return m;
  }, [entriesWithStatus]);

  const countriesGeojson = useMemo(() => {
    const geo = topojsonFeature(GEO_DATA, GEO_DATA.objects.countries as any) as any;
    const features = (geo?.features || []).map((f: any) => {
      const rawId = f?.id;
      const numeric = rawId ? String(rawId).padStart(3, '0') : '';
      const rawIso2 = isoCountries.numericToAlpha2 ? isoCountries.numericToAlpha2(numeric) : '';
      const iso2 = rawIso2 ? rawIso2.toUpperCase() : '';
      const status = iso2 ? (statusByCountry.get(iso2) || 'UNVISITED') : 'UNVISITED';
      return {
        ...f,
        id: iso2 || numeric || f?.properties?.name || rawId,
        properties: { ...(f?.properties || {}), iso2, isSupported: Boolean(iso2), status },
      };
    });
    return { ...geo, features };
  }, [statusByCountry]);

  const bucketListMetrics = useMemo(() => {
    const c = { bucketList: 0, storyCreated: 0, completed: 0 };
    entriesWithStatus.forEach(({ status }) => {
      if (status === 'BUCKET_LIST') c.bucketList++;
      if (status === 'STORY_CREATED') c.storyCreated++;
      if (status === 'COMPLETED') c.completed++;
    });
    const total = c.bucketList + c.storyCreated + c.completed;
    return { counts: c, total, percent: total > 0 ? Math.round((c.completed / total) * 100) : 0 };
  }, [entriesWithStatus]);

  const totalsByContinent = useMemo(() => {
    const t: Record<string, { completed: number; total: number }> = {};
    CONTINENTS.forEach(c => { t[c] = { completed: 0, total: 0 }; });
    entriesWithStatus.forEach(({ entry, status }) => {
      const cont = entry.continent || continentForIso2(getCountryCode(entry)) || 'Unknown';
      if (!t[cont]) t[cont] = { completed: 0, total: 0 };
      t[cont].total++;
      if (status === 'COMPLETED') t[cont].completed++;
    });
    return t;
  }, [entriesWithStatus]);

  const entriesForSelectedCountry = useMemo(() =>
    selectedIso2 ? entries.filter(e => getCountryCode(e) === selectedIso2.toUpperCase()) : [],
    [entries, selectedIso2]
  );

  const highlightGoalId = useMemo(() => {
    if (!selectedStoryId) return null;
    return storiesById.get(selectedStoryId)?.goalId || null;
  }, [selectedStoryId, storiesById]);

  // ─── keep geojson ref current ───────────────────────────────────────────────
  useEffect(() => { countriesGeojsonRef.current = countriesGeojson; }, [countriesGeojson]);

  // ─── keep popup handler ref current (captures latest entries) ──────────────
  useEffect(() => {
    showMapClickPopupRef.current = (info) => {
      const existingEntry = entries.find(e =>
        info.iso2 && getCountryCode(e) === info.iso2 && !e.city
      );
      setMapClickPopup({ ...info, existingEntryId: existingEntry?.id });
    };
  }, [entries]);

  // ─── sync selectedEntry → selectedStory + manualGoalId ─────────────────────
  useEffect(() => {
    if (!selectedEntryId) { setSelectedStoryId(null); return; }
    const entry = entries.find(e => e.id === selectedEntryId);
    if (!entry) return;
    setSelectedStoryId(getEntryStoryId(entry));
    setManualGoalId(entry.goalId || '');
  }, [selectedEntryId, entries]);

  // ─── auto-dismiss feedback / toast ─────────────────────────────────────────
  useEffect(() => {
    if (!dragFeedback) return;
    const t = window.setTimeout(() => { setDragFeedback(null); setPendingDuplicateLink(null); }, 3000);
    return () => window.clearTimeout(t);
  }, [dragFeedback]);

  useEffect(() => {
    if (!autoLinkToast) return;
    const t = window.setTimeout(() => setAutoLinkToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [autoLinkToast]);

  // ─── modal helpers ──────────────────────────────────────────────────────────
  const confirmAsync = useCallback((title: string, message: string, confirmText = 'Confirm'): Promise<boolean> =>
    new Promise(resolve => setConfirmState({ show: true, title, message, confirmText, resolve })),
    []
  );

  const promptGoalNameAsync = useCallback((defaultValue: string): Promise<string | null> => {
    setPromptValue(defaultValue);
    return new Promise(resolve => setPromptState({ show: true, label: 'Goal name', placeholder: 'e.g. Scotland trip 2027', resolve }));
  }, []);

  const handleConfirmYes = useCallback(() => {
    const resolve = confirmState.resolve;
    setConfirmState(s => ({ ...s, show: false, resolve: null }));
    resolve?.(true);
  }, [confirmState.resolve]);

  const handleConfirmNo = useCallback(() => {
    const resolve = confirmState.resolve;
    setConfirmState(s => ({ ...s, show: false, resolve: null }));
    resolve?.(false);
  }, [confirmState.resolve]);

  const handlePromptConfirm = useCallback(() => {
    const resolve = promptState.resolve;
    setPromptState(s => ({ ...s, show: false, resolve: null }));
    resolve?.(promptValue.trim() || null);
  }, [promptState.resolve, promptValue]);

  const handlePromptCancel = useCallback(() => {
    const resolve = promptState.resolve;
    setPromptState(s => ({ ...s, show: false, resolve: null }));
    resolve?.(null);
  }, [promptState.resolve]);

  // ─── firestore helpers ──────────────────────────────────────────────────────
  const updateEntryStatus = async (entry: TravelEntry, status: PlaceStatus, extra: Record<string, any> = {}) => {
    const now = serverTimestamp();
    const updates: Record<string, any> = {
      status,
      placeType: entry.placeType || getPlaceType(entry),
      name: entry.name || getPlaceName(entry),
      countryCode: entry.countryCode || getCountryCode(entry) || null,
      visited: status === 'COMPLETED',
      updatedAt: now,
      ...extra,
    };
    if (status === 'BUCKET_LIST' && !entry.bucketListFlaggedAt) updates.bucketListFlaggedAt = now;
    if (status === 'STORY_CREATED' && !entry.storyCreatedAt) updates.storyCreatedAt = now;
    if (status === 'COMPLETED' && !entry.completedAt) updates.completedAt = now;
    if (status === 'COMPLETED' && !entry.visitedAt) updates.visitedAt = now;
    await updateDoc(doc(db, 'travel', entry.id), updates);
  };

  const upsertCountryEntry = async (iso2: string, status: PlaceStatus): Promise<TravelEntry> => {
    const isoUpper = iso2.toUpperCase();
    const existing = entries.find(e => getCountryCode(e) === isoUpper && !e.city);
    if (existing) {
      await updateEntryStatus(existing, status);
      return { ...existing, status };
    }
    const countryName = isoCountries.getName(isoUpper, 'en') || isoUpper;
    const ref = await addDoc(collection(db, 'travel'), {
      placeType: 'country', name: countryName,
      countryCode: isoUpper, country_code: isoUpper,
      visited: status === 'COMPLETED', status,
      continent: continentForIso2(isoUpper), ownerUid: uid,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      ...(status === 'BUCKET_LIST' ? { bucketListFlaggedAt: serverTimestamp() } : {}),
      ...(status === 'COMPLETED' ? { completedAt: serverTimestamp(), visitedAt: serverTimestamp() } : {}),
    });
    return { id: ref.id, placeType: 'country', name: countryName, countryCode: isoUpper, country_code: isoUpper, ownerUid: uid!, status };
  };

  // ─── goal matching ──────────────────────────────────────────────────────────
  const buildPlaceHierarchy = (entry: TravelEntry) => {
    const cc = getCountryCode(entry);
    return {
      cityName: entry.city || '',
      countryName: cc ? (isoCountries.getName(cc, 'en') || cc) : '',
      continentName: entry.continent || (cc ? continentForIso2(cc) : '') || '',
    };
  };

  const findHeuristicGoalMatch = useCallback((entry: TravelEntry): { goal: GoalMatchCandidate | null; confidence: number } => {
    const { cityName, countryName, continentName } = buildPlaceHierarchy(entry);
    const tokens = [
      { value: cityName, weight: 0.9 },
      { value: countryName, weight: 0.7 },
      { value: continentName, weight: 0.5 },
    ].filter(t => t.value);
    let bestGoal: GoalMatchCandidate | null = null;
    let bestScore = 0;
    travelGoals.forEach(goal => {
      const hay = `${goal.title || ''} ${goal.description || ''}`.toLowerCase();
      let score = 0;
      tokens.forEach(({ value, weight }) => {
        if (value && hay.includes(value.toLowerCase())) score = Math.max(score, weight);
      });
      if (score > bestScore) { bestScore = score; bestGoal = goal; }
    });
    return { goal: bestGoal, confidence: bestScore };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [travelGoals]);

  const callGoalMatcher = useCallback(async (entry: TravelEntry): Promise<TravelGoalMatchResponse> => {
    if (!uid || !travelGoals.length) return { matchedGoalId: null, confidence: 0 };
    try {
      const { cityName, countryName, continentName } = buildPlaceHierarchy(entry);
      const callable = httpsCallable(functions, 'matchTravelGoal');
      const res = await callable({
        place: { name: getPlaceName(entry), type: getPlaceType(entry), hierarchy: { city: cityName || null, country: countryName || null, continent: continentName || null }, notes: entry.locationName || null },
        goals: travelGoals.slice(0, 40).map(g => ({ goalId: g.id, title: g.title, description: g.description || '', tags: g.tags || [], theme: g.theme })),
        placeId: entry.id || null,
      });
      const data = res.data as TravelGoalMatchResponse;
      const confidence = Math.max(0, Math.min(1, Number(data?.confidence ?? 0)));
      return { ...data, confidence };
    } catch (err) {
      console.warn('[travel] goal matcher failed', err);
      return { matchedGoalId: null, confidence: 0 };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, travelGoals]);

  const createTravelGoal = useCallback(async (suggestedTitle?: string): Promise<GoalMatchCandidate | null> => {
    if (!uid) return null;
    const name = await promptGoalNameAsync(suggestedTitle || '');
    if (!name) return null;
    const now = serverTimestamp();
    const created = await addDoc(collection(db, 'goals'), {
      persona: 'personal', title: name, description: 'Trip goal created from Travel Map',
      theme: TRAVEL_THEME_ID, size: 2, timeToMasterHours: 0, confidence: 2,
      status: 0, ownerUid: uid, createdAt: now, updatedAt: now,
    });
    return { id: created.id, title: name, theme: TRAVEL_THEME_ID };
  }, [uid, promptGoalNameAsync]);

  /**
   * Resolve a goal match for an entry.
   * ≥ AUTO_LINK_THRESHOLD  → auto-link (toast)
   * ≥ SUGGEST_LINK_THRESHOLD → confirm modal
   * < SUGGEST_LINK_THRESHOLD → skip
   */
  const resolveGoalMatch = useCallback(async (
    entry: TravelEntry,
    opts: { allowCreate?: boolean } = {}
  ): Promise<{ goal: GoalMatchCandidate | null; confidence: number; method: 'heuristic' | 'manual' | 'llm' | null }> => {
    if (entry.goalId) {
      const existing = goals.find(g => g.id === entry.goalId);
      if (existing) return { goal: existing, confidence: entry.matchConfidence ?? 1, method: entry.matchMethod ?? 'manual' };
    }

    const heuristic = findHeuristicGoalMatch(entry);
    if (heuristic.goal && heuristic.confidence >= SUGGEST_LINK_THRESHOLD) {
      if (heuristic.confidence >= AUTO_LINK_THRESHOLD) {
        setAutoLinkToast(`Auto-linked to: ${heuristic.goal.title}`);
        return { goal: heuristic.goal, confidence: heuristic.confidence, method: 'heuristic' };
      }
      const ok = await confirmAsync('Goal match found', `Match: "${heuristic.goal.title}" (${Math.round(heuristic.confidence * 100)}% confidence). Link it?`, 'Link Goal');
      if (ok) return { goal: heuristic.goal, confidence: heuristic.confidence, method: 'heuristic' };
    }

    const llm = await callGoalMatcher(entry);
    if (llm.matchedGoalId) {
      const llmGoal = goals.find(g => g.id === llm.matchedGoalId);
      const confidence = Math.max(0, Math.min(1, Number(llm.confidence || 0)));
      if (llmGoal && confidence >= SUGGEST_LINK_THRESHOLD) {
        if (confidence >= AUTO_LINK_THRESHOLD) {
          setAutoLinkToast(`Auto-linked to: ${llmGoal.title}`);
          return { goal: llmGoal, confidence, method: 'llm' };
        }
        const ok = await confirmAsync('Goal match found', `Match: "${llmGoal.title}" (${Math.round(confidence * 100)}% confidence). Link it?`, 'Link Goal');
        if (ok) return { goal: llmGoal, confidence, method: 'llm' };
      }
    }

    if (opts.allowCreate) {
      const suggestedTitle = llm.suggestNewGoalTitle || (entry.city ? `Trip to ${entry.city}` : `Trip to ${getPlaceName(entry)}`);
      const create = await confirmAsync('No match found', 'No matching travel goal found. Create a new one?', 'Create Goal');
      if (create) {
        const created = await createTravelGoal(suggestedTitle);
        if (created) return { goal: created, confidence: 1, method: 'manual' };
      }
    }

    return { goal: null, confidence: 0, method: null };
  }, [goals, findHeuristicGoalMatch, callGoalMatcher, createTravelGoal, confirmAsync]);

  // ─── CRUD ops ────────────────────────────────────────────────────────────────
  const flagBucketList = async (entry: TravelEntry) => {
    const match = await resolveGoalMatch(entry, { allowCreate: true });
    await updateEntryStatus(entry, 'BUCKET_LIST', {
      goalId: match.goal?.id || null,
      goalTitleSnapshot: match.goal?.title || null,
      matchConfidence: match.goal ? match.confidence : null,
      matchMethod: match.goal ? match.method : null,
      lastMatchedAt: match.goal ? serverTimestamp() : null,
    });
  };

  const markPlaceCompleted = async (entry: TravelEntry) => {
    const storyId = getEntryStoryId(entry);
    if (storyId) await updateDoc(doc(db, 'stories', storyId), { status: 4, updatedAt: serverTimestamp() });
    await updateEntryStatus(entry, 'COMPLETED');
  };

  const resetPlaceStatus = async (entry: TravelEntry) => updateEntryStatus(entry, 'UNVISITED');

  const applyManualGoalMatch = async (entry: TravelEntry) => {
    if (!manualGoalId) return;
    const goal = goals.find(g => g.id === manualGoalId);
    if (!goal) return;
    await updateDoc(doc(db, 'travel', entry.id), {
      goalId: goal.id, goalTitleSnapshot: goal.title,
      matchConfidence: 1, matchMethod: 'manual',
      lastMatchedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
  };

  const geocodeEntry = async (e: TravelEntry) => {
    const q = `${e.city ? e.city + ', ' : ''}${getCountryCode(e)}`.trim();
    const r = await geocodePlace(q);
    if (!r) return;
    await updateDoc(doc(db, 'travel', e.id), {
      lat: r.lat, lon: r.lon, lng: r.lon, locationName: r.displayName,
      continent: continentForIso2(r.countryCode) || e.continent,
      name: e.name || r.displayName, updatedAt: serverTimestamp(),
    });
  };

  const addCityToSelected = async () => {
    if (!uid || !selectedIso2 || !newCityForSelected.trim()) return;
    await addDoc(collection(db, 'travel'), {
      placeType: 'city', name: newCityForSelected.trim(),
      countryCode: selectedIso2, country_code: selectedIso2,
      city: newCityForSelected.trim(), status: 'UNVISITED',
      visited: false, visitedAt: null, linked_story_id: null, storyId: null,
      continent: continentForIso2(selectedIso2) || null,
      ownerUid: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), plannedVisitAt: null,
    });
    setNewCityForSelected('');
  };

  const handleGoalUpdate = async (goalId: string, updates: Partial<Goal>) => {
    await updateDoc(doc(db, 'goals', goalId), { ...updates, updatedAt: serverTimestamp() });
  };
  const handleGoalDelete = async (goalId: string) => { await deleteDoc(doc(db, 'goals', goalId)); };
  const handleGoalPriorityChange = async (goalId: string, newPriority: number) => {
    await updateDoc(doc(db, 'goals', goalId), { orderIndex: newPriority, updatedAt: serverTimestamp() });
  };

  const createStoryForEntry = async (entry: TravelEntry) => {
    if (!uid || getEntryStoryId(entry)) return;
    const match = await resolveGoalMatch(entry, { allowCreate: true });
    const goalDetails = match.goal ? goals.find(g => g.id === match.goal?.id) : undefined;
    const plannedVisitAt = derivePlannedVisitAt(goalDetails);
    const cc = getCountryCode(entry);
    const title = `Visit ${entry.city ? entry.city + ', ' : ''}${cc || getPlaceName(entry)}`.trim();
    const storyPayload = {
      persona: 'personal' as const, title,
      description: `Travel log for ${title}.`,
      goalId: match.goal?.id || '', theme: goalDetails?.theme ?? TRAVEL_THEME_ID,
      status: 0, priority: 2, points: 1, wipLimit: 3, tags: ['travel'],
      sprintId: undefined, orderIndex: 0, ownerUid: uid,
      acceptanceCriteria: [] as string[],
      countryCode: cc || undefined, city: entry.city,
      locationName: entry.locationName || getPlaceName(entry),
      locationLat: entry.lat, locationLon: entry.lng ?? entry.lon,
      dueDate: plannedVisitAt ?? null,
      metadata: { plannedVisitAt: plannedVisitAt ?? null },
    } satisfies Omit<Story, 'id' | 'createdAt' | 'updatedAt' | 'ref'>;

    const existingDocs = await getDocs(query(collection(db, 'stories'), where('ownerUid', '==', uid)));
    const existingRefs = existingDocs.docs.map(d => (d.data() as any).ref).filter(Boolean) as string[];
    const shortRef = generateRef('story', existingRefs);

    const storyRef = await addDoc(collection(db, 'stories'), {
      ...storyPayload, ref: shortRef, referenceNumber: shortRef,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    setSelectedStoryId(storyRef.id);
    await updateEntryStatus(entry, 'STORY_CREATED', {
      storyId: storyRef.id, linked_story_id: storyRef.id,
      storyNumber: shortRef, storyTitleSnapshot: title,
      goalId: match.goal?.id || null, goalTitleSnapshot: match.goal?.title || null,
      matchConfidence: match.goal ? match.confidence : null,
      matchMethod: match.goal ? match.method : null,
      lastMatchedAt: match.goal ? serverTimestamp() : null,
      plannedVisitAt: plannedVisitAt ?? null, storyCreatedAt: serverTimestamp(),
    });
  };

  const createStoryFromGeocode = async (g: GeocodeResult) => {
    if (!uid) return;
    const iso2 = (g.countryCode || '').toUpperCase();
    const ref = await addDoc(collection(db, 'travel'), {
      placeType: g.city ? 'city' : 'country',
      name: g.city || g.displayName || iso2,
      countryCode: iso2, country_code: iso2, city: g.city || null,
      continent: continentForIso2(iso2), ownerUid: uid, status: 'UNVISITED',
      lat: g.lat, lon: g.lon, lng: g.lon, locationName: g.displayName,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), plannedVisitAt: null,
    });
    await createStoryForEntry({ id: ref.id, placeType: g.city ? 'city' : 'country', name: g.city || g.displayName || iso2, countryCode: iso2, country_code: iso2, city: g.city || undefined, continent: continentForIso2(iso2), ownerUid: uid, status: 'UNVISITED', lat: g.lat, lon: g.lon, lng: g.lon, locationName: g.displayName } as TravelEntry);
  };

  // ─── map click popup actions ─────────────────────────────────────────────────
  const handleMapClickVisited = useCallback(async () => {
    if (!mapClickPopup || !uid) return;
    setMapClickPopup(null);
    if (mapClickPopup.iso2) {
      const entry = await upsertCountryEntry(mapClickPopup.iso2, 'COMPLETED');
      setSelectedIso2(mapClickPopup.iso2);
      setSelectedEntryId(entry.id || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapClickPopup, uid, entries]);

  const handleMapClickBucketList = useCallback(async () => {
    if (!mapClickPopup || !uid) return;
    setMapClickPopup(null);
    if (mapClickPopup.iso2) {
      const entry = await upsertCountryEntry(mapClickPopup.iso2, 'BUCKET_LIST');
      setSelectedIso2(mapClickPopup.iso2);
      setSelectedEntryId(entry.id || null);
      // trigger goal matching
      if (entry.id) {
        const fullEntry = entries.find(e => e.id === entry.id) || entry;
        await flagBucketList(fullEntry);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapClickPopup, uid, entries]);

  const handleMapClickCreateStory = useCallback(async () => {
    if (!mapClickPopup || !uid) return;
    setMapClickPopup(null);
    if (mapClickPopup.iso2) {
      let entry = entries.find(e => getCountryCode(e) === mapClickPopup.iso2 && !e.city);
      if (!entry) {
        const created = await upsertCountryEntry(mapClickPopup.iso2!, 'UNVISITED');
        entry = created;
      }
      setSelectedIso2(mapClickPopup.iso2!);
      setSelectedEntryId(entry.id || null);
      if (entry.id) await createStoryForEntry(entry);
    } else if (mapClickPopup.lat != null && mapClickPopup.lng != null) {
      // No country identified — geocode the coordinates
      const r = await reverseGeocodeCoords([mapClickPopup.lng, mapClickPopup.lat]);
      if (r) await createStoryFromGeocode(r);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapClickPopup, uid, entries]);

  // ─── reverse geocode ─────────────────────────────────────────────────────────
  const reverseGeocodeCoords = useCallback(async (coords: [number, number]): Promise<GeocodeResult | null> => {
    const [lng, lat] = coords;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`,
        { headers: { Accept: 'application/json' }, signal: controller.signal }
      );
      if (!res.ok) return null;
      const data = await res.json();
      const address = data?.address || {};
      const cityLike = address.city || address.town || address.village || address.hamlet;
      const cc = (address.country_code || '').toUpperCase();
      return { lat, lon: lng, displayName: data?.display_name || cityLike || cc || 'Pinned location', countryCode: cc, city: cityLike };
    } catch { return null; }
    finally { window.clearTimeout(timeoutId); }
  }, []);

  // ─── drag-and-drop ───────────────────────────────────────────────────────────
  const normalizePlaceToken = useCallback((v?: string | null) => String(v || '').trim().toLowerCase(), []);

  const createTravelEntryFromGoal = useCallback(async (goalId: string, coords: [number, number]) => {
    if (!uid) return false;
    const goal = goals.find(g => g.id === goalId);
    if (!goal) { setDragFeedback({ type: 'error', text: 'Could not resolve dragged goal. Please retry.' }); return false; }

    const geocode = await reverseGeocodeCoords(coords);
    if (!geocode?.countryCode && !geocode?.city) {
      setDragFeedback({ type: 'error', text: 'Could not identify that location. Drop on a mapped country.' }); return false;
    }

    const cc = (geocode.countryCode || '').toUpperCase();
    const city = geocode.city?.trim() || null;
    const targetCityToken = normalizePlaceToken(city);

    const duplicate = entries.find(e => e.goalId === goal.id && getCountryCode(e) === cc && normalizePlaceToken(e.city) === targetCityToken);
    if (duplicate) {
      setSelectedIso2(cc || null); setSelectedEntryId(duplicate.id); setManualGoalId(goal.id);
      setDragFeedback({ type: 'success', text: `Travel entry already exists for ${goal.title}.` });
      return true;
    }

    const duplicateOtherGoal = entries.find(e => e.goalId && e.goalId !== goal.id && getCountryCode(e) === cc && normalizePlaceToken(e.city) === targetCityToken);
    if (duplicateOtherGoal) {
      setSelectedIso2(cc || null); setSelectedEntryId(duplicateOtherGoal.id);
      setPendingDuplicateLink({ entryId: duplicateOtherGoal.id, goalId: goal.id });
      setDragFeedback({ type: 'error', text: `That destination is under "${duplicateOtherGoal.goalTitleSnapshot || 'another goal'}". Link this existing destination to ${goal.title} instead?` });
      return false;
    }

    const placeType: PlaceType = city ? 'city' : 'country';
    const entryName = city || isoCountries.getName(cc, 'en') || geocode.displayName || goal.title;
    const plannedVisitAt = derivePlannedVisitAt(goal);
    const created = await addDoc(collection(db, 'travel'), {
      placeType, name: entryName, countryCode: cc || null, country_code: cc || null, city,
      status: 'BUCKET_LIST', visited: false, visitedAt: null, linked_story_id: null, storyId: null,
      continent: cc ? continentForIso2(cc) : null, ownerUid: uid,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      plannedVisitAt: plannedVisitAt ?? null,
      goalId: goal.id, goalTitleSnapshot: goal.title,
      lastMatchedAt: serverTimestamp(), matchConfidence: 1, matchMethod: 'manual',
      bucketListFlaggedAt: serverTimestamp(), storyCreatedAt: null, completedAt: null,
      lat: geocode.lat, lon: geocode.lon, lng: geocode.lon, locationName: geocode.displayName,
    });
    if (cc) setSelectedIso2(cc);
    setSelectedEntryId(created.id); setManualGoalId(goal.id);
    setDragFeedback({ type: 'success', text: `Created travel entry for ${goal.title} at ${entryName}.` });
    return true;
  }, [uid, goals, entries, reverseGeocodeCoords, normalizePlaceToken]);

  const linkDuplicateEntryToGoal = useCallback(async () => {
    if (!pendingDuplicateLink || isLinkingDuplicate) return;
    const { entryId, goalId } = pendingDuplicateLink;
    const goal = goals.find(g => g.id === goalId);
    if (!goal) { setDragFeedback({ type: 'error', text: 'Goal not found. Please retry.' }); setPendingDuplicateLink(null); return; }
    setIsLinkingDuplicate(true);
    try {
      await updateDoc(doc(db, 'travel', entryId), {
        goalId: goal.id, goalTitleSnapshot: goal.title,
        lastMatchedAt: serverTimestamp(), matchConfidence: 1, matchMethod: 'manual', updatedAt: serverTimestamp(),
      });
      setManualGoalId(goal.id); setSelectedEntryId(entryId);
      setDragFeedback({ type: 'success', text: `Linked to ${goal.title}.` });
    } catch {
      setDragFeedback({ type: 'error', text: 'Could not link destination. Please retry.' });
    } finally {
      setIsLinkingDuplicate(false); setPendingDuplicateLink(null);
    }
  }, [goals, isLinkingDuplicate, pendingDuplicateLink]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    setIsDraggingGoal(false);
    if (!over || over.id !== 'map-drop-zone' || !active.data?.current?.goalId || !mapRef.current) {
      mouseCoordsDuringDragRef.current = null; return;
    }
    const goalId = active.data.current.goalId as string;
    let dropCoords: [number, number];
    if (mouseCoordsDuringDragRef.current) {
      try {
        const canvas = mapRef.current.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const x = mouseCoordsDuringDragRef.current.x - rect.left;
        const y = mouseCoordsDuringDragRef.current.y - rect.top;
        if (x >= 0 && x < rect.width && y >= 0 && y < rect.height) {
          const ll = mapRef.current.unproject([x, y]);
          dropCoords = [ll.lng, ll.lat];
        } else {
          const c = mapRef.current.getCenter(); dropCoords = [c.lng, c.lat];
        }
      } catch {
        const c = mapRef.current.getCenter(); dropCoords = [c.lng, c.lat];
      }
    } else {
      const c = mapRef.current.getCenter(); dropCoords = [c.lng, c.lat];
    }
    mouseCoordsDuringDragRef.current = null;
    await createTravelEntryFromGoal(goalId, dropCoords);
  }, [createTravelEntryFromGoal]);

  // ─── import ──────────────────────────────────────────────────────────────────
  const importTravelEntries = async (file: File) => {
    if (!uid) return;
    setImporting(true); setImportStatus(null);
    try {
      const content = await file.text();
      const ext = file.name.toLowerCase();
      let parsed: Array<{ country: string; city?: string; status?: string }> = [];
      if (ext.endsWith('.json')) parsed = parseJSON(content);
      else if (ext.endsWith('.csv')) parsed = parseCSV(content);
      else { try { parsed = parseJSON(content); } catch { parsed = parseCSV(content); } }

      let successCount = 0;
      const errors: string[] = [];
      for (const item of parsed) {
        try {
          const iso2 = item.country.toUpperCase();
          const status = parsePlaceStatus(item.status) || 'UNVISITED';
          const existing = entries.find(e => getCountryCode(e) === iso2 && (!item.city || e.city === item.city));
          if (existing) { if (item.status) await updateEntryStatus(existing, status); }
          else {
            await addDoc(collection(db, 'travel'), {
              placeType: item.city ? 'city' : 'country',
              name: item.city || isoCountries.getName(iso2, 'en') || iso2,
              countryCode: iso2, country_code: iso2, city: item.city || null,
              status, visited: status === 'COMPLETED',
              visitedAt: status === 'COMPLETED' ? serverTimestamp() : null,
              continent: continentForIso2(iso2) || 'Other', ownerUid: uid,
              createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
            });
          }
          successCount++;
        } catch (err) {
          errors.push(`${item.country}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
      setImportStatus({ success: successCount, errors });
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setImportStatus({ success: 0, errors: [err instanceof Error ? err.message : 'Failed to import file'] });
    } finally { setImporting(false); }
  };

  // ─── geocode search ───────────────────────────────────────────────────────────
  const runGeocode = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    const r = await geocodePlace(searchQuery.trim());
    setSearchResult(r); setSearching(false);
  };

  const addGeocodeAsPlace = async () => {
    if (!uid || !searchResult) return;
    const iso2 = (searchResult.countryCode || '').toUpperCase();
    const match = newStatus === 'BUCKET_LIST'
      ? await resolveGoalMatch({ id: '', placeType: searchResult.city ? 'city' : 'country', name: searchResult.city || searchResult.displayName || iso2, countryCode: iso2, country_code: iso2, city: searchResult.city || undefined, ownerUid: uid, status: newStatus } as TravelEntry, { allowCreate: true })
      : { goal: null, confidence: 0, method: null };
    await addDoc(collection(db, 'travel'), {
      placeType: searchResult.city ? 'city' : 'country',
      name: searchResult.city || searchResult.displayName || iso2,
      countryCode: iso2, country_code: iso2, city: searchResult.city || null,
      status: newStatus, visited: newStatus === 'COMPLETED',
      visitedAt: newStatus === 'COMPLETED' ? serverTimestamp() : null,
      linked_story_id: null, storyId: null,
      continent: continentForIso2(searchResult.countryCode) || null,
      lat: searchResult.lat, lon: searchResult.lon, lng: searchResult.lon,
      locationName: searchResult.displayName, ownerUid: uid,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), plannedVisitAt: null,
      goalId: match.goal?.id || null, goalTitleSnapshot: match.goal?.title || null,
      lastMatchedAt: match.goal ? serverTimestamp() : null,
      matchConfidence: match.goal ? match.confidence : null,
      matchMethod: match.goal ? match.method : null,
      bucketListFlaggedAt: newStatus === 'BUCKET_LIST' ? serverTimestamp() : null,
      completedAt: newStatus === 'COMPLETED' ? serverTimestamp() : null,
    });
  };

  // ─── accessibility picker ─────────────────────────────────────────────────────
  const openAccessibilityPicker = useCallback(() => {
    setAccessibilityGoalId(travelGoals[0]?.id || '');
    setAccessibilityLocationQuery('');
    setAccessibilityError(null);
    setShowAccessibilityPicker(true);
  }, [travelGoals]);

  const handleAccessibilityPickerSubmit = useCallback(async () => {
    if (!accessibilityGoalId || !accessibilityLocationQuery.trim()) {
      setAccessibilityError('Select a goal and enter a destination.'); return;
    }
    setAccessibilitySubmitting(true); setAccessibilityError(null);
    try {
      const geocode = await geocodePlace(accessibilityLocationQuery.trim());
      if (!geocode) { setAccessibilityError('Could not geocode that destination.'); return; }
      const created = await createTravelEntryFromGoal(accessibilityGoalId, [geocode.lon, geocode.lat]);
      if (created) { setShowAccessibilityPicker(false); setAccessibilityLocationQuery(''); }
    } finally { setAccessibilitySubmitting(false); }
  }, [accessibilityGoalId, accessibilityLocationQuery, createTravelEntryFromGoal]);

  // ─── keyboard shortcut ────────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;
      if (event.altKey && event.key.toLowerCase() === 'd') { event.preventDefault(); openAccessibilityPicker(); }
      if (event.key === 'Escape') { setMapClickPopup(null); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openAccessibilityPicker]);

  // ─── planned-visit sync ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!uid || !entries.length) return;
    const syncPlannedVisits = async () => {
      for (const entry of entries) {
        const sid = getEntryStoryId(entry);
        if (!sid) continue;
        const story = storiesById.get(sid);
        if (!story) continue;
        const goal = goals.find(g => g.id === story.goalId);
        const plannedFromGoal = derivePlannedVisitAt(goal);
        const storyDueDate = typeof story.dueDate === 'number' ? story.dueDate : null;
        const desired = plannedFromGoal ?? storyDueDate ?? null;
        const entryNeedsUpdate = (entry.plannedVisitAt ?? null) !== desired;
        const storyNeedsUpdate = storyDueDate !== desired || (story.metadata?.plannedVisitAt ?? null) !== desired;
        const desiredStatus: PlaceStatus = isStoryDone(story) ? 'COMPLETED' : 'STORY_CREATED';
        const statusNeedsUpdate = normalizePlaceStatus(entry, story) !== desiredStatus;
        if (!entryNeedsUpdate && !storyNeedsUpdate && !statusNeedsUpdate) continue;
        try {
          const updates: Promise<unknown>[] = [];
          if (statusNeedsUpdate) updates.push(updateEntryStatus(entry, desiredStatus, entryNeedsUpdate ? { plannedVisitAt: desired } : {}));
          else if (entryNeedsUpdate) updates.push(updateDoc(doc(db, 'travel', entry.id), { plannedVisitAt: desired, updatedAt: serverTimestamp() }));
          if (storyNeedsUpdate) updates.push(updateDoc(doc(db, 'stories', story.id), { dueDate: desired, metadata: { ...(story.metadata || {}), plannedVisitAt: desired }, updatedAt: serverTimestamp() }));
          if (updates.length) await Promise.all(updates);
        } catch (err) {
          console.error('[travel] planned-visit sync failed', { entryId: entry.id, err });
        }
      }
    };
    syncPlannedVisits();
  }, [uid, entries, storiesById, goals]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── map init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: MAP_INITIAL_CENTER,
      zoom: MAP_INITIAL_ZOOM,
      minZoom: 0.5, maxZoom: 14,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

    map.on('load', () => {
      setMapReady(true);
      if (!map.getSource('countries')) {
        map.addSource('countries', { type: 'geojson', data: countriesGeojsonRef.current });
      }
      if (!map.getLayer('country-fill')) {
        map.addLayer({
          id: 'country-fill', type: 'fill', source: 'countries',
          paint: {
            'fill-color': countryFillExpression,
            'fill-opacity': ['case', ['boolean', ['get', 'isSupported'], false],
              ['match', ['get', 'status'],
                'COMPLETED', 1.0, 'STORY_CREATED', 0.75, 'BUCKET_LIST', 0.6, 0.2],
              0.1] as any,
          },
        });
      }
      if (!map.getLayer('country-outline')) {
        map.addLayer({
          id: 'country-outline', type: 'line', source: 'countries',
          paint: {
            'line-color': ['case',
              ['boolean', ['feature-state', 'selected'], false], '#ea580c',
              ['boolean', ['feature-state', 'hover'], false], '#2563eb',
              '#94a3b8'] as any,
            'line-width': ['case',
              ['boolean', ['feature-state', 'selected'], false], 1.6,
              ['boolean', ['feature-state', 'hover'], false], 1.2,
              0.4] as any,
          },
        });
      }

      // any click → show popup with action options
      map.on('click', (event) => {
        const features = map.queryRenderedFeatures(event.point, { layers: ['country-fill'] });
        const feature = features?.[0] as any;
        const iso2 = feature?.properties?.iso2 && feature?.properties?.isSupported
          ? (feature.properties.iso2 as string).toUpperCase() : undefined;
        showMapClickPopupRef.current({
          screenX: event.point.x,
          screenY: event.point.y,
          lng: event.lngLat.lng,
          lat: event.lngLat.lat,
          iso2,
          countryName: iso2 ? (isoCountries.getName(iso2, 'en') || iso2) : undefined,
        });
      });

      // right-click still available for quick status toggle
      map.on('contextmenu', 'country-fill', (event) => {
        event.originalEvent.preventDefault();
        const feature = event.features?.[0] as any;
        const iso2 = feature?.properties?.iso2;
        const isSupported = feature?.properties?.isSupported;
        if (iso2 && isSupported) {
          const isoUpper = iso2.toUpperCase();
          setSelectedIso2(isoUpper);
          upsertCountryEntry(isoUpper, 'COMPLETED').then(entry => {
            setSelectedEntryId(entry.id || null);
          });
        }
      });

      map.on('mousemove', 'country-fill', (event) => {
        const feature = event.features?.[0] as any;
        const featureId = feature?.id;
        const isSupported = feature?.properties?.isSupported;
        if (!isSupported) {
          if (hoveredFeatureIdRef.current != null) {
            map.setFeatureState({ source: 'countries', id: hoveredFeatureIdRef.current }, { hover: false });
            hoveredFeatureIdRef.current = null;
          }
          map.getCanvas().style.cursor = '';
          return;
        }
        if (featureId == null) return;
        if (hoveredFeatureIdRef.current && hoveredFeatureIdRef.current !== featureId) {
          map.setFeatureState({ source: 'countries', id: hoveredFeatureIdRef.current }, { hover: false });
        }
        hoveredFeatureIdRef.current = featureId;
        map.setFeatureState({ source: 'countries', id: featureId }, { hover: true });
        map.getCanvas().style.cursor = 'pointer';
      });

      map.on('mouseleave', 'country-fill', () => {
        if (hoveredFeatureIdRef.current != null) {
          map.setFeatureState({ source: 'countries', id: hoveredFeatureIdRef.current }, { hover: false });
          hoveredFeatureIdRef.current = null;
        }
        map.getCanvas().style.cursor = '';
      });
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── map data updates ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady) return;
    const source = mapRef.current?.getSource('countries') as maplibregl.GeoJSONSource | undefined;
    source?.setData(countriesGeojson as any);
  }, [mapReady, countriesGeojson]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    const nextId = selectedIso2?.toUpperCase() || null;
    if (selectedFeatureIdRef.current && selectedFeatureIdRef.current !== nextId) {
      map.setFeatureState({ source: 'countries', id: selectedFeatureIdRef.current }, { selected: false });
    }
    if (nextId) map.setFeatureState({ source: 'countries', id: nextId }, { selected: true });
    selectedFeatureIdRef.current = nextId;
  }, [mapReady, selectedIso2]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    if (showPlaceMarkers) {
      entriesWithStatus.forEach(({ entry, status }) => {
        const lng = entry.lng ?? entry.lon;
        if (entry.lat == null || lng == null) return;
        const el = document.createElement('button');
        el.type = 'button';
        Object.assign(el.style, { width: '10px', height: '10px', borderRadius: '50%', border: '2px solid #ffffff', background: PLACE_STATUS_COLORS[status].fill, boxShadow: '0 0 0 1px rgba(0,0,0,0.15)', cursor: 'pointer', padding: '0' });
        el.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          const iso2 = getCountryCode(entry);
          if (iso2) setSelectedIso2(iso2.toUpperCase());
          setSelectedEntryId(entry.id);
          setMapClickPopup(null);
        });
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([Number(lng), Number(entry.lat)])
          .addTo(map);
        markersRef.current.push(marker);
      });
    }
    if (searchResult && searchResult.lat != null && searchResult.lon != null) {
      const el = document.createElement('div');
      Object.assign(el.style, { width: '12px', height: '12px', borderRadius: '50%', border: '2px solid #ffffff', background: '#ef4444', boxShadow: '0 0 0 1px rgba(0,0,0,0.2)' });
      if (!resultMarkerRef.current) {
        resultMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([searchResult.lon, searchResult.lat]).addTo(map);
      } else {
        resultMarkerRef.current.setLngLat([searchResult.lon, searchResult.lat]);
      }
    } else if (resultMarkerRef.current) {
      resultMarkerRef.current.remove(); resultMarkerRef.current = null;
    }
  }, [mapReady, entriesWithStatus, showPlaceMarkers, searchResult]);

  useEffect(() => {
    if (!mapReady || !searchResult || searchResult.lat == null || searchResult.lon == null) return;
    mapRef.current?.flyTo({ center: [searchResult.lon, searchResult.lat], zoom: searchResult.city ? 6 : 4, speed: 1.2 });
  }, [mapReady, searchResult]);

  useEffect(() => {
    if (!mapReady || !selectedEntryId) return;
    const entry = entries.find(e => e.id === selectedEntryId);
    const lng = entry?.lng ?? entry?.lon;
    if (!entry || entry.lat == null || lng == null) return;
    mapRef.current?.flyTo({ center: [Number(lng), Number(entry.lat)], zoom: entry.city ? 6 : 4, speed: 1.2 });
  }, [mapReady, selectedEntryId, entries]);

  // ─── render helpers ───────────────────────────────────────────────────────────
  const renderCountryDetail = () => {
    if (!selectedIso2) return null;
    const countryEntry = entriesForSelectedCountry.find(e => !e.city);
    const detailEntry = selectedEntryId
      ? (entries.find(e => e.id === selectedEntryId) || countryEntry)
      : countryEntry;

    return (
      <div style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: 320, background: 'rgba(255,255,255,0.97)', boxShadow: '-2px 0 12px rgba(0,0,0,0.12)', overflowY: 'auto', zIndex: 20, display: 'flex', flexDirection: 'column' }}>
        {/* header */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f9fafb', flexShrink: 0 }}>
          <div>
            <strong style={{ fontSize: 15 }}>{isoCountries.getName(selectedIso2, 'en') || selectedIso2}</strong>
            <Badge bg="light" text="dark" className="ms-2" style={{ fontSize: 11 }}>{selectedIso2}</Badge>
          </div>
          <Button size="sm" variant="outline-secondary" onClick={() => { setSelectedIso2(null); setSelectedEntryId(null); setSelectedStoryId(null); setManualGoalId(''); setNewCityForSelected(''); }}>
            ✕
          </Button>
        </div>

        {/* detail entry */}
        {detailEntry && (() => {
          const sid = getEntryStoryId(detailEntry);
          const story = sid ? storiesById.get(sid) : undefined;
          const status = normalizePlaceStatus(detailEntry, story || null);
          const statusColor = PLACE_STATUS_COLORS[status].fill;
          const statusTextColor = status === 'BUCKET_LIST' ? '#111827' : '#ffffff';
          return (
            <div style={{ padding: '12px 16px', flex: 1, overflow: 'auto' }}>
              <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
                <Badge style={{ backgroundColor: statusColor, color: statusTextColor }}>{PLACE_STATUS_LABELS[status]}</Badge>
                <span className="text-muted small">Type: {getPlaceType(detailEntry)}</span>
              </div>

              {/* story card */}
              {sid && story && (
                <div className="p-2 mb-3 rounded border" style={{ background: '#f9fafb', fontSize: 13 }}>
                  <div className="d-flex justify-content-between align-items-start mb-1">
                    <div>
                      <div className="fw-semibold">{detailEntry.storyTitleSnapshot || story.title || 'Untitled'}</div>
                      <div className="text-muted" style={{ fontSize: 11 }}>Story {detailEntry.storyNumber || story.referenceNumber || story.ref || sid}</div>
                    </div>
                    <Badge bg={story.status === 0 ? 'secondary' : story.status === 4 ? 'success' : 'primary'} style={{ fontSize: 10 }}>
                      {story.status === 0 ? 'Todo' : story.status === 4 ? 'Done' : `#${story.status}`}
                    </Badge>
                  </div>
                  {story.dueDate && <div className="text-muted" style={{ fontSize: 11 }}>Due: {typeof story.dueDate === 'number' ? new Date(story.dueDate).toLocaleDateString() : story.dueDate}</div>}
                  <Button size="sm" variant="link" style={{ padding: '2px 0', fontSize: 12 }} onClick={() => window.open(`/sprints/kanban?highlightStory=${sid}`, '_blank')}>Edit in Kanban →</Button>
                </div>
              )}

              {/* linked goal card */}
              {detailEntry.goalId && (() => {
                const linkedGoal = goals.find(g => g.id === detailEntry.goalId);
                return (
                  <div className="p-2 mb-3 rounded border" style={{ background: '#f9fafb', fontSize: 13 }}>
                    <div className="fw-semibold mb-1" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280' }}>Goal</div>
                    <div className="mb-1">{linkedGoal?.title || detailEntry.goalTitleSnapshot || 'Unknown goal'}</div>
                    {linkedGoal && <Button size="sm" variant="link" style={{ padding: '2px 0', fontSize: 12 }} onClick={() => window.open(`/goals?highlightGoal=${linkedGoal.id}`, '_blank')}>View Goal →</Button>}
                  </div>
                );
              })()}

              {/* actions */}
              <div className="d-flex flex-wrap gap-2 mb-3">
                <Button size="sm" variant="outline-warning" onClick={() => flagBucketList(detailEntry)}>Bucket List</Button>
                <Button size="sm" variant="outline-primary" onClick={() => createStoryForEntry(detailEntry)} disabled={!!sid}>Create Story</Button>
                <Button size="sm" variant="outline-success" onClick={() => markPlaceCompleted(detailEntry)}>Complete</Button>
                <Button size="sm" variant="outline-secondary" onClick={() => resetPlaceStatus(detailEntry)}>Reset</Button>
                {!detailEntry.lat && <Button size="sm" variant="outline-secondary" onClick={() => geocodeEntry(detailEntry)}>Geocode</Button>}
              </div>

              {/* manual goal match */}
              <div className="d-flex gap-2 mb-3">
                <Form.Select size="sm" value={manualGoalId} onChange={e => setManualGoalId(e.target.value)} style={{ flex: 1 }}>
                  <option value="">Match goal (manual)</option>
                  {travelGoals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
                </Form.Select>
                <Button size="sm" variant="outline-secondary" onClick={() => applyManualGoalMatch(detailEntry)} disabled={!manualGoalId}>Link</Button>
              </div>

              {/* cities */}
              <div>
                <div className="fw-semibold small mb-2">Cities &amp; Places</div>
                <div className="d-flex gap-2 mb-2">
                  <Form.Control size="sm" placeholder="Add city" value={newCityForSelected} onChange={e => setNewCityForSelected(e.target.value)} />
                  <Button size="sm" onClick={addCityToSelected} disabled={!newCityForSelected.trim()}>Add</Button>
                </div>
                {entriesForSelectedCountry.filter(e => e.city).map(cityEntry => {
                  const cSid = getEntryStoryId(cityEntry);
                  const cStory = cSid ? storiesById.get(cSid) : undefined;
                  const cStatus = normalizePlaceStatus(cityEntry, cStory || null);
                  return (
                    <div key={cityEntry.id} className={`d-flex align-items-center justify-content-between p-2 mb-1 bg-white rounded border ${selectedEntryId === cityEntry.id ? 'border-primary' : ''}`} style={{ cursor: 'pointer', fontSize: 13 }} onClick={() => { setSelectedEntryId(cityEntry.id); setManualGoalId(cityEntry.goalId || ''); }}>
                      <div>
                        <strong>{cityEntry.city}</strong>
                        <Badge style={{ backgroundColor: PLACE_STATUS_COLORS[cStatus].fill, color: cStatus === 'BUCKET_LIST' ? '#111827' : '#ffffff', marginLeft: 6, fontSize: 10 }}>{PLACE_STATUS_LABELS[cStatus]}</Badge>
                        {cityEntry.plannedVisitAt && <Badge bg="warning" text="dark" className="ms-1" style={{ fontSize: 10 }}>Planned {formatPlannedDate(cityEntry.plannedVisitAt)}</Badge>}
                      </div>
                      <div className="d-flex gap-1">
                        <Button size="sm" variant="outline-primary" onClick={e => { e.stopPropagation(); createStoryForEntry(cityEntry); }} disabled={!!cSid} style={{ padding: '1px 6px', fontSize: 11 }}>Story</Button>
                        <Button size="sm" variant="outline-success" onClick={e => { e.stopPropagation(); markPlaceCompleted(cityEntry); }} style={{ padding: '1px 6px', fontSize: 11 }}>Done</Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>
    );
  };

  // ─── main render ──────────────────────────────────────────────────────────────
  return (
    <DndContext
      sensors={sensors}
      onDragStart={() => { setIsDraggingGoal(true); setDragFeedback(null); setPendingDuplicateLink(null); }}
      onDragCancel={() => { setIsDraggingGoal(false); mouseCoordsDuringDragRef.current = null; setPendingDuplicateLink(null); }}
      onDragEnd={(e) => { void handleDragEnd(e); }}
    >
      {/* ── full-screen map ── */}
      <div
        ref={setMapDropZoneNode}
        onMouseMove={e => { if (isDraggingGoal) mouseCoordsDuringDragRef.current = { x: e.clientX, y: e.clientY }; }}
        onClick={() => setMapClickPopup(null)}
        style={{ position: 'relative', height: 'calc(100vh - 56px)', background: '#f1f5f9', overflow: 'hidden' }}
      >
        {/* map canvas */}
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} onClick={e => e.stopPropagation()} />

        {/* loading overlay */}
        {loading && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30 }}>
            <span className="text-muted small">Loading travel data…</span>
          </div>
        )}

        {/* floating search toolbar */}
        <div
          style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 10, display: 'flex', gap: 6, background: 'rgba(255,255,255,0.96)', borderRadius: 8, padding: '6px 10px', boxShadow: '0 2px 10px rgba(0,0,0,0.14)', maxWidth: 500, width: 'calc(100% - 160px)' }}
          onClick={e => e.stopPropagation()}
        >
          <Form.Control size="sm" placeholder="Search a place…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void runGeocode(); }} />
          <Button size="sm" onClick={runGeocode} disabled={searching || !searchQuery.trim()}>{searching ? '…' : 'Search'}</Button>
          {searchResult && (
            <>
              <Form.Select size="sm" value={newStatus} onChange={e => setNewStatus(e.target.value as PlaceStatus)} style={{ width: 120 }}>
                <option value="BUCKET_LIST">Bucket List</option>
                <option value="COMPLETED">Visited</option>
                <option value="UNVISITED">Unvisited</option>
              </Form.Select>
              <Button size="sm" variant="outline-success" onClick={addGeocodeAsPlace} disabled={!searchResult}>Add</Button>
              <Button size="sm" variant="outline-primary" onClick={() => void createStoryFromGeocode(searchResult!)}>Story</Button>
            </>
          )}
        </div>

        {/* auto-link toast */}
        {autoLinkToast && (
          <div style={{ position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 15, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, padding: '6px 14px', fontSize: 13, color: '#166534', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', whiteSpace: 'nowrap' }}>
            {autoLinkToast}
          </div>
        )}

        {/* drag feedback */}
        {dragFeedback && (
          <div
            style={{ position: 'absolute', top: 60, right: selectedIso2 ? 330 : 8, zIndex: 15, maxWidth: 300, background: dragFeedback.type === 'success' ? '#f0fdf4' : '#fef2f2', border: `1px solid ${dragFeedback.type === 'success' ? '#86efac' : '#fecaca'}`, color: dragFeedback.type === 'success' ? '#166534' : '#991b1b', borderRadius: 6, padding: '8px 12px', fontSize: 13, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
            onClick={e => e.stopPropagation()}
          >
            {dragFeedback.text}
            {pendingDuplicateLink && (
              <div className="mt-2 d-flex gap-2">
                <Button size="sm" variant="outline-secondary" onClick={() => void linkDuplicateEntryToGoal()} disabled={isLinkingDuplicate}>{isLinkingDuplicate ? 'Linking…' : 'Link to goal'}</Button>
                <Button size="sm" variant="outline-secondary" onClick={() => setPendingDuplicateLink(null)} disabled={isLinkingDuplicate}>Dismiss</Button>
              </div>
            )}
          </div>
        )}

        {/* drag overlay */}
        {isDraggingOverMap && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(16, 185, 129, 0.08)', border: '2px dashed #10b981', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#047857', fontWeight: 700, pointerEvents: 'none', zIndex: 5 }}>
            Drop to create travel entry
          </div>
        )}

        {/* legend — bottom-left */}
        <div style={{ position: 'absolute', bottom: 32, left: 48, zIndex: 10, background: 'rgba(255,255,255,0.92)', borderRadius: 6, padding: '6px 10px', display: 'flex', gap: 12, fontSize: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }} onClick={e => e.stopPropagation()}>
          {(Object.keys(PLACE_STATUS_COLORS) as PlaceStatus[]).map(s => (
            <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 10, height: 10, background: PLACE_STATUS_COLORS[s].fill, display: 'inline-block', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 2 }} />
              {PLACE_STATUS_LABELS[s]}
            </span>
          ))}
        </div>

        {/* stats — bottom-center */}
        <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 10, background: 'rgba(255,255,255,0.92)', borderRadius: 6, padding: '4px 12px', display: 'flex', gap: 16, fontSize: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.1)', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
          <span><strong>{bucketListMetrics.percent}%</strong> complete</span>
          <span>Bucket list: {bucketListMetrics.counts.bucketList}</span>
          <span>Stories: {bucketListMetrics.counts.storyCreated}</span>
          <span>Visited: {bucketListMetrics.counts.completed}</span>
        </div>

        {/* toolbar — bottom-right */}
        <div style={{ position: 'absolute', bottom: 8, right: selectedIso2 ? 330 : 8, zIndex: 10, display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
          <Form.Check type="checkbox" id="markers-toggle-v2" label="Markers" checked={showPlaceMarkers} onChange={e => setShowPlaceMarkers(e.target.checked)} style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 4, padding: '3px 8px', fontSize: 12 }} />
          <Button size="sm" variant="light" style={{ fontSize: 12, padding: '2px 10px' }} onClick={openAccessibilityPicker} title="Keyboard-friendly destination picker (Alt+D)">Alt+D</Button>
          <Button size="sm" variant="light" style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => fileInputRef.current?.click()} disabled={importing}>{importing ? 'Importing…' : 'Import'}</Button>
          <input ref={fileInputRef} type="file" accept=".json,.csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) importTravelEntries(f); }} />
        </div>

        {/* import status */}
        {importStatus && (
          <div style={{ position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 15, background: importStatus.errors.length > 0 ? '#fef2f2' : '#f0fdf4', border: `1px solid ${importStatus.errors.length > 0 ? '#fecaca' : '#86efac'}`, borderRadius: 6, padding: '8px 14px', fontSize: 12, color: importStatus.errors.length > 0 ? '#991b1b' : '#166534', maxWidth: 400, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }} onClick={e => e.stopPropagation()}>
            Imported {importStatus.success} entries{importStatus.errors.length > 0 ? ` · ${importStatus.errors.length} error(s)` : ''}
            <Button size="sm" variant="link" style={{ fontSize: 11, padding: '0 4px' }} onClick={() => setImportStatus(null)}>✕</Button>
          </div>
        )}

        {/* map click popup */}
        {mapClickPopup && (
          <div onClick={e => e.stopPropagation()}>
            <MapClickPopup
              info={mapClickPopup}
              onMarkVisited={() => void handleMapClickVisited()}
              onBucketList={() => void handleMapClickBucketList()}
              onCreateStory={() => void handleMapClickCreateStory()}
              onClose={() => setMapClickPopup(null)}
            />
          </div>
        )}

        {/* goal list panel (fixed-positioned itself) */}
        <GoalListPanel
          goals={goals}
          travelGoals={travelGoals}
          expanded={goalListExpanded}
          onToggleExpanded={setGoalListExpanded}
          showTravelGoalsOnly={false}
          onToggleTravelGoalsOnly={() => {}}
          linkedEntriesByGoalId={linkedEntriesByGoalId}
        />

        {/* country detail side panel */}
        {renderCountryDetail()}
      </div>

      {/* ── below-fold: toggle button ── */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'center', gap: 16, background: '#f9fafb' }}>
        <Button size="sm" variant={showBelowFold ? 'secondary' : 'outline-secondary'} onClick={() => setShowBelowFold(v => !v)}>
          {showBelowFold ? '▲ Hide Details' : '▼ Show Places & Goals'}
        </Button>
      </div>

      {/* ── below-fold content ── */}
      {showBelowFold && (
        <div style={{ padding: '0 16px 24px' }}>
          {/* continent progress */}
          <div className="row mb-4 mt-3">
            <div className="col-md-5">
              <h6 className="mb-3">Progress by Continent</h6>
              <div className="d-flex flex-column gap-2">
                {CONTINENTS.map(c => {
                  const t = totalsByContinent[c] || { completed: 0, total: 0 };
                  const pct = t.total > 0 ? Math.round((t.completed / t.total) * 100) : 0;
                  return (
                    <div key={c}>
                      <div className="d-flex justify-content-between small mb-1"><strong>{c}</strong><span>{t.completed}/{t.total} · {pct}%</span></div>
                      <ProgressBar now={pct} variant="info" style={{ height: 6 }} />
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="col-md-7">
              <h6 className="mb-3">All Places</h6>
              <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid #f3f4f6', borderRadius: 8, padding: 8 }}>
                {entries.length === 0 && <div className="text-muted small">No locations yet. Click anywhere on the map to add one.</div>}
                {entries.map(e => {
                  const sid = getEntryStoryId(e);
                  const story = sid ? storiesById.get(sid) : undefined;
                  const status = normalizePlaceStatus(e, story || null);
                  return (
                    <div key={e.id} className="d-flex align-items-center justify-content-between py-1" style={{ borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                      <div>
                        <strong>{getCountryCode(e)}</strong>{e.city ? ` · ${e.city}` : ''}
                        <Badge style={{ backgroundColor: PLACE_STATUS_COLORS[status].fill, color: status === 'BUCKET_LIST' ? '#111827' : '#ffffff', marginLeft: 6, fontSize: 10 }}>{PLACE_STATUS_LABELS[status]}</Badge>
                        {e.plannedVisitAt && <Badge bg="warning" text="dark" className="ms-1" style={{ fontSize: 10 }}>Planned {formatPlannedDate(e.plannedVisitAt)}</Badge>}
                        {e.goalTitleSnapshot && <span className="text-muted ms-1" style={{ fontSize: 11 }}>· {e.goalTitleSnapshot}</span>}
                      </div>
                      <div className="d-flex gap-1">
                        <Button size="sm" variant="outline-warning" onClick={() => flagBucketList(e)} style={{ padding: '1px 6px', fontSize: 11 }}>List</Button>
                        <Button size="sm" variant="outline-primary" onClick={() => createStoryForEntry(e)} disabled={!!sid} style={{ padding: '1px 6px', fontSize: 11 }}>Story</Button>
                        <Button size="sm" variant="outline-success" onClick={() => markPlaceCompleted(e)} style={{ padding: '1px 6px', fontSize: 11 }}>Done</Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* travel goals */}
          <div className="d-flex align-items-center justify-content-between mb-2">
            <h6 className="mb-0">Travel Goals</h6>
            <Form.Check type="switch" id="travel-goals-only-v2" label="Travel goals only" checked={travelGoalsOnly} onChange={e => setTravelGoalsOnly(e.target.checked)} />
          </div>
          <ModernGoalsTable
            goals={travelGoalsForTable}
            onGoalUpdate={handleGoalUpdate}
            onGoalDelete={handleGoalDelete}
            onGoalPriorityChange={handleGoalPriorityChange}
            highlightStoryId={selectedStoryId || undefined}
            highlightGoalId={highlightGoalId || undefined}
          />
        </div>
      )}

      {/* ── accessibility picker modal ── */}
      <Modal show={showAccessibilityPicker} onHide={() => setShowAccessibilityPicker(false)} centered>
        <Modal.Header closeButton><Modal.Title>Keyboard Add Travel Entry</Modal.Title></Modal.Header>
        <Modal.Body>
          <div className="small text-muted mb-3">Add a destination without using the map. Shortcut: Alt+D.</div>
          {accessibilityError && <div className="alert alert-danger py-2 small mb-3">{accessibilityError}</div>}
          <Form.Group className="mb-3">
            <Form.Label>Travel Goal</Form.Label>
            <Form.Select value={accessibilityGoalId} onChange={e => setAccessibilityGoalId(e.target.value)}>
              <option value="">Select a travel goal</option>
              {travelGoals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
            </Form.Select>
          </Form.Group>
          <Form.Group>
            <Form.Label>Destination</Form.Label>
            <Form.Control value={accessibilityLocationQuery} placeholder="Paris, France" onChange={e => setAccessibilityLocationQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void handleAccessibilityPickerSubmit(); }} />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowAccessibilityPicker(false)} disabled={accessibilitySubmitting}>Cancel</Button>
          <Button variant="primary" onClick={() => void handleAccessibilityPickerSubmit()} disabled={accessibilitySubmitting || !accessibilityGoalId || !accessibilityLocationQuery.trim()}>
            {accessibilitySubmitting ? 'Creating…' : 'Create Entry'}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* ── prompt modal (replaces window.prompt) ── */}
      <PromptModal
        show={promptState.show}
        title="New Travel Goal"
        label={promptState.label}
        placeholder={promptState.placeholder}
        value={promptValue}
        onChange={setPromptValue}
        onConfirm={handlePromptConfirm}
        onCancel={handlePromptCancel}
      />

      {/* ── confirm dialog (replaces window.confirm) ── */}
      <ConfirmDialog
        show={confirmState.show}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        cancelText="Cancel"
        variant="primary"
        onConfirm={handleConfirmYes}
        onCancel={handleConfirmNo}
      />
    </DndContext>
  );
};

export default TravelMapV2;
