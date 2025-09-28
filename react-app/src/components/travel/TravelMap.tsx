import React, { useEffect, useMemo, useState } from 'react';
import { Card, Row, Col, Button, Form, Badge, ProgressBar } from 'react-bootstrap';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { Goal, Story } from '../../types';
import { generateRef } from '../../utils/referenceGenerator';
import { geocodePlace, GeocodeResult } from '../../utils/geocoding';
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from 'react-simple-maps';
import { continentForIso2 } from '../../utils/geoUtils';
import worldCountries from 'world-atlas/countries-50m.json';
import isoCountries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';
isoCountries.registerLocale(enLocale as any);

interface TravelEntry {
  id: string;
  country_code: string; // ISO alpha-2/3
  city?: string;
  visited: boolean;
  visitedAt?: any;
  linked_story_id?: string;
  continent: string;
  ownerUid: string;
  // optional geo metadata if known
  lat?: number;
  lon?: number;
  locationName?: string;
}

const CONTINENTS = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Antarctica'];
const GEO_DATA: any = worldCountries as any;

const TravelMap: React.FC = () => {
  const { currentUser } = useAuth();
  const [entries, setEntries] = useState<TravelEntry[]>([]);
  const [newCountry, setNewCountry] = useState('');
  const [newCity, setNewCity] = useState('');
  const [continent, setContinent] = useState('Europe');
  const [saving, setSaving] = useState(false);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string>('');
  const [colorMode, setColorMode] = useState<'visited' | 'trip' | 'both'>('both');
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<GeocodeResult | null>(null);
  const [showVisitedMarkers, setShowVisitedMarkers] = useState(true);
  const [showTripMarkers, setShowTripMarkers] = useState(true);
  const [selectedIso2, setSelectedIso2] = useState<string | null>(null);

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

  const totalsByContinent = useMemo(() => {
    const totals: Record<string, { visited: number; total: number }> = {};
    CONTINENTS.forEach(c => totals[c] = { visited: 0, total: 0 });
    entries.forEach(e => {
      if (!totals[e.continent]) totals[e.continent] = { visited: 0, total: 0 };
      totals[e.continent].total += 1;
      if (e.visited) totals[e.continent].visited += 1;
    });
    return totals;
  }, [entries]);

  const visitedIso2 = useMemo(() => {
    const set = new Set<string>();
    entries.forEach(e => {
      if (e.visited && e.country_code) set.add(e.country_code.toUpperCase());
    });
    return set;
  }, [entries]);

  const tripIso2 = useMemo(() => {
    if (!selectedTripId) return new Set<string>();
    const set = new Set<string>();
    stories.forEach(s => {
      if (s.goalId === selectedTripId && s.countryCode) {
        set.add(s.countryCode.toUpperCase());
      }
    });
    return set;
  }, [stories, selectedTripId]);

  const tripStoryMarkers = useMemo(() => {
    if (!selectedTripId) return [] as Array<{ id: string; lon: number; lat: number }>;
    return stories
      .filter(s => s.goalId === selectedTripId && typeof s.locationLat === 'number' && typeof s.locationLon === 'number')
      .map(s => ({ id: s.id, lon: s.locationLon as number, lat: s.locationLat as number }));
  }, [stories, selectedTripId]);

  const addVisited = async () => {
    if (!currentUser?.uid || !newCountry.trim()) return;
    try {
      setSaving(true);
      console.log('🧭 TravelMap: adding visited location', { country: newCountry, city: newCity, continent });
      const detected = continentForIso2(newCountry.trim());
      await addDoc(collection(db, 'travel'), {
        country_code: newCountry.trim().toUpperCase(),
        city: newCity.trim() || null,
        visited: true,
        visitedAt: serverTimestamp(),
        linked_story_id: null,
        continent: detected !== 'Unknown' ? detected : continent,
        ownerUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      console.log('✅ TravelMap: location saved');
      setNewCountry('');
      setNewCity('');
    } finally {
      setSaving(false);
    }
  };

  const toggleVisited = async (e: TravelEntry) => {
    console.log('🔄 TravelMap: toggling visited', { id: e.id, wasVisited: e.visited });
    await updateDoc(doc(db, 'travel', e.id), { visited: !e.visited, updatedAt: serverTimestamp() });
    console.log('✅ TravelMap: toggled visited', { id: e.id, nowVisited: !e.visited });
  };

  // Create a Story for this location and link back
  const convertToStory = async (e: TravelEntry) => {
    if (!currentUser?.uid) return;
    console.log('📖 TravelMap: converting location to Story', { id: e.id, country: e.country_code, city: e.city });

    // Use selected trip if provided, else fall back to a Travel goal if exists
    let goalToUse: Goal | undefined = goals.find(g => g.id === selectedTripId);
    if (!goalToUse) {
      goalToUse = goals.find(g => (g.title || '').toLowerCase() === 'travel') || goals.find(g => g.theme === 7);
    }

    const title = `Visit ${e.city ? e.city + ', ' : ''}${e.country_code}`;
    const storyPayload = {
      persona: 'personal' as const,
      title,
      description: `Travel log for ${title}.`,
      goalId: goalToUse?.id || '',
      theme: goalToUse?.theme || 7,
      status: 1,
      priority: 2,
      points: 1,
      wipLimit: 3,
      tags: ['travel'],
      sprintId: undefined,
      orderIndex: 0,
      ownerUid: currentUser.uid,
      acceptanceCriteria: [] as string[],
      // location metadata
      countryCode: e.country_code?.toUpperCase(),
      city: e.city,
      locationName: title,
    } satisfies Omit<Story, 'id' | 'createdAt' | 'updatedAt' | 'ref'>;

    // Generate short story reference and persist
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
    console.log('✅ TravelMap: story created', { storyId: storyRef.id });
    await updateDoc(doc(db, 'travel', e.id), { linked_story_id: storyRef.id, updatedAt: serverTimestamp() });
    console.log('🔗 TravelMap: linked story to travel entry', { travelId: e.id, storyId: storyRef.id });
  };

  // Create a story directly from a geocode result (without a travel entry yet)
  const createStoryFromGeocode = async (g: GeocodeResult) => {
    if (!currentUser?.uid) return;
    let goalToUse: Goal | undefined = goals.find(g0 => g0.id === selectedTripId) || goals.find(g0 => g0.theme === 7);
    const title = `Visit ${g.city ? g.city + ', ' : ''}${g.countryCode || ''}`.trim() || g.displayName;
    const existing = await getDocs(query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid)));
    const existingRefs = existing.docs.map(d => (d.data() as any).ref).filter(Boolean) as string[];
    const shortRef = generateRef('story', existingRefs);
    const storyRef = await addDoc(collection(db, 'stories'), {
      persona: 'personal',
      title,
      description: `Travel log for ${g.displayName}.`,
      goalId: goalToUse?.id || '',
      theme: goalToUse?.theme || 7,
      status: 1,
      priority: 2,
      points: 1,
      wipLimit: 3,
      tags: ['travel'],
      sprintId: undefined,
      orderIndex: 0,
      ownerUid: currentUser.uid,
      acceptanceCriteria: [],
      ref: shortRef,
      referenceNumber: shortRef,
      // location metadata
      countryCode: g.countryCode,
      city: g.city,
      locationName: g.displayName,
      locationLat: g.lat,
      locationLon: g.lon,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    console.log('✅ TravelMap: story created from geocode', { storyId: storyRef.id });
  };

  const runGeocode = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    const r = await geocodePlace(searchQuery.trim());
    setResult(r);
    setSearching(false);
  };

  const addGeocodeAsVisited = async () => {
    if (!currentUser?.uid || !result) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'travel'), {
        country_code: (result.countryCode || '').toUpperCase(),
        city: result.city || null,
        visited: true,
        visitedAt: serverTimestamp(),
        linked_story_id: null,
        continent: continentForIso2(result.countryCode) || continent,
        lat: result.lat,
        lon: result.lon,
        locationName: result.displayName,
        ownerUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } finally {
      setSaving(false);
    }
  };

  const createTripGoal = async () => {
    if (!currentUser?.uid) return;
    const name = window.prompt('New Trip name (Goal title)');
    if (!name) return;
    const now = serverTimestamp();
    const created = await addDoc(collection(db, 'goals'), {
      persona: 'personal',
      title: name,
      description: 'Trip goal created from Travel Map',
      theme: 7, // Travel & Adventure
      size: 2,
      timeToMasterHours: 0,
      confidence: 2,
      status: 0,
      ownerUid: currentUser.uid,
      createdAt: now,
      updatedAt: now
    });
    setSelectedTripId(created.id);
  };

  const handleCountryClick = async (iso2: string) => {
    if (!currentUser?.uid) return;
    setSelectedIso2(iso2.toUpperCase());
    const existing = entries.find(e => e.country_code?.toUpperCase() === iso2.toUpperCase());
    const now = serverTimestamp();
    if (existing) {
      await updateDoc(doc(db, 'travel', existing.id), { visited: !existing.visited, updatedAt: now });
    } else {
      await addDoc(collection(db, 'travel'), {
        country_code: iso2.toUpperCase(),
        visited: true,
        visitedAt: now,
        linked_story_id: null,
        continent: continentForIso2(iso2),
        ownerUid: currentUser.uid,
        createdAt: now,
        updatedAt: now
      });
    }
  };

  const geocodeEntry = async (e: TravelEntry) => {
    if (!currentUser?.uid) return;
    const q = `${e.city ? e.city + ', ' : ''}${e.country_code}`.trim();
    const r = await geocodePlace(q);
    if (!r) return;
    await updateDoc(doc(db, 'travel', e.id), {
      lat: r.lat,
      lon: r.lon,
      locationName: r.displayName,
      continent: continentForIso2(r.countryCode) || e.continent,
      updatedAt: serverTimestamp()
    });
  };

  const createStoryFromCountry = async (iso2: string) => {
    if (!currentUser?.uid) return;
    const goalToUse: Goal | undefined = goals.find(g0 => g0.id === selectedTripId) || goals.find(g0 => g0.theme === 7);
    const countryName = isoCountries.getName(iso2, 'en') || iso2;
    const title = `Visit ${countryName}`;
    const existing = await getDocs(query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid)));
    const existingRefs = existing.docs.map(d => (d.data() as any).ref).filter(Boolean) as string[];
    const shortRef = generateRef('story', existingRefs);
    await addDoc(collection(db, 'stories'), {
      persona: 'personal',
      title,
      description: `Travel log for ${countryName}.`,
      goalId: goalToUse?.id || '',
      theme: goalToUse?.theme || 7,
      status: 1,
      priority: 2,
      points: 1,
      wipLimit: 3,
      tags: ['travel'],
      sprintId: undefined,
      orderIndex: 0,
      ownerUid: currentUser.uid,
      acceptanceCriteria: [],
      ref: shortRef,
      referenceNumber: shortRef,
      countryCode: iso2.toUpperCase(),
      locationName: countryName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  };

  return (
    <Card className="border-0 shadow-sm">
      <Card.Header className="bg-white d-flex align-items-center justify-content-between">
        <strong>Travel Map</strong>
        <div className="d-flex gap-2">
          <Form.Select size="sm" value={selectedTripId} onChange={(e) => setSelectedTripId(e.target.value)} style={{ width: 200 }}>
            <option value="">Trip (Goal) — optional</option>
            {goals.map(g => (
              <option key={g.id} value={g.id}>{g.title}</option>
            ))}
          </Form.Select>
          <Button size="sm" variant="outline-secondary" onClick={createTripGoal}>New Trip</Button>
          <Form.Select size="sm" value={colorMode} onChange={(e) => setColorMode(e.target.value as any)} style={{ width: 160 }}>
            <option value="both">Color: Both</option>
            <option value="visited">Color: Visited</option>
            <option value="trip">Color: Trip</option>
          </Form.Select>
          <Form.Select size="sm" value={continent} onChange={(ev) => setContinent(ev.target.value)} style={{ width: 180 }}>
            {CONTINENTS.map(c => (<option key={c} value={c}>{c}</option>))}
          </Form.Select>
          <Form.Control size="sm" placeholder="Country code (e.g., US)" value={newCountry} onChange={(e) => setNewCountry(e.target.value)} style={{ width: 160 }} />
          <Form.Control size="sm" placeholder="City (optional)" value={newCity} onChange={(e) => setNewCity(e.target.value)} style={{ width: 180 }} />
          <Button size="sm" onClick={addVisited} disabled={saving || !newCountry.trim()}>Mark Visited</Button>
        </div>
      </Card.Header>
      <Card.Body>
        {/* Search + Geocode */}
        <div className="d-flex gap-2 mb-2 align-items-center flex-wrap">
          <Form.Control size="sm" placeholder="Search a place (e.g., Paris, France)" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          <Button size="sm" onClick={runGeocode} disabled={searching || !searchQuery.trim()}>{searching ? 'Searching…' : 'Search'}</Button>
          <Button size="sm" variant="outline-success" onClick={addGeocodeAsVisited} disabled={!result || saving}>Add as Visited</Button>
          <Button size="sm" variant="outline-primary" onClick={() => result && createStoryFromGeocode(result)} disabled={!result}>Create Story</Button>
          <div className="ms-auto d-flex align-items-center gap-3">
            <Form.Check
              type="checkbox"
              id="visited-markers-toggle"
              label="Visited markers"
              checked={showVisitedMarkers}
              onChange={(e)=>setShowVisitedMarkers(e.target.checked)}
            />
            <Form.Check
              type="checkbox"
              id="trip-markers-toggle"
              label="Trip markers"
              checked={showTripMarkers}
              onChange={(e)=>setShowTripMarkers(e.target.checked)}
            />
          </div>
        </div>

        {/* Map with country coloring and optional marker */}
        <div style={{ height: 420, marginBottom: 8, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff' }}>
          <ComposableMap projectionConfig={{ scale: 150 }} style={{ width: '100%', height: '100%' }}>
            <ZoomableGroup zoom={1} center={[0, 20]}>
              <Geographies geography={GEO_DATA}>
                {({ geographies }) => geographies.map(geo => {
                  // world-atlas uses numeric country codes as geo.id. Convert to ISO alpha-2.
                  const numeric = (geo.id ?? '').toString().padStart(3, '0');
                  // numericToAlpha2 can return undefined for non-country ids; guard before toUpperCase
                  const iso2Raw = isoCountries.numericToAlpha2 ? isoCountries.numericToAlpha2(numeric) : '';
                  const iso2 = (iso2Raw || '').toUpperCase();
                  const inTrip = iso2 && tripIso2.has(iso2);
                  const visited = iso2 && visitedIso2.has(iso2);
                  const fill = (() => {
                    if (colorMode === 'trip') return inTrip ? '#0ea5e9' : '#e5e7eb';
                    if (colorMode === 'visited') return visited ? '#10b981' : '#e5e7eb';
                    return inTrip ? '#0ea5e9' : (visited ? '#10b981' : '#e5e7eb');
                  })();
                  const hover = (() => {
                    if (colorMode === 'trip') return inTrip ? '#0284c7' : '#d1d5db';
                    if (colorMode === 'visited') return visited ? '#059669' : '#d1d5db';
                    return inTrip ? '#0284c7' : (visited ? '#059669' : '#d1d5db');
                  })();
                  const pressed = (() => {
                    if (colorMode === 'trip') return inTrip ? '#0369a1' : '#cbd5e1';
                    if (colorMode === 'visited') return visited ? '#047857' : '#cbd5e1';
                    return inTrip ? '#0369a1' : (visited ? '#047857' : '#cbd5e1');
                  })();
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      style={{
                        default: { fill, outline: 'none' },
                        hover: { fill: hover, outline: 'none' },
                        pressed: { fill: pressed, outline: 'none' }
                      }}
                      onClick={() => iso2 && handleCountryClick(iso2)}
                    />
                  );
                })}
              </Geographies>
              {result && (
                <Marker coordinates={[result.lon, result.lat]}>
                  <circle r={4} fill="#ef4444" stroke="#fff" strokeWidth={1} />
                </Marker>
              )}
              {showVisitedMarkers && entries.filter(e => e.lat && e.lon).map(e => (
                <Marker key={e.id} coordinates={[e.lon as number, e.lat as number]}>
                  <circle r={3} fill="#f59e0b" stroke="#fff" strokeWidth={1} />
                </Marker>
              ))}
              {showTripMarkers && tripStoryMarkers.map(m => (
                <Marker key={`trip-${m.id}`} coordinates={[m.lon, m.lat]}>
                  <circle r={3} fill="#8b5cf6" stroke="#fff" strokeWidth={1} />
                </Marker>
              ))}
            </ZoomableGroup>
          </ComposableMap>
        </div>
        {/* Legend */}
        <div className="d-flex align-items-center gap-3 mb-3 small" aria-label="Map legend">
          <span className="d-inline-flex align-items-center gap-1">
            <span style={{ width: 12, height: 12, background: '#0ea5e9', display: 'inline-block', border: '1px solid #cbd5e1' }} /> Trip countries
          </span>
          <span className="d-inline-flex align-items-center gap-1">
            <span style={{ width: 12, height: 12, background: '#10b981', display: 'inline-block', border: '1px solid #cbd5e1' }} /> Visited countries
          </span>
          <span className="d-inline-flex align-items-center gap-1">
            <span style={{ width: 10, height: 10, background: '#f59e0b', borderRadius: '50%', display: 'inline-block', border: '1px solid #fff' }} /> Visited marker
          </span>
          <span className="d-inline-flex align-items-center gap-1">
            <span style={{ width: 10, height: 10, background: '#8b5cf6', borderRadius: '50%', display: 'inline-block', border: '1px solid #fff' }} /> Trip marker
          </span>
          <span className="d-inline-flex align-items-center gap-1">
            <span style={{ width: 10, height: 10, background: '#ef4444', borderRadius: '50%', display: 'inline-block', border: '1px solid #fff' }} /> Search result
          </span>
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
                <Button size="sm" variant="outline-secondary" onClick={() => setSelectedIso2(null)}>Clear</Button>
              </div>
            </div>
            {(() => {
              const entry = entries.find(e => e.country_code?.toUpperCase() === selectedIso2);
              const isVisited = !!entry?.visited;
              return (
                <div className="d-flex flex-wrap gap-2">
                  <Button size="sm" variant={isVisited ? 'success' : 'outline-secondary'} onClick={() => entry ? toggleVisited(entry) : handleCountryClick(selectedIso2)}> {isVisited ? 'Visited' : 'Mark Visited'} </Button>
                  {entry && (
                    <>
                      {!entry.lat && <Button size="sm" variant="outline-secondary" onClick={() => geocodeEntry(entry)}>Geocode</Button>}
                      <Button size="sm" variant="outline-primary" onClick={() => convertToStory(entry)} disabled={!!entry.linked_story_id}>To Story</Button>
                    </>
                  )}
                  {!entry && (
                    <Button size="sm" variant="outline-primary" onClick={() => createStoryFromCountry(selectedIso2)}>Create Story</Button>
                  )}
                </div>
              );
            })()}
          </div>
        )}
        <Row>
          <Col md={6}>
            <h6 className="mb-2">Visited Locations</h6>
            <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid #f3f4f6', borderRadius: 8, padding: 8 }}>
              {entries.length === 0 && <div className="text-muted small">No locations yet. Add one above.</div>}
              {entries.map(e => (
                <div key={e.id} className="d-flex align-items-center justify-content-between py-1" style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <div>
                    <strong>{e.country_code}</strong>{e.city ? ` · ${e.city}` : ''}
                    <Badge bg="light" text="dark" className="ms-2">{e.continent}</Badge>
                    {e.linked_story_id && <Badge bg="success" className="ms-2">Story Linked</Badge>}
                  </div>
                  <div className="d-flex gap-2">
                    <Button size="sm" variant={e.visited ? 'success' : 'outline-secondary'} onClick={() => toggleVisited(e)}>
                      {e.visited ? 'Visited' : 'Not Visited'}
                    </Button>
                    {!e.lat && <Button size="sm" variant="outline-secondary" onClick={() => geocodeEntry(e)}>Geocode</Button>}
                    <Button size="sm" variant="outline-primary" onClick={() => convertToStory(e)} disabled={!!e.linked_story_id}>To Story</Button>
                  </div>
                </div>
              ))}
            </div>
          </Col>
          <Col md={6}>
            <h6 className="mb-2">Progress by Continent</h6>
            <div className="d-flex flex-column gap-2">
              {CONTINENTS.map(c => {
                const t = totalsByContinent[c] || { visited: 0, total: 0 };
                const pct = t.total > 0 ? Math.round((t.visited / t.total) * 100) : 0;
                return (
                  <div key={c}>
                    <div className="d-flex justify-content-between small mb-1"><strong>{c}</strong><span>{t.visited}/{t.total} · {pct}%</span></div>
                    <ProgressBar now={pct} variant="info" />
                  </div>
                );
              })}
            </div>
          </Col>
        </Row>
      </Card.Body>
    </Card>
  );
};

export default TravelMap;
