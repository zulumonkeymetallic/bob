import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Row, Col, Button, Form, Badge, ProgressBar } from 'react-bootstrap';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, getDocs, deleteDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
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
import { feature as topojsonFeature } from 'topojson-client';
isoCountries.registerLocale(enLocale as any);

type PlaceStatus = 'UNVISITED' | 'BUCKET_LIST' | 'STORY_CREATED' | 'COMPLETED';
type PlaceType = 'continent' | 'country' | 'region' | 'city';
type GoalMatchCandidate = Pick<Goal, 'id' | 'title' | 'theme' | 'description' | 'tags'>;
type TravelGoalMatchResponse = {
  matchedGoalId?: string | null;
  confidence?: number;
  rationale?: string;
  suggestNewGoalTitle?: string | null;
  promptVersion?: string;
};

interface TravelEntry {
  id: string;
  placeType?: PlaceType;
  name?: string;
  countryCode?: string;
  // Legacy fields kept for compatibility with existing data
  country_code?: string; // ISO alpha-2/3
  city?: string;
  visited?: boolean;
  visitedAt?: any;
  linked_story_id?: string;
  continent?: string;
  ownerUid: string;
  status?: PlaceStatus | string;
  goalId?: string | null;
  goalTitleSnapshot?: string | null;
  storyId?: string | null;
  storyNumber?: string | null;
  storyTitleSnapshot?: string | null;
  bucketListFlaggedAt?: any;
  storyCreatedAt?: any;
  completedAt?: any;
  lastMatchedAt?: any;
  matchConfidence?: number | null;
  matchMethod?: 'heuristic' | 'llm' | 'manual' | null;
  // optional geo metadata if known
  lat?: number;
  lon?: number;
  lng?: number;
  locationName?: string;
  plannedVisitAt?: number | null;
  createdAt?: any;
  updatedAt?: any;
}

const CONTINENTS = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Antarctica'];
const GEO_DATA: any = worldCountries as any;
const TRAVEL_THEME_ID = 7;
const LLM_MATCH_CONFIRM_THRESHOLD = 0.6;
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
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
    },
  ],
};
const PLACE_STATUS_LABELS: Record<PlaceStatus, string> = {
  UNVISITED: 'Unvisited',
  BUCKET_LIST: 'Bucket List',
  STORY_CREATED: 'Story Created',
  COMPLETED: 'Completed',
};
const PLACE_STATUS_PRIORITY: Record<PlaceStatus, number> = {
  UNVISITED: 0,
  BUCKET_LIST: 1,
  STORY_CREATED: 2,
  COMPLETED: 3,
};
const PLACE_STATUS_COLORS: Record<PlaceStatus, { fill: string; hover: string; pressed: string }> = {
  UNVISITED: { fill: '#111827', hover: '#1f2937', pressed: '#0f172a' },
  BUCKET_LIST: { fill: '#facc15', hover: '#eab308', pressed: '#ca8a04' },
  STORY_CREATED: { fill: '#16a34a', hover: '#15803d', pressed: '#166534' },
  COMPLETED: { fill: '#2563eb', hover: '#1d4ed8', pressed: '#1e40af' },
};

const TravelMap: React.FC = () => {
  const { currentUser } = useAuth();
  const [entries, setEntries] = useState<TravelEntry[]>([]);
  const [newCountry, setNewCountry] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newStatus, setNewStatus] = useState<PlaceStatus>('BUCKET_LIST');
  const [continent, setContinent] = useState('Europe');
  const [saving, setSaving] = useState(false);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<GeocodeResult | null>(null);
  const [showPlaceMarkers, setShowPlaceMarkers] = useState(true);
  const [selectedIso2, setSelectedIso2] = useState<string | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [newCityForSelected, setNewCityForSelected] = useState('');
  const [manualGoalId, setManualGoalId] = useState('');
  const [travelGoalsOnly, setTravelGoalsOnly] = useState(true);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const resultMarkerRef = useRef<maplibregl.Marker | null>(null);
  const hoveredFeatureIdRef = useRef<string | number | null>(null);
  const selectedFeatureIdRef = useRef<string | number | null>(null);
  const handleCountryClickRef = useRef<(iso2: string) => void>(() => {});
  const countriesGeojsonRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  const derivePlannedVisitAt = (goal?: Goal | null): number | null => {
    if (!goal) return null;
    if (typeof goal.endDate === 'number' && Number.isFinite(goal.endDate)) return goal.endDate;
    if (typeof goal.dueDate === 'number' && Number.isFinite(goal.dueDate)) return goal.dueDate;
    if (goal.targetDate) {
      const parsed = Date.parse(goal.targetDate);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return null;
  };

  const formatPlannedDate = (timestamp?: number | null): string => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleDateString();
  };

  const toDateInputValue = (timestamp?: number | null): string => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getCountryCode = (entry: TravelEntry): string => (entry.countryCode || entry.country_code || '').toUpperCase();

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

  const isStoryDone = (story?: Story | null): boolean => {
    if (!story) return false;
    if (typeof story.status === 'number') return story.status >= 4;
    const raw = String(story.status || '').trim().toLowerCase();
    return ['done', 'complete', 'completed', 'closed', 'finished'].includes(raw);
  };

  const parsePlaceStatus = (raw?: unknown): PlaceStatus | null => {
    if (!raw) return null;
    const v = String(raw).trim().toUpperCase();
    if (v === 'UNVISITED') return 'UNVISITED';
    if (v === 'BUCKET_LIST' || v === 'BUCKET-LIST') return 'BUCKET_LIST';
    if (v === 'STORY_CREATED' || v === 'STORY-CREATED') return 'STORY_CREATED';
    if (v === 'COMPLETED' || v === 'COMPLETE') return 'COMPLETED';
    return null;
  };

  const getEntryStoryId = (entry: TravelEntry): string | null => {
    return entry.storyId || entry.linked_story_id || null;
  };

  const normalizePlaceStatus = (entry: TravelEntry, story?: Story | null): PlaceStatus => {
    const explicit = parsePlaceStatus(entry.status);
    if (explicit) return explicit;
    if (entry.bucketListFlaggedAt) return 'BUCKET_LIST';
    if (getEntryStoryId(entry)) {
      return isStoryDone(story) ? 'COMPLETED' : 'STORY_CREATED';
    }
    if (entry.visited) return 'COMPLETED';
    return 'UNVISITED';
  };

  const isTravelGoal = (goal: Goal): boolean => {
    if (goal.theme === TRAVEL_THEME_ID) return true;
    const tags = (goal.tags || []).map((t) => t.toLowerCase());
    return tags.includes('travel');
  };

  const buildPlaceHierarchy = (entry: TravelEntry) => {
    const countryCode = getCountryCode(entry);
    const countryName = countryCode ? (isoCountries.getName(countryCode, 'en') || countryCode) : '';
    const continentName = entry.continent || (countryCode ? continentForIso2(countryCode) : '') || '';
    const cityName = entry.city || '';
    return { cityName, countryName, continentName };
  };

  const findHeuristicGoalMatch = (entry: TravelEntry): { goal: GoalMatchCandidate | null; confidence: number } => {
    const { cityName, countryName, continentName } = buildPlaceHierarchy(entry);
    const tokens = [
      { value: cityName, weight: 0.9 },
      { value: countryName, weight: 0.7 },
      { value: continentName, weight: 0.5 },
    ].filter((t) => t.value);

    let bestGoal: GoalMatchCandidate | null = null;
    let bestScore = 0;
    travelGoals.forEach((goal) => {
      const hay = `${goal.title || ''} ${goal.description || ''}`.toLowerCase();
      let score = 0;
      tokens.forEach(({ value, weight }) => {
        if (value && hay.includes(value.toLowerCase())) {
          score = Math.max(score, weight);
        }
      });
      if (score > bestScore) {
        bestScore = score;
        bestGoal = goal;
      }
    });

    return { goal: bestGoal, confidence: bestScore };
  };

  const callTravelGoalMatcher = async (entry: TravelEntry): Promise<TravelGoalMatchResponse> => {
    if (!currentUser?.uid || !travelGoals.length) {
      return { matchedGoalId: null, confidence: 0 };
    }
    try {
      const hierarchy = buildPlaceHierarchy(entry);
      const placePayload = {
        name: getPlaceName(entry),
        type: getPlaceType(entry),
        hierarchy: {
          city: hierarchy.cityName || null,
          country: hierarchy.countryName || null,
          continent: hierarchy.continentName || null,
        },
        notes: entry.locationName || null,
      };
      const goalsPayload = travelGoals.slice(0, 40).map((goal) => ({
        goalId: goal.id,
        title: goal.title,
        description: goal.description || '',
        tags: goal.tags || [],
        theme: goal.theme,
      }));

      const callable = httpsCallable(functions, 'matchTravelGoal');
      const response = await callable({ place: placePayload, goals: goalsPayload, placeId: entry.id || null });
      const data = response.data as TravelGoalMatchResponse;
      const confidenceRaw = Number(data?.confidence ?? 0);
      const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0;
      return {
        matchedGoalId: data?.matchedGoalId ?? null,
        confidence,
        rationale: data?.rationale,
        suggestNewGoalTitle: data?.suggestNewGoalTitle ?? null,
        promptVersion: data?.promptVersion,
      };
    } catch (error) {
      console.warn('[travel] goal match failed', error);
      return { matchedGoalId: null, confidence: 0 };
    }
  };

  const createTravelGoal = async (suggestedTitle?: string): Promise<GoalMatchCandidate | null> => {
    if (!currentUser?.uid) return null;
    const name = suggestedTitle || window.prompt('New travel goal name');
    if (!name) return null;
    const now = serverTimestamp();
    const created = await addDoc(collection(db, 'goals'), {
      persona: 'personal',
      title: name,
      description: 'Trip goal created from Travel Map',
      theme: TRAVEL_THEME_ID,
      size: 2,
      timeToMasterHours: 0,
      confidence: 2,
      status: 0,
      ownerUid: currentUser.uid,
      createdAt: now,
      updatedAt: now,
    });
    return { id: created.id, title: name, theme: TRAVEL_THEME_ID };
  };

  const resolveGoalMatch = async (
    entry: TravelEntry,
    opts: { confirm?: boolean; allowCreate?: boolean } = {}
  ): Promise<{ goal: GoalMatchCandidate | null; confidence: number; method: 'heuristic' | 'manual' | 'llm' | null }> => {
    const existingGoalId = entry.goalId;
    if (existingGoalId) {
      const existingGoal = goals.find((goal) => goal.id === existingGoalId);
      if (existingGoal) {
        return {
          goal: existingGoal,
          confidence: entry.matchConfidence ?? 1,
          method: entry.matchMethod ?? 'manual',
        };
      }
    }

    const heuristic = findHeuristicGoalMatch(entry);
    if (heuristic.goal && heuristic.confidence >= 0.4) {
      const shouldUse = opts.confirm
        ? window.confirm(`Match found: "${heuristic.goal.title}". Use it?`)
        : true;
      if (shouldUse) {
        return { goal: heuristic.goal, confidence: heuristic.confidence, method: 'heuristic' };
      }
    }

    const llmMatch = await callTravelGoalMatcher(entry);
    let llmSuggestedTitle = llmMatch.suggestNewGoalTitle || null;
    if (llmMatch.matchedGoalId) {
      const llmGoal = goals.find((goal) => goal.id === llmMatch.matchedGoalId);
      if (llmGoal) {
        const confidence = Math.max(0, Math.min(1, Number(llmMatch.confidence || 0)));
        const requiresConfirm = opts.confirm || confidence < LLM_MATCH_CONFIRM_THRESHOLD;
        const shouldUse = requiresConfirm
          ? window.confirm(`Match found: "${llmGoal.title}" (${Math.round(confidence * 100)}%). Use it?`)
          : true;
        if (shouldUse) {
          return { goal: llmGoal, confidence, method: 'llm' };
        }
      }
    }

    if (opts.allowCreate) {
      if (!llmSuggestedTitle) {
        llmSuggestedTitle = entry.city ? `Trip to ${entry.city}` : `Trip to ${getPlaceName(entry)}`;
      }
      const promptCreate = window.confirm('No matching travel goal found. Create a new goal for this place?');
      if (promptCreate) {
        const createdGoal = await createTravelGoal(llmSuggestedTitle);
        if (createdGoal) {
          return { goal: createdGoal, confidence: 1, method: 'manual' };
        }
      }
    }

    return { goal: null, confidence: 0, method: null };
  };

  useEffect(() => {
    if (!currentUser?.uid) return;
    console.log('🗺️ TravelMap: subscribing to travel entries', { uid: currentUser.uid });
    const q = query(collection(db, 'travel'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as TravelEntry[];
      console.log('🗺️ TravelMap: received travel entries', { count: data.length, sample: data[0] });
      setEntries(data);
    }, (err) => {
      console.error('❌ TravelMap: error reading entries', err);
    });
    return () => unsub();
  }, [currentUser?.uid]);

  // Subscribe to user's goals (for Trip selection)
  useEffect(() => {
    if (!currentUser?.uid) return;
    const gq = query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(gq, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Goal[];
      setGoals(data);
    });
    return () => unsub();
  }, [currentUser?.uid]);

  // Subscribe to stories to compute Trip overlays
  useEffect(() => {
    if (!currentUser?.uid) return;
    const sq = query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(sq, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Story[];
      setStories(data);
    });
    return () => unsub();
  }, [currentUser?.uid]);

  const storiesById = useMemo(() => {
    const map = new Map<string, Story>();
    stories.forEach((story) => map.set(story.id, story));
    return map;
  }, [stories]);

  const travelGoals = useMemo(() => goals.filter(isTravelGoal), [goals]);

  const travelGoalsForTable = useMemo(() => {
    return travelGoalsOnly ? travelGoals : goals;
  }, [travelGoalsOnly, travelGoals, goals]);

  const entriesWithStatus = useMemo(() => {
    return entries.map((entry) => {
      const storyId = getEntryStoryId(entry);
      const story = storyId ? storiesById.get(storyId) : undefined;
      return {
        entry,
        status: normalizePlaceStatus(entry, story || null),
      };
    });
  }, [entries, storiesById]);

  const statusByCountry = useMemo(() => {
    const map = new Map<string, PlaceStatus>();
    entriesWithStatus.forEach(({ entry, status }) => {
      const code = getCountryCode(entry);
      if (!code) return;
      const existing = map.get(code);
      if (!existing || PLACE_STATUS_PRIORITY[status] > PLACE_STATUS_PRIORITY[existing]) {
        map.set(code, status);
      }
    });
    return map;
  }, [entriesWithStatus]);

  const countriesGeojson = useMemo(() => {
    const geo = topojsonFeature(GEO_DATA as any, GEO_DATA.objects.countries as any) as any;
    const features = Array.isArray(geo?.features) ? geo.features : [];
    const mapped = features.map((featureItem: any) => {
      const rawId = featureItem?.id;
      const numeric = rawId ? String(rawId).padStart(3, '0') : '';
      const rawIso2 = isoCountries.numericToAlpha2 ? isoCountries.numericToAlpha2(numeric) : '';
      const iso2 = rawIso2 ? rawIso2.toUpperCase() : '';
      const isSupported = Boolean(iso2);
      const status = iso2 ? (statusByCountry.get(iso2) || 'UNVISITED') : 'UNVISITED';
      const featureId = iso2 || numeric || featureItem?.properties?.name || rawId;
      return {
        ...featureItem,
        id: featureId,
        properties: {
          ...(featureItem?.properties || {}),
          iso2,
          isSupported,
          status,
        },
      };
    });
    return {
      ...geo,
      features: mapped,
    };
  }, [statusByCountry]);

  const countryFillExpression = useMemo(() => ([
    'case',
    ['boolean', ['get', 'isSupported'], false],
    [
      'match',
      ['get', 'status'],
      'BUCKET_LIST', PLACE_STATUS_COLORS.BUCKET_LIST.fill,
      'STORY_CREATED', PLACE_STATUS_COLORS.STORY_CREATED.fill,
      'COMPLETED', PLACE_STATUS_COLORS.COMPLETED.fill,
      PLACE_STATUS_COLORS.UNVISITED.fill,
    ],
    '#e5e7eb',
  ]), []);

  useEffect(() => {
    countriesGeojsonRef.current = countriesGeojson;
  }, [countriesGeojson]);

  const bucketListMetrics = useMemo(() => {
    const counts = {
      bucketList: 0,
      storyCreated: 0,
      completed: 0,
      total: 0,
    };
    entriesWithStatus.forEach(({ status }) => {
      if (status === 'BUCKET_LIST') counts.bucketList += 1;
      if (status === 'STORY_CREATED') counts.storyCreated += 1;
      if (status === 'COMPLETED') counts.completed += 1;
    });
    counts.total = counts.bucketList + counts.storyCreated + counts.completed;
    const percent = counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;
    return { counts, percent };
  }, [entriesWithStatus]);

  const totalsByContinent = useMemo(() => {
    const totals: Record<string, { completed: number; total: number }> = {};
    CONTINENTS.forEach(c => totals[c] = { completed: 0, total: 0 });
    entriesWithStatus.forEach(({ entry, status }) => {
      const inferred = entry.continent || continentForIso2(getCountryCode(entry)) || 'Unknown';
      if (!totals[inferred]) totals[inferred] = { completed: 0, total: 0 };
      totals[inferred].total += 1;
      if (status === 'COMPLETED') totals[inferred].completed += 1;
    });
    return totals;
  }, [entriesWithStatus]);

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

  const addPlace = async () => {
    if (!currentUser?.uid || !newCountry.trim()) return;
    try {
      setSaving(true);
      const iso2 = newCountry.trim().toUpperCase();
      const detected = continentForIso2(iso2);
      const placeType: PlaceType = newCity.trim() ? 'city' : 'country';
      const name = newCity.trim() || (isoCountries.getName(iso2, 'en') || iso2);
      const draftEntry: TravelEntry = {
        id: '',
        placeType,
        name,
        countryCode: iso2,
        country_code: iso2,
        city: newCity.trim() || undefined,
        continent: detected !== 'Unknown' ? detected : continent,
        ownerUid: currentUser.uid,
        status: newStatus,
      };
      const match = newStatus === 'BUCKET_LIST'
        ? await resolveGoalMatch(draftEntry, { confirm: true, allowCreate: true })
        : { goal: null, confidence: 0, method: null };

      await addDoc(collection(db, 'travel'), {
        placeType,
        name,
        countryCode: iso2,
        country_code: iso2,
        city: newCity.trim() || null,
        status: newStatus,
        visited: newStatus === 'COMPLETED',
        visitedAt: newStatus === 'COMPLETED' ? serverTimestamp() : null,
        linked_story_id: null,
        storyId: null,
        continent: detected !== 'Unknown' ? detected : continent,
        ownerUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        plannedVisitAt: null,
        goalId: match.goal?.id || null,
        goalTitleSnapshot: match.goal?.title || null,
        lastMatchedAt: match.goal ? serverTimestamp() : null,
        matchConfidence: match.goal ? match.confidence : null,
        matchMethod: match.goal ? match.method : null,
        bucketListFlaggedAt: newStatus === 'BUCKET_LIST' ? serverTimestamp() : null,
        storyCreatedAt: newStatus === 'STORY_CREATED' ? serverTimestamp() : null,
        completedAt: newStatus === 'COMPLETED' ? serverTimestamp() : null,
      });
      setNewCountry('');
      setNewCity('');
    } finally {
      setSaving(false);
    }
  };

  // Create a Story for this location and link back
  const createStoryForEntry = async (entry: TravelEntry) => {
    if (!currentUser?.uid) return;
    if (getEntryStoryId(entry)) return;

    const match = await resolveGoalMatch(entry, { confirm: true, allowCreate: true });
    const goalDetails = match.goal ? goals.find((g) => g.id === match.goal?.id) : undefined;
    const plannedVisitAt = derivePlannedVisitAt(goalDetails);
    const countryCode = getCountryCode(entry);
    const title = `Visit ${entry.city ? entry.city + ', ' : ''}${countryCode || getPlaceName(entry)}`.trim();

    const storyPayload = {
      persona: 'personal' as const,
      title,
      description: `Travel log for ${title}.`,
      goalId: match.goal?.id || '',
      theme: goalDetails?.theme ?? match.goal?.theme ?? TRAVEL_THEME_ID,
      status: 0,
      priority: 2,
      points: 1,
      wipLimit: 3,
      tags: ['travel'],
      sprintId: undefined,
      orderIndex: 0,
      ownerUid: currentUser.uid,
      acceptanceCriteria: [] as string[],
      // location metadata
      countryCode: countryCode || undefined,
      city: entry.city,
      locationName: entry.locationName || getPlaceName(entry),
      locationLat: entry.lat,
      locationLon: entry.lng ?? entry.lon,
      dueDate: plannedVisitAt ?? null,
      metadata: {
        plannedVisitAt: plannedVisitAt ?? null,
      },
    } satisfies Omit<Story, 'id' | 'createdAt' | 'updatedAt' | 'ref'>;

    const existing = await getDocs(query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid)));
    const existingRefs = existing.docs.map(d => (d.data() as any).ref).filter(Boolean) as string[];
    const shortRef = generateRef('story', existingRefs);

    const storyRef = await addDoc(collection(db, 'stories'), {
      ...storyPayload,
      ref: shortRef,
      referenceNumber: shortRef,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    setSelectedStoryId(storyRef.id);

    await updateEntryStatus(entry, 'STORY_CREATED', {
      storyId: storyRef.id,
      linked_story_id: storyRef.id,
      storyNumber: shortRef,
      storyTitleSnapshot: title,
      goalId: match.goal?.id || null,
      goalTitleSnapshot: match.goal?.title || null,
      matchConfidence: match.goal ? match.confidence : null,
      matchMethod: match.goal ? match.method : null,
      lastMatchedAt: match.goal ? serverTimestamp() : null,
      plannedVisitAt: plannedVisitAt ?? null,
      storyCreatedAt: serverTimestamp(),
    });
  };

  // Create a story directly from a geocode result (without a travel entry yet)
  const createStoryFromGeocode = async (g: GeocodeResult) => {
    if (!currentUser?.uid) return;
    const iso2 = (g.countryCode || '').toUpperCase();
    const placeType: PlaceType = g.city ? 'city' : 'country';
    const name = g.city || g.displayName || iso2;
    const now = serverTimestamp();
    const entryData: Omit<TravelEntry, 'id'> = {
      placeType,
      name,
      countryCode: iso2,
      country_code: iso2,
      city: g.city || null,
      continent: continentForIso2(iso2),
      ownerUid: currentUser.uid,
      status: 'UNVISITED',
      lat: g.lat,
      lon: g.lon,
      lng: g.lon,
      locationName: g.displayName,
      createdAt: now,
      updatedAt: now,
      plannedVisitAt: null,
    };
    const docRef = await addDoc(collection(db, 'travel'), entryData);
    await createStoryForEntry({ id: docRef.id, ...(entryData as any) });
  };

  const runGeocode = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    const r = await geocodePlace(searchQuery.trim());
    setResult(r);
    setSearching(false);
  };

  const addGeocodeAsPlace = async () => {
    if (!currentUser?.uid || !result) return;
    setSaving(true);
    try {
      const iso2 = (result.countryCode || '').toUpperCase();
      const placeType: PlaceType = result.city ? 'city' : 'country';
      const name = result.city || result.displayName || iso2;
      const draftEntry: TravelEntry = {
        id: '',
        placeType,
        name,
        countryCode: iso2,
        country_code: iso2,
        city: result.city || undefined,
        continent: continentForIso2(result.countryCode) || continent,
        ownerUid: currentUser.uid,
        status: newStatus,
      };
      const match = newStatus === 'BUCKET_LIST'
        ? await resolveGoalMatch(draftEntry, { confirm: true, allowCreate: true })
        : { goal: null, confidence: 0, method: null };
      await addDoc(collection(db, 'travel'), {
        placeType,
        name,
        countryCode: iso2,
        country_code: iso2,
        city: result.city || null,
        status: newStatus,
        visited: newStatus === 'COMPLETED',
        visitedAt: newStatus === 'COMPLETED' ? serverTimestamp() : null,
        linked_story_id: null,
        storyId: null,
        continent: continentForIso2(result.countryCode) || continent,
        lat: result.lat,
        lon: result.lon,
        lng: result.lon,
        locationName: result.displayName,
        ownerUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        plannedVisitAt: null,
        goalId: match.goal?.id || null,
        goalTitleSnapshot: match.goal?.title || null,
        lastMatchedAt: match.goal ? serverTimestamp() : null,
        matchConfidence: match.goal ? match.confidence : null,
        matchMethod: match.goal ? match.method : null,
        bucketListFlaggedAt: newStatus === 'BUCKET_LIST' ? serverTimestamp() : null,
        storyCreatedAt: newStatus === 'STORY_CREATED' ? serverTimestamp() : null,
        completedAt: newStatus === 'COMPLETED' ? serverTimestamp() : null,
      });
    } finally {
      setSaving(false);
    }
  };

  const createTripGoal = async () => {
    const created = await createTravelGoal();
    if (created?.id) setManualGoalId(created.id);
  };

  const handleGoalUpdate = async (goalId: string, updates: Partial<Goal>) => {
    await updateDoc(doc(db, 'goals', goalId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  };

  const handleGoalDelete = async (goalId: string) => {
    await deleteDoc(doc(db, 'goals', goalId));
  };

  const handleGoalPriorityChange = async (goalId: string, newPriority: number) => {
    await updateDoc(doc(db, 'goals', goalId), {
      orderIndex: newPriority,
      updatedAt: serverTimestamp(),
    });
  };

  const handleCountryClick = async (iso2: string) => {
    if (!currentUser?.uid) return;
    const isoUpper = iso2.toUpperCase();
    setSelectedIso2(isoUpper);
    setNewCityForSelected('');
    setSelectedEntryId(null);
    setManualGoalId('');
    const existing = entries.find(e => getCountryCode(e) === isoUpper && !e.city);
    if (existing) {
      setSelectedEntryId(existing.id);
      return;
    }
    const now = serverTimestamp();
    const countryName = isoCountries.getName(isoUpper, 'en') || isoUpper;
    const entryData = {
      placeType: 'country',
      name: countryName,
      countryCode: isoUpper,
      country_code: isoUpper,
      visited: false,
      visitedAt: null,
      status: 'UNVISITED',
      linked_story_id: null,
      storyId: null,
      continent: continentForIso2(isoUpper),
      ownerUid: currentUser.uid,
      createdAt: now,
      updatedAt: now,
      plannedVisitAt: null
    };
    const created = await addDoc(collection(db, 'travel'), entryData);
    setSelectedEntryId(created.id);
  };

  useEffect(() => {
    handleCountryClickRef.current = handleCountryClick;
  }, [handleCountryClick]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: MAP_INITIAL_CENTER,
      zoom: MAP_INITIAL_ZOOM,
      minZoom: 0.5,
      maxZoom: 12,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    map.on('load', () => {
      setMapReady(true);
      if (!map.getSource('countries')) {
        map.addSource('countries', {
          type: 'geojson',
          data: countriesGeojsonRef.current || countriesGeojson,
        });
      }
      if (!map.getLayer('country-fill')) {
        map.addLayer({
          id: 'country-fill',
          type: 'fill',
          source: 'countries',
          paint: {
            'fill-color': countryFillExpression as any,
            'fill-opacity': 0.65,
          },
        });
      }
      if (!map.getLayer('country-outline')) {
        map.addLayer({
          id: 'country-outline',
          type: 'line',
          source: 'countries',
          paint: {
            'line-color': [
              'case',
              ['boolean', ['feature-state', 'selected'], false],
              '#ea580c',
              ['boolean', ['feature-state', 'hover'], false],
              '#2563eb',
              '#94a3b8',
            ],
            'line-width': [
              'case',
              ['boolean', ['feature-state', 'selected'], false],
              1.6,
              ['boolean', ['feature-state', 'hover'], false],
              1.2,
              0.4,
            ],
          },
        });
      }

      map.on('click', 'country-fill', (event) => {
        const target = event.features?.[0] as any;
        const iso2 = target?.properties?.iso2;
        const isSupported = target?.properties?.isSupported;
        if (iso2 && isSupported) handleCountryClickRef.current(iso2);
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
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [countryFillExpression, countriesGeojson]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource('countries') as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(countriesGeojson as any);
    }
  }, [mapReady, countriesGeojson]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    const nextId = selectedIso2 ? selectedIso2.toUpperCase() : null;
    if (selectedFeatureIdRef.current && selectedFeatureIdRef.current !== nextId) {
      map.setFeatureState({ source: 'countries', id: selectedFeatureIdRef.current }, { selected: false });
    }
    if (nextId) {
      map.setFeatureState({ source: 'countries', id: nextId }, { selected: true });
    }
    selectedFeatureIdRef.current = nextId;
  }, [mapReady, selectedIso2]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    if (showPlaceMarkers) {
      entriesWithStatus.forEach(({ entry, status }) => {
        const lng = entry.lng ?? entry.lon;
        if (entry.lat == null || lng == null) return;
        const el = document.createElement('button');
        el.type = 'button';
        el.style.width = '10px';
        el.style.height = '10px';
        el.style.borderRadius = '50%';
        el.style.border = '2px solid #ffffff';
        el.style.background = PLACE_STATUS_COLORS[status].fill;
        el.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.15)';
        el.style.cursor = 'pointer';
        el.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const iso2 = getCountryCode(entry);
          if (iso2) {
            setSelectedIso2(iso2.toUpperCase());
          }
          setSelectedEntryId(entry.id);
        });
        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([Number(lng), Number(entry.lat)])
          .addTo(map);
        markersRef.current.push(marker);
      });
    }

    if (result && result.lat != null && result.lon != null) {
      const el = document.createElement('div');
      el.style.width = '12px';
      el.style.height = '12px';
      el.style.borderRadius = '50%';
      el.style.border = '2px solid #ffffff';
      el.style.background = '#ef4444';
      el.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.2)';
      if (!resultMarkerRef.current) {
        resultMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([result.lon, result.lat])
          .addTo(map);
      } else {
        resultMarkerRef.current.setLngLat([result.lon, result.lat]);
      }
    } else if (resultMarkerRef.current) {
      resultMarkerRef.current.remove();
      resultMarkerRef.current = null;
    }
  }, [mapReady, entriesWithStatus, showPlaceMarkers, result]);

  useEffect(() => {
    if (!mapReady || !result || result.lat == null || result.lon == null) return;
    const map = mapRef.current;
    if (!map) return;
    const zoom = result.city ? 6 : 4;
    map.flyTo({ center: [result.lon, result.lat], zoom, speed: 1.2 });
  }, [mapReady, result]);

  useEffect(() => {
    if (!mapReady || !selectedEntryId) return;
    const map = mapRef.current;
    if (!map) return;
    const entry = entries.find((item) => item.id === selectedEntryId);
    const lng = entry?.lng ?? entry?.lon;
    if (!entry || entry.lat == null || lng == null) return;
    const zoom = entry.city ? 6 : 4;
    map.flyTo({ center: [Number(lng), Number(entry.lat)], zoom, speed: 1.2 });
  }, [mapReady, selectedEntryId, entries]);

  const entriesForSelectedCountry = useMemo(() => {
    return selectedIso2 ? entries.filter(e => getCountryCode(e) === selectedIso2.toUpperCase()) : [];
  }, [entries, selectedIso2]);

  useEffect(() => {
    if (!selectedEntryId) {
      setSelectedStoryId(null);
      return;
    }
    const entry = entries.find((e) => e.id === selectedEntryId);
    if (!entry) return;
    setSelectedStoryId(getEntryStoryId(entry));
    setManualGoalId(entry.goalId || '');
  }, [selectedEntryId, entries]);

  const highlightGoalId = useMemo(() => {
    if (!selectedStoryId) return null;
    return storiesById.get(selectedStoryId || '')?.goalId || null;
  }, [selectedStoryId, storiesById]);

  const addCityToSelected = async () => {
    if (!currentUser?.uid || !selectedIso2 || !newCityForSelected.trim()) return;
    try {
      await addDoc(collection(db, 'travel'), {
        placeType: 'city',
        name: newCityForSelected.trim(),
        countryCode: selectedIso2,
        country_code: selectedIso2,
        city: newCityForSelected.trim(),
        status: 'UNVISITED',
        visited: false,
        visitedAt: null,
        linked_story_id: null,
        storyId: null,
        continent: continentForIso2(selectedIso2) || continent,
        ownerUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        plannedVisitAt: null
      });
      setNewCityForSelected('');
    } catch (error) {
      console.error('Failed adding city', error);
    }
  };

  const flagBucketList = async (entry: TravelEntry) => {
    const match = await resolveGoalMatch(entry, { confirm: true, allowCreate: true });
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
    if (storyId) {
      await updateDoc(doc(db, 'stories', storyId), { status: 4, updatedAt: serverTimestamp() });
    }
    await updateEntryStatus(entry, 'COMPLETED');
  };

  const resetPlaceStatus = async (entry: TravelEntry) => {
    await updateEntryStatus(entry, 'UNVISITED');
  };

  const applyManualGoalMatch = async (entry: TravelEntry) => {
    if (!manualGoalId) return;
    const goal = goals.find((g) => g.id === manualGoalId);
    if (!goal) return;
    await updateDoc(doc(db, 'travel', entry.id), {
      goalId: goal.id,
      goalTitleSnapshot: goal.title,
      matchConfidence: 1,
      matchMethod: 'manual',
      lastMatchedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  };

  const geocodeEntry = async (e: TravelEntry) => {
    if (!currentUser?.uid) return;
    const q = `${e.city ? e.city + ', ' : ''}${getCountryCode(e)}`.trim();
    const r = await geocodePlace(q);
    if (!r) return;
    await updateDoc(doc(db, 'travel', e.id), {
      lat: r.lat,
      lon: r.lon,
      lng: r.lon,
      locationName: r.displayName,
      continent: continentForIso2(r.countryCode) || e.continent,
      name: e.name || r.displayName,
      updatedAt: serverTimestamp()
    });
  };

  useEffect(() => {
    if (!currentUser?.uid || !entries.length) return;

    const syncPlannedVisits = async () => {
      for (const entry of entries) {
        const storyId = getEntryStoryId(entry);
        if (!storyId) continue;
        const story = storiesById.get(storyId);
        if (!story) continue;
        const goal = goals.find(g => g.id === story.goalId);
        const plannedFromGoal = derivePlannedVisitAt(goal);
        const storyDueDate = typeof story.dueDate === 'number' ? story.dueDate : null;
        const desiredPlanned = plannedFromGoal ?? storyDueDate ?? null;

        const entryNeedsUpdate = (entry.plannedVisitAt ?? null) !== (desiredPlanned ?? null);
        const storyNeedsUpdate = storyDueDate !== (desiredPlanned ?? null) || (story.metadata?.plannedVisitAt ?? null) !== (desiredPlanned ?? null);
        const desiredStatus: PlaceStatus = isStoryDone(story) ? 'COMPLETED' : 'STORY_CREATED';
        const currentStatus = normalizePlaceStatus(entry, story);
        const statusNeedsUpdate = currentStatus !== desiredStatus;

        if (!entryNeedsUpdate && !storyNeedsUpdate && !statusNeedsUpdate) continue;

        try {
          const updates: Promise<unknown>[] = [];
          if (statusNeedsUpdate) {
            updates.push(updateEntryStatus(entry, desiredStatus, entryNeedsUpdate ? { plannedVisitAt: desiredPlanned ?? null } : {}));
          } else if (entryNeedsUpdate) {
            updates.push(updateDoc(doc(db, 'travel', entry.id), {
              plannedVisitAt: desiredPlanned ?? null,
              updatedAt: serverTimestamp(),
            }));
          }

          if (storyNeedsUpdate) {
            const updatedMetadata = {
              ...(story.metadata || {}),
              plannedVisitAt: desiredPlanned ?? null,
            };
            updates.push(updateDoc(doc(db, 'stories', story.id), {
              dueDate: desiredPlanned ?? null,
              metadata: updatedMetadata,
              updatedAt: serverTimestamp(),
            }));
          }

          if (updates.length) {
            await Promise.all(updates);
          }
        } catch (error) {
          console.error('TravelMap: failed to sync planned visit date', {
            entryId: entry.id,
            storyId,
            error
          });
        }
      }
    };

    syncPlannedVisits();
  }, [currentUser?.uid, entries, storiesById, goals]);

  return (
    <Card className="border-0 shadow-sm">
      <Card.Header className="bg-white d-flex align-items-center justify-content-between">
        <strong>Travel Map</strong>
        <div className="d-flex gap-2 flex-wrap">
          <Form.Select size="sm" value={continent} onChange={(ev) => setContinent(ev.target.value)} style={{ width: 180 }}>
            {CONTINENTS.map(c => (<option key={c} value={c}>{c}</option>))}
          </Form.Select>
          <Form.Control size="sm" placeholder="Country code (e.g., US)" value={newCountry} onChange={(e) => setNewCountry(e.target.value)} style={{ width: 160 }} />
          <Form.Control size="sm" placeholder="City (optional)" value={newCity} onChange={(e) => setNewCity(e.target.value)} style={{ width: 180 }} />
          <Form.Select size="sm" value={newStatus} onChange={(e) => setNewStatus(e.target.value as PlaceStatus)} style={{ width: 160 }}>
            <option value="UNVISITED">Unvisited</option>
            <option value="BUCKET_LIST">Bucket List</option>
            <option value="STORY_CREATED">Story Created</option>
            <option value="COMPLETED">Completed</option>
          </Form.Select>
          <Button size="sm" onClick={addPlace} disabled={saving || !newCountry.trim()}>Add Place</Button>
          <Button size="sm" variant="outline-secondary" onClick={createTripGoal}>New Travel Goal</Button>
        </div>
      </Card.Header>
      <Card.Body>
        {/* Search + Geocode */}
        <div className="d-flex gap-2 mb-2 align-items-center flex-wrap">
          <Form.Control size="sm" placeholder="Search a place (e.g., Paris, France)" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          <Button size="sm" onClick={runGeocode} disabled={searching || !searchQuery.trim()}>{searching ? 'Searching…' : 'Search'}</Button>
          <Button size="sm" variant="outline-success" onClick={addGeocodeAsPlace} disabled={!result || saving}>Add Place</Button>
          <Button size="sm" variant="outline-primary" onClick={() => result && createStoryFromGeocode(result)} disabled={!result}>Create Story</Button>
          <div className="ms-auto d-flex align-items-center gap-3">
            <Form.Check
              type="checkbox"
              id="place-markers-toggle"
              label="Place markers"
              checked={showPlaceMarkers}
              onChange={(e)=>setShowPlaceMarkers(e.target.checked)}
            />
          </div>
        </div>

        {/* Map with country coloring and optional marker */}
        <div
          style={{
            height: 420,
            marginBottom: 8,
            borderRadius: 8,
            border: '1px solid #e5e7eb',
            background: '#fff',
            overflow: 'hidden',
          }}
        >
          <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
        </div>
        {/* Legend */}
        <div className="d-flex align-items-center gap-3 mb-3 small" aria-label="Map legend">
          <span className="d-inline-flex align-items-center gap-1">
            <span style={{ width: 12, height: 12, background: PLACE_STATUS_COLORS.UNVISITED.fill, display: 'inline-block', border: '1px solid #cbd5e1' }} /> Unvisited
          </span>
          <span className="d-inline-flex align-items-center gap-1">
            <span style={{ width: 12, height: 12, background: PLACE_STATUS_COLORS.BUCKET_LIST.fill, display: 'inline-block', border: '1px solid #cbd5e1' }} /> Bucket list
          </span>
          <span className="d-inline-flex align-items-center gap-1">
            <span style={{ width: 12, height: 12, background: PLACE_STATUS_COLORS.STORY_CREATED.fill, display: 'inline-block', border: '1px solid #cbd5e1' }} /> Story created
          </span>
          <span className="d-inline-flex align-items-center gap-1">
            <span style={{ width: 12, height: 12, background: PLACE_STATUS_COLORS.COMPLETED.fill, display: 'inline-block', border: '1px solid #cbd5e1' }} /> Completed
          </span>
          <span className="d-inline-flex align-items-center gap-1">
            <span style={{ width: 10, height: 10, background: '#ef4444', borderRadius: '50%', display: 'inline-block', border: '1px solid #fff' }} /> Search result
          </span>
        </div>
        <div className="d-flex flex-wrap gap-3 mb-3 small">
          <span><strong>Bucket list completed:</strong> {bucketListMetrics.percent}%</span>
          <span>Bucket list total: {bucketListMetrics.counts.bucketList}</span>
          <span>Stories created: {bucketListMetrics.counts.storyCreated}</span>
          <span>Completed: {bucketListMetrics.counts.completed}</span>
        </div>
        {/* Country details */}
        {selectedIso2 && (
          <div className="border rounded p-2 mb-3" style={{ background: '#f8fafc' }}>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div>
                <strong>{isoCountries.getName(selectedIso2, 'en') || selectedIso2}</strong>
                <Badge bg="light" text="dark" className="ms-2">{selectedIso2}</Badge>
              </div>
              <div className="d-flex gap-2">
                <Button size="sm" variant="outline-secondary" onClick={() => { setSelectedIso2(null); setNewCityForSelected(''); setSelectedEntryId(null); setSelectedStoryId(null); setManualGoalId(''); }}>
                  Clear
                </Button>
              </div>
            </div>
            {(() => {
              const countryEntry = entriesForSelectedCountry.find(e => !e.city);
              const detailEntry = selectedEntryId
                ? entries.find((e) => e.id === selectedEntryId) || countryEntry
                : countryEntry;
              if (!detailEntry) {
                return <div className="text-muted small">Loading place details…</div>;
              }
              const storyId = getEntryStoryId(detailEntry);
              const story = storyId ? storiesById.get(storyId) : undefined;
              const status = normalizePlaceStatus(detailEntry, story || null);
              const statusColor = PLACE_STATUS_COLORS[status].fill;
              const statusTextColor = status === 'BUCKET_LIST' ? '#111827' : '#ffffff';
              const matchEntry = detailEntry;
              return (
                <>
                  <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
                    <Badge style={{ backgroundColor: statusColor, color: statusTextColor }}>
                      {PLACE_STATUS_LABELS[status]}
                    </Badge>
                    <span className="text-muted small">Type: {getPlaceType(detailEntry)}</span>
                  </div>
                  {storyId && (
                    <div className="small mb-1">
                      Story {detailEntry.storyNumber || story?.referenceNumber || story?.ref || storyId}: {detailEntry.storyTitleSnapshot || story?.title || 'Untitled'}
                    </div>
                  )}
                  {detailEntry.goalTitleSnapshot && (
                    <div className="small mb-2">Goal: {detailEntry.goalTitleSnapshot}</div>
                  )}
                  <div className="d-flex flex-wrap gap-2 mb-3">
                    <Button size="sm" variant="outline-warning" onClick={() => flagBucketList(detailEntry)}>
                      Flag bucket list
                    </Button>
                    <Button size="sm" variant="outline-primary" onClick={() => createStoryForEntry(detailEntry)} disabled={!!storyId}>
                      Create story
                    </Button>
                    <Button size="sm" variant="outline-success" onClick={() => markPlaceCompleted(detailEntry)}>
                      Mark story completed
                    </Button>
                    <Button size="sm" variant="outline-secondary" onClick={() => resetPlaceStatus(detailEntry)}>
                      Reset
                    </Button>
                    {!detailEntry.lat && (
                      <Button size="sm" variant="outline-secondary" onClick={() => geocodeEntry(detailEntry)}>Geocode</Button>
                    )}
                  </div>
                  <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
                    <Form.Select size="sm" value={manualGoalId} onChange={(e) => setManualGoalId(e.target.value)} style={{ maxWidth: 260 }}>
                      <option value="">Match goal (manual override)</option>
                      {travelGoals.map(goal => (
                        <option key={goal.id} value={goal.id}>{goal.title}</option>
                      ))}
                    </Form.Select>
                    <Button size="sm" variant="outline-secondary" onClick={() => matchEntry && applyManualGoalMatch(matchEntry)} disabled={!manualGoalId || !matchEntry}>
                      Match goal for {matchEntry ? getPlaceName(matchEntry) : 'place'}
                    </Button>
                  </div>
                </>
              );
            })()}
            <div className="mt-3">
              <h6 className="mb-2">Cities &amp; Places</h6>
              <div className="d-flex gap-2 mb-2">
                <Form.Control
                  size="sm"
                  placeholder="Add city or place"
                  value={newCityForSelected}
                  onChange={(e) => setNewCityForSelected(e.target.value)}
                />
                <Button size="sm" onClick={addCityToSelected} disabled={!newCityForSelected.trim()}>Add</Button>
              </div>
              {entriesForSelectedCountry.filter(e => e.city).length === 0 && (
                <div className="text-muted small">No cities recorded yet for this country.</div>
              )}
              <div className="d-flex flex-column gap-2">
                {entriesForSelectedCountry.filter(e => e.city).map(entry => (
                  <div
                    key={entry.id}
                    className={`d-flex align-items-center justify-content-between p-2 bg-white rounded border ${selectedEntryId === entry.id ? 'border-primary' : ''}`}
                    onClick={() => {
                      setSelectedEntryId(entry.id);
                      setManualGoalId(entry.goalId || '');
                    }}
                  >
                    <div>
                      <strong>{entry.city}</strong>
                      {(() => {
                        const storyId = getEntryStoryId(entry);
                        const story = storyId ? storiesById.get(storyId) : undefined;
                        const status = normalizePlaceStatus(entry, story || null);
                        const statusColor = PLACE_STATUS_COLORS[status].fill;
                        const statusTextColor = status === 'BUCKET_LIST' ? '#111827' : '#ffffff';
                        return (
                          <>
                            <Badge style={{ backgroundColor: statusColor, color: statusTextColor }} className="ms-2">
                              {PLACE_STATUS_LABELS[status]}
                            </Badge>
                            {storyId && (
                              <div className="text-muted small">
                                Story {entry.storyNumber || story?.referenceNumber || story?.ref || storyId}
                                {entry.goalTitleSnapshot ? ` · ${entry.goalTitleSnapshot}` : ''}
                              </div>
                            )}
                          </>
                        );
                      })()}
                      {entry.plannedVisitAt && (
                        <Badge bg="warning" text="dark" className="ms-2">Planned {formatPlannedDate(entry.plannedVisitAt)}</Badge>
                      )}
                    </div>
                    <div className="d-flex gap-2">
                      <Button size="sm" variant="outline-warning" onClick={(ev) => { ev.stopPropagation(); flagBucketList(entry); }}>
                        Bucket list
                      </Button>
                      <Button size="sm" variant="outline-primary" onClick={(ev) => { ev.stopPropagation(); createStoryForEntry(entry); }} disabled={!!getEntryStoryId(entry)}>
                        Create story
                      </Button>
                      <Button size="sm" variant="outline-success" onClick={(ev) => { ev.stopPropagation(); markPlaceCompleted(entry); }}>
                        Complete
                      </Button>
                      {!entry.lat && <Button size="sm" variant="outline-secondary" onClick={(ev) => { ev.stopPropagation(); geocodeEntry(entry); }}>Geocode</Button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        <Row>
          <Col md={6}>
            <h6 className="mb-2">Places</h6>
            <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid #f3f4f6', borderRadius: 8, padding: 8 }}>
              {entries.length === 0 && <div className="text-muted small">No locations yet. Add one above.</div>}
              {entries.map(e => (
                <div key={e.id} className="d-flex align-items-center justify-content-between py-1" style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <div>
                    <strong>{getCountryCode(e) || e.country_code}</strong>{e.city ? ` · ${e.city}` : ''}
                    <Badge bg="light" text="dark" className="ms-2">{e.continent || continentForIso2(getCountryCode(e))}</Badge>
                    {(() => {
                      const storyId = getEntryStoryId(e);
                      const story = storyId ? storiesById.get(storyId) : undefined;
                      const status = normalizePlaceStatus(e, story || null);
                      const statusColor = PLACE_STATUS_COLORS[status].fill;
                      const statusTextColor = status === 'BUCKET_LIST' ? '#111827' : '#ffffff';
                      return (
                        <>
                          <Badge style={{ backgroundColor: statusColor, color: statusTextColor }} className="ms-2">
                            {PLACE_STATUS_LABELS[status]}
                          </Badge>
                          {storyId && (
                            <span className="text-muted small ms-2">
                              Story {e.storyNumber || story?.referenceNumber || story?.ref || storyId}
                              {e.goalTitleSnapshot ? ` · ${e.goalTitleSnapshot}` : ''}
                            </span>
                          )}
                        </>
                      );
                    })()}
                    {e.plannedVisitAt && (
                      <Badge bg="warning" text="dark" className="ms-2">Planned {formatPlannedDate(e.plannedVisitAt)}</Badge>
                    )}
                  </div>
                  <div className="d-flex gap-2">
                    <Button size="sm" variant="outline-warning" onClick={() => flagBucketList(e)}>
                      Bucket list
                    </Button>
                    <Button size="sm" variant="outline-primary" onClick={() => createStoryForEntry(e)} disabled={!!getEntryStoryId(e)}>
                      Create story
                    </Button>
                    <Button size="sm" variant="outline-success" onClick={() => markPlaceCompleted(e)}>
                      Complete
                    </Button>
                    {!e.lat && <Button size="sm" variant="outline-secondary" onClick={() => geocodeEntry(e)}>Geocode</Button>}
                  </div>
                </div>
              ))}
            </div>
          </Col>
          <Col md={6}>
            <h6 className="mb-2">Progress by Continent</h6>
            <div className="d-flex flex-column gap-2">
              {CONTINENTS.map(c => {
                const t = totalsByContinent[c] || { completed: 0, total: 0 };
                const pct = t.total > 0 ? Math.round((t.completed / t.total) * 100) : 0;
                return (
                  <div key={c}>
                    <div className="d-flex justify-content-between small mb-1"><strong>{c}</strong><span>{t.completed}/{t.total} · {pct}%</span></div>
                    <ProgressBar now={pct} variant="info" />
                  </div>
                );
              })}
            </div>
          </Col>
        </Row>
        <div className="mt-4">
          <div className="d-flex align-items-center justify-content-between mb-2">
            <h6 className="mb-0">Travel Goals</h6>
            <Form.Check
              type="switch"
              id="travel-goals-only-toggle"
              label="Only travel-related goals"
              checked={travelGoalsOnly}
              onChange={(e) => setTravelGoalsOnly(e.target.checked)}
            />
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
      </Card.Body>
    </Card>
  );
};

export default TravelMap;
