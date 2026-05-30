import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Button, Spinner, Alert, Form } from 'react-bootstrap';
import { collection, query, where, getDocs, addDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

type LayerMode = 'heatmap' | 'routes';

interface GpsStream {
  id: string;
  stravaActivityId: string;
  activityType: string;
  startDate: any;
  points: Array<{ lat: number; lng: number }>;
}

const BELFAST: [number, number] = [-5.9301, 54.5973];

export default function RunningHeatmap() {
  const { currentUser } = useAuth();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [streams, setStreams] = useState<GpsStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [layer, setLayer] = useState<LayerMode>('heatmap');
  const [mapReady, setMapReady] = useState(false);
  const [uploading, setUploading] = useState(false);

  const uid = currentUser?.uid;

  // Load GPS streams from Firestore
  const loadStreams = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    setError(null);
    try {
      const q = query(collection(db, 'strava_gps_streams'), where('uid', '==', uid));
      const snap = await getDocs(q);
      const data: GpsStream[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as GpsStream));
      setStreams(data);
    } catch (e: any) {
      setError('Failed to load GPS data: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { loadStreams(); }, [loadStreams]);

  // Trigger server-side backfill of GPS streams from Strava
  const handleBackfill = useCallback(async () => {
    setBackfilling(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'fetchRunningGpsStreams');
      await fn({});
      await loadStreams();
    } catch (e: any) {
      setError('Backfill failed: ' + (e?.message || e));
    } finally {
      setBackfilling(false);
    }
  }, [loadStreams]);

  // Parse uploaded GPX files client-side
  const handleGpxUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !uid) return;
    setUploading(true);
    setError(null);
    try {
      for (const rawFile of files) {
        const file = rawFile as File;
        const text = await file.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'application/xml');
        const trkpts = xmlDoc.getElementsByTagName('trkpt');
        const points: Array<{ lat: number; lng: number }> = [];
        for (let i = 0; i < trkpts.length; i++) {
          const pt = trkpts[i];
          const lat = parseFloat(pt.getAttribute('lat') || '');
          const lng = parseFloat(pt.getAttribute('lon') || '');
          if (!isNaN(lat) && !isNaN(lng)) points.push({ lat, lng });
        }
        if (points.length > 0) {
          await addDoc(collection(db, 'strava_gps_streams'), {
            uid,
            stravaActivityId: `gpx_${Date.now()}_${file.name}`,
            activityType: 'Run',
            startDate: null,
            points,
            source: 'gpx_upload',
          });
        }
      }
      await loadStreams();
    } catch (e: any) {
      setError('GPX upload failed: ' + (e?.message || e));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }, [uid, loadStreams]);

  // Initialise map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: BELFAST,
      zoom: 11,
    });
    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.current.on('load', () => setMapReady(true));
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  // Build GeoJSON from streams and update map layers
  useEffect(() => {
    if (!mapReady || !map.current) return;
    const m = map.current;

    // Flatten all points into a single heatmap source
    const heatFeatures = streams.flatMap(s =>
      s.points.map(p => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
        properties: {},
      }))
    );

    // Route lines per activity
    const routeFeatures = streams
      .filter(s => s.points.length > 1)
      .map(s => ({
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: s.points.map(p => [p.lng, p.lat]),
        },
        properties: { id: s.id },
      }));

    const heatGeoJSON = { type: 'FeatureCollection' as const, features: heatFeatures };
    const routeGeoJSON = { type: 'FeatureCollection' as const, features: routeFeatures };

    // Add or update sources
    if (m.getSource('run-heat')) {
      (m.getSource('run-heat') as maplibregl.GeoJSONSource).setData(heatGeoJSON);
    } else {
      m.addSource('run-heat', { type: 'geojson', data: heatGeoJSON });
    }
    if (m.getSource('run-routes')) {
      (m.getSource('run-routes') as maplibregl.GeoJSONSource).setData(routeGeoJSON);
    } else {
      m.addSource('run-routes', { type: 'geojson', data: routeGeoJSON });
    }

    // Heatmap layer
    if (!m.getLayer('heat-layer')) {
      m.addLayer({
        id: 'heat-layer',
        type: 'heatmap',
        source: 'run-heat',
        paint: {
          'heatmap-weight': 1,
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 3],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 8, 16, 20],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.2, '#1a237e',
            0.4, '#1565c0',
            0.6, '#f57f17',
            0.8, '#e65100',
            1, '#b71c1c',
          ],
          'heatmap-opacity': 0.85,
        },
      });
    }

    // Routes layer
    if (!m.getLayer('routes-layer')) {
      m.addLayer({
        id: 'routes-layer',
        type: 'line',
        source: 'run-routes',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#f57f17', 'line-width': 1.5, 'line-opacity': 0.6 },
      });
    }

    // Zoom to data bounds if we have points
    if (heatFeatures.length > 0) {
      const lngs = heatFeatures.map(f => (f.geometry as any).coordinates[0]);
      const lats = heatFeatures.map(f => (f.geometry as any).coordinates[1]);
      const bounds = new maplibregl.LngLatBounds(
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      );
      m.fitBounds(bounds, { padding: 40, maxZoom: 14 });
    }
  }, [mapReady, streams]);

  // Toggle layer visibility
  useEffect(() => {
    if (!mapReady || !map.current) return;
    const m = map.current;
    if (m.getLayer('heat-layer')) m.setLayoutProperty('heat-layer', 'visibility', layer === 'heatmap' ? 'visible' : 'none');
    if (m.getLayer('routes-layer')) m.setLayoutProperty('routes-layer', 'visibility', layer === 'routes' ? 'visible' : 'none');
  }, [layer, mapReady]);

  const totalPoints = streams.reduce((acc, s) => acc + s.points.length, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '80vh' }}>
      {/* Header */}
      <div className="d-flex align-items-center justify-content-between p-3 border-bottom">
        <div>
          <h5 className="mb-0">Running Heatmap</h5>
          {!loading && (
            <small className="text-muted">
              {streams.length} {streams.length === 1 ? 'run' : 'runs'} &middot; {totalPoints.toLocaleString()} GPS points
            </small>
          )}
        </div>
        <div className="d-flex gap-2 align-items-center">
          <Form.Select
            size="sm"
            value={layer}
            onChange={e => setLayer(e.target.value as LayerMode)}
            style={{ width: 'auto' }}
          >
            <option value="heatmap">Frequency heatmap</option>
            <option value="routes">Individual routes</option>
          </Form.Select>
          <Button size="sm" variant="outline-warning" onClick={handleBackfill} disabled={backfilling}>
            {backfilling ? <><Spinner size="sm" className="me-1" />Syncing...</> : 'Sync from Strava'}
          </Button>
          <label className="btn btn-sm btn-outline-secondary mb-0" style={{ cursor: 'pointer' }}>
            {uploading ? <Spinner size="sm" /> : 'Upload GPX'}
            <input type="file" accept=".gpx" multiple onChange={handleGpxUpload} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      {error && <Alert variant="danger" className="m-3 mb-0" onClose={() => setError(null)} dismissible>{error}</Alert>}

      {/* Empty state */}
      {!loading && streams.length === 0 && (
        <Alert variant="info" className="m-3 mb-0">
          No GPS data yet. Click <strong>Sync from Strava</strong> to pull your running routes, or upload GPX files directly.
        </Alert>
      )}

      {/* Map */}
      <div style={{ flex: 1, position: 'relative', minHeight: 400 }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, background: 'rgba(0,0,0,0.15)' }}>
            <Spinner animation="border" />
          </div>
        )}
        <div ref={mapContainer} style={{ width: '100%', height: '100%', minHeight: 400 }} />
      </div>
    </div>
  );
}
