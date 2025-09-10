import React, { useEffect, useMemo, useState } from 'react';
import { Card, Row, Col, Button, Form, Badge, ProgressBar } from 'react-bootstrap';
import { MapContainer, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { Goal, Story } from '../../types';
import { generateRef } from '../../utils/referenceGenerator';

interface TravelEntry {
  id: string;
  country_code: string; // ISO alpha-2/3
  city?: string;
  visited: boolean;
  visitedAt?: any;
  linked_story_id?: string;
  continent: string;
  ownerUid: string;
}

const CONTINENTS = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Antarctica'];

const TravelMap: React.FC = () => {
  const { currentUser } = useAuth();
  const [entries, setEntries] = useState<TravelEntry[]>([]);
  const [newCountry, setNewCountry] = useState('');
  const [newCity, setNewCity] = useState('');
  const [continent, setContinent] = useState('Europe');
  const [saving, setSaving] = useState(false);

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

  const addVisited = async () => {
    if (!currentUser?.uid || !newCountry.trim()) return;
    try {
      setSaving(true);
      console.log('🧭 TravelMap: adding visited location', { country: newCountry, city: newCity, continent });
      await addDoc(collection(db, 'travel'), {
        country_code: newCountry.trim().toUpperCase(),
        city: newCity.trim() || null,
        visited: true,
        visitedAt: serverTimestamp(),
        linked_story_id: null,
        continent,
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
    // Find a Travel goal; if absent, skip linking goal
    let travelGoal: Goal | undefined;
    try {
      const q = query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid));
      const snap = await getDocs(q);
      const goals = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Goal[];
      travelGoal = goals.find(g => g.title?.toLowerCase() === 'travel');
      console.log('📖 TravelMap: resolved Travel goal', { found: !!travelGoal, goalId: travelGoal?.id });
    } catch {}

    const title = `Visit ${e.city ? e.city + ', ' : ''}${e.country_code}`;
    const newStory: Omit<Story, 'id' | 'createdAt' | 'updatedAt' | 'ref'> = {
      ref: '' as any,
      persona: 'personal',
      title,
      description: `Travel log for ${title}.`,
      goalId: travelGoal?.id || '',
      theme: travelGoal?.theme || 2,
      status: 1,
      priority: 2,
      points: 1,
      wipLimit: 3,
      tags: ['travel'],
      sprintId: undefined,
      orderIndex: 0,
      ownerUid: currentUser.uid,
      acceptanceCriteria: []
    } as any;

    // Generate short story reference and persist
    const existing = await getDocs(query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid)));
    const existingRefs = existing.docs.map(d => (d.data() as any).ref).filter(Boolean) as string[];
    const shortRef = generateRef('story', existingRefs);

    const storyRef = await addDoc(collection(db, 'stories'), {
      ...newStory,
      ref: shortRef,
      referenceNumber: shortRef,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    console.log('✅ TravelMap: story created', { storyId: storyRef.id });
    await updateDoc(doc(db, 'travel', e.id), { linked_story_id: storyRef.id, updatedAt: serverTimestamp() });
    console.log('🔗 TravelMap: linked story to travel entry', { travelId: e.id, storyId: storyRef.id });
  };

  return (
    <Card className="border-0 shadow-sm">
      <Card.Header className="bg-white d-flex align-items-center justify-content-between">
        <strong>Travel Map (Beta)</strong>
        <div className="d-flex gap-2">
          <Form.Select size="sm" value={continent} onChange={(ev) => setContinent(ev.target.value)} style={{ width: 180 }}>
            {CONTINENTS.map(c => (<option key={c} value={c}>{c}</option>))}
          </Form.Select>
          <Form.Control size="sm" placeholder="Country code (e.g., US)" value={newCountry} onChange={(e) => setNewCountry(e.target.value)} style={{ width: 160 }} />
          <Form.Control size="sm" placeholder="City (optional)" value={newCity} onChange={(e) => setNewCity(e.target.value)} style={{ width: 180 }} />
          <Button size="sm" onClick={addVisited} disabled={saving || !newCountry.trim()}>Mark Visited</Button>
        </div>
      </Card.Header>
      <Card.Body>
        {/* Basic Leaflet map (phase 1) */}
        <div style={{ height: 420, marginBottom: 16 }}>
          <MapContainer {...({ center: [20, 0], zoom: 2, scrollWheelZoom: true } as any)} style={{ height: '100%', borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <TileLayer {...({
              attribution: '\u00A9 OpenStreetMap contributors',
              url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
            } as any)} />
          </MapContainer>
        </div>
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
