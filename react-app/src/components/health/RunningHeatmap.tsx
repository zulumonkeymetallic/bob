import React, { useEffect, useRef, useState, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

interface WorkoutDoc {
  id: string;
  startDate: number;
  distance_m: number | null;
  summaryPolyline: string | null;
  isTrainer: boolean;
  name: string;
}

type DateFilter = '30' | '90' | '180' | 'all';

function decodePolyline(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b: number, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    coords.push([lng / 1e5, lat / 1e5]);
  }
  return coords;
}

const DATE_FILTER_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 180 days' },
  { value: 'all', label: 'All time' },
];

const RunningHeatmap: React.FC = () => {
  const { currentUser } = useAuth();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

  const [workouts, setWorkouts] = useState<WorkoutDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [outdoorOnly, setOutdoorOnly] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  // Fetch running workouts from Firestore
  useEffect(() => {
    if (!currentUser?.uid) return;
    const fetchWorkouts = async () => {
      setLoading(true);
      try {
        const q = query(
          collection(db, 'metrics_workouts'),
          where('ownerUid', '==', currentUser.uid),
          where('run', '==', true),
          orderBy('startDate', 'desc'),
          limit(500),
        );
        const snap = await getDocs(q);
        const docs = snap.docs.map(d => d.data() as WorkoutDoc);
        setWorkouts(docs);
      } catch (err) {
        console.error('[RunningHeatmap] fetch error', err);
      } finally {
        setLoading(false);
      }
    };
    fetchWorkouts();
  }, [currentUser?.uid]);

  // Apply date + outdoor filters
  const filteredWorkouts = useMemo(() => {
    const cutoffMs = dateFilter === 'all'
      ? 0
      : Date.now() - parseInt(dateFilter, 10) * 24 * 60 * 60 * 1000;

    return workouts.filter(w => {
      if (!w.summaryPolyline) return false;
      if (w.startDate < cutoffMs) return false;
      if (outdoorOnly && w.isTrainer) return false;
      return true;
    });
  }, [workouts, dateFilter, outdoorOnly]);

  // Build GeoJSON from filtered workouts
  const geojson = useMemo((): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: filteredWorkouts.map(w => ({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: decodePolyline(w.summaryPolyline!),
      },
      properties: { id: w.id },
    })),
  }), [filteredWorkouts]);

  // Initialise map once
  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [-5.93, 54.6], // Belfast default
      zoom: 11,
    });
    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.current.on('load', () => {
      map.current!.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.current!.addLayer({
        id: 'routes-layer',
        type: 'line',
        source: 'routes',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#FC4C02', 'line-opacity': 0.18, 'line-width': 2 },
      });
      setMapReady(true);
    });
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  // Update source data whenever geojson changes
  useEffect(() => {
    if (!mapReady || !map.current) return;
    const source = map.current.getSource('routes') as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(geojson);

    // Auto-fit bounds to visible routes when there is data
    if (geojson.features.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      geojson.features.forEach(f => {
        (f.geometry as GeoJSON.LineString).coordinates.forEach(c => bounds.extend(c as [number, number]));
      });
      if (!bounds.isEmpty()) map.current.fitBounds(bounds, { padding: 40, maxZoom: 14 });
    }
  }, [geojson, mapReady]);

  const totalDistKm = filteredWorkouts.reduce((acc, w) => acc + (w.distance_m ?? 0), 0) / 1000;
  const hasPolylines = workouts.some(w => w.summaryPolyline);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Controls */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {DATE_FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setDateFilter(opt.value)}
              style={{
                padding: '4px 10px',
                borderRadius: 4,
                border: '1px solid #444',
                background: dateFilter === opt.value ? '#FC4C02' : '#1a1a1a',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#ccc', cursor: 'pointer' }}>
          <input type="checkbox" checked={outdoorOnly} onChange={e => setOutdoorOnly(e.target.checked)} />
          Outdoor only
        </label>
        <div style={{ marginLeft: 'auto', fontSize: 13, color: '#aaa' }}>
          {loading
            ? 'Loading…'
            : `${filteredWorkouts.length} runs · ${totalDistKm.toFixed(0)} km`}
        </div>
      </div>

      {/* Map */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <div ref={mapContainer} style={{ position: 'absolute', inset: 0 }} />

        {!loading && !hasPolylines && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)', color: '#ccc', fontSize: 14, textAlign: 'center', padding: 24,
          }}>
            <div>
              <div style={{ fontSize: 32, marginBottom: 8 }}>No route data yet</div>
              <div>Strava sync runs nightly — routes will appear after the next sync.</div>
              <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
                Only activities synced after this update carry route data.
              </div>
            </div>
          </div>
        )}

        {!loading && hasPolylines && filteredWorkouts.length === 0 && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)', color: '#ccc', fontSize: 14,
          }}>
            No runs in this date range.
          </div>
        )}
      </div>
    </div>
  );
};

export default RunningHeatmap;
