import React, { useEffect, useMemo, useState } from 'react';
import { Card, Table, Row, Col, Badge, Form, Button, Alert } from 'react-bootstrap';
import { db, functions } from '../firebase';
import { collection, query, where, orderBy, limit, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../contexts/AuthContext';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  TimeScale
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, TimeScale);

interface WorkoutDoc {
  id: string;
  ownerUid: string;
  provider: 'strava' | 'parkrun' | string;
  name?: string;
  event?: string;
  eventSlug?: string;
  eventRunSeqNumber?: number | null;
  startDate?: number; // ms
  utcStartDate?: string;
  distance_m?: number;
  movingTime_s?: number;
  elapsedTime_s?: number;
  avgHeartrate?: number | null;
  position?: number | null;
  participantsCount?: number | null;
  percentileTop?: number | null;
  hrZones?: { z1Time_s:number; z2Time_s:number; z3Time_s:number; z4Time_s:number; z5Time_s:number };
}

function fmtTime(sec?: number | null): string {
  const s = Math.floor(sec || 0);
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), ss = s%60;
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}` : `${m}:${String(ss).padStart(2,'0')}`;
}

function paceMinPerKm(w: WorkoutDoc): number | null {
  const distKm = (w.distance_m || 0) / 1000;
  const sec = (w.movingTime_s ?? w.elapsedTime_s ?? 0);
  if (!distKm || !sec) return null;
  return (sec/60) / distKm;
}

const WorkoutsDashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const [workouts, setWorkouts] = useState<WorkoutDoc[]>([]);
  const [onlyRuns, setOnlyRuns] = useState(true);
  const [providerFilter, setProviderFilter] = useState<'all'|'strava'|'parkrun'>('all');
  const [parkrunAthleteId, setParkrunAthleteId] = useState('');
  const [eventSlug, setEventSlug] = useState('');
  const [startRun, setStartRun] = useState<number | ''>('');
  const [actionMsg, setActionMsg] = useState<string>('');
  const [corrMsg, setCorrMsg] = useState<string>('');

  useEffect(() => {
    if (!currentUser) return;
    const qRef = query(
      collection(db, 'metrics_workouts'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('startDate', 'desc'),
      limit(500)
    );
    const unsub = onSnapshot(qRef, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as WorkoutDoc[];
      setWorkouts(rows);
    });
    return () => unsub();
  }, [currentUser]);

  useEffect(() => {
    const load = async () => {
      if (!currentUser) return;
      try {
        const profileSnap = await getDoc(doc(db, 'profiles', currentUser.uid));
        if (profileSnap.exists()) {
          const p = profileSnap.data() as any;
          setParkrunAthleteId(p.parkrunAthleteId || '');
        }
      } catch {}
      // Load cached UI prefs
      try {
        const cachedSlug = localStorage.getItem('running_results:eventSlug');
        const cachedRun = localStorage.getItem('running_results:startRun');
        if (cachedSlug && !eventSlug) setEventSlug(cachedSlug);
        if (cachedRun && !startRun) setStartRun(Number(cachedRun));
      } catch {}
      const pr = workouts.find(w => w.provider === 'parkrun' && w.eventSlug);
      if (pr && !eventSlug) setEventSlug(pr.eventSlug!);
    };
    load();
  }, [currentUser, workouts, eventSlug]);

  const filtered = useMemo(() => {
    return workouts.filter(w => {
      if (providerFilter !== 'all' && w.provider !== providerFilter) return false;
      return true;
    });
  }, [workouts, providerFilter]);

  const monthly = useMemo(() => {
    const map = new Map<string, { distKm: number; runs: number; parkrunMedianSec: number | null; parkrunTimes: number[]; }>();
    for (const w of filtered) {
      const ms = w.startDate || Date.parse(w.utcStartDate || '') || 0;
      const d = new Date(ms);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
      const cur = map.get(key) || { distKm: 0, runs: 0, parkrunMedianSec: null, parkrunTimes: [] };
      const distKm = (w.distance_m || 0)/1000;
      cur.distKm += distKm;
      cur.runs += 1;
      if (w.provider === 'parkrun') {
        const t = w.elapsedTime_s ?? w.movingTime_s;
        if (t) cur.parkrunTimes.push(t);
      }
      map.set(key, cur);
    }
    const arr = Array.from(map.entries()).map(([month, v]) => {
      const times = v.parkrunTimes.sort((a,b)=>a-b);
      const med = times.length ? times[Math.floor(times.length/2)] : null;
      return { month, distKm: Number(v.distKm.toFixed(1)), runs: v.runs, parkrunMedianSec: med };
    }).sort((a,b)=> a.month.localeCompare(b.month));
    return arr;
  }, [filtered]);

  const chartData = useMemo(() => ({
    labels: monthly.map(m => m.month),
    datasets: [
      {
        label: 'Monthly Distance (km)',
        data: monthly.map(m => m.distKm),
        yAxisID: 'y',
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.2)'
      },
      {
        label: 'Parkrun 5k Median (min)',
        data: monthly.map(m => m.parkrunMedianSec ? (m.parkrunMedianSec/60) : null),
        yAxisID: 'y1',
        borderColor: '#10b981',
        backgroundColor: 'rgba(16,185,129,0.2)'
      }
    ]
  }), [monthly]);

  const chartOptions:any = {
    responsive: true,
    interaction: { mode: 'index', intersect: false },
    stacked: false,
    plugins: { legend: { position: 'top' } },
    scales: {
      y: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'Distance (km)' } },
      y1: { type: 'linear', display: true, position: 'right', title: { display: true, text: '5k Median (min)' }, grid: { drawOnChartArea: false } }
    }
  };

  const call = async (name: string, payload: any = {}) => {
    try {
      setActionMsg(`${name}…`);
      const fn = httpsCallable(functions, name);
      const res = await fn(payload);
      setActionMsg(`${name}: ${JSON.stringify(res.data)}`);
    } catch (e: any) {
      setActionMsg(`${name} failed: ${e.message}`);
    }
  };

  const handleSyncParkrun = async () => {
    if (!parkrunAthleteId) {
      setActionMsg('Please set your Parkrun Athlete ID in Settings');
      return;
    }
    await call('syncParkrun', { athleteId: parkrunAthleteId });
  };

  const handleComputePercentiles = async () => {
    if (!eventSlug || !startRun) {
      setActionMsg('Enter event slug and start run #');
      return;
    }
    await call('computeParkrunPercentiles', { eventSlug, startRun: Number(startRun), onlyMissing: false, maxBack: 150 });
  };

  const handleSyncStrava = async () => {
    await call('syncStrava', {});
  };

  const handleEnrichHR = async () => {
    await call('enrichStravaHR', { days: 60 });
  };

  const handleRunAnalysis = async () => {
    try {
      setCorrMsg('Analyzing…');
      const fn = httpsCallable(functions, 'getRunFitnessAnalysis');
      const res: any = await fn({ days: 365 });
      const corr = res?.data?.correlationTimeVsAvgHR;
      setCorrMsg(`Parkrun time ↔ Avg HR correlation: ${corr != null ? Number(corr).toFixed(2) : 'n/a'}`);
    } catch (e:any) {
      setCorrMsg('Run analysis failed: ' + e.message);
    }
  };

  return (
    <div className="container-fluid py-3">
      <Row className="mb-3">
        <Col>
          <h3>Running Results</h3>
        </Col>
        <Col className="text-end">
          <Form.Select value={providerFilter} onChange={(e)=>setProviderFilter(e.target.value as any)} style={{ display: 'inline-block', width: 180 }}>
            <option value="all">All Providers</option>
            <option value="strava">Strava</option>
            <option value="parkrun">Parkrun</option>
          </Form.Select>
        </Col>
      </Row>

      <Card className="mb-3">
        <Card.Body>
          <Row className="g-2 align-items-end">
            <Col md="auto">
              <strong>Actions</strong>
            </Col>
            <Col md="auto">
              <Button size="sm" variant="primary" onClick={handleSyncParkrun}>Sync Parkrun</Button>
            </Col>
            <Col md="auto">
              <Form.Control size="sm" placeholder="Event slug (e.g., ormeau)" value={eventSlug} onChange={(e)=>{ setEventSlug(e.target.value); try{ localStorage.setItem('running_results:eventSlug', e.target.value);}catch{}}} />
            </Col>
            <Col md="auto">
              <Form.Control size="sm" type="number" placeholder="Start run #" value={startRun} onChange={(e)=>{ const v = e.target.value ? Number(e.target.value) : ''; setStartRun(v); try{ localStorage.setItem('running_results:startRun', String(v||'')); }catch{}}} />
            </Col>
            <Col md="auto">
              <Button size="sm" variant="outline-primary" onClick={handleComputePercentiles}>Compute Percentiles</Button>
            </Col>
            <Col md="auto">
              <Button size="sm" variant="secondary" onClick={handleSyncStrava}>Sync Strava</Button>
            </Col>
            <Col md="auto">
              <Button size="sm" variant="outline-secondary" onClick={handleEnrichHR}>Enrich HR Zones</Button>
            </Col>
            <Col md="auto">
              <Button size="sm" variant="outline-success" onClick={handleRunAnalysis}>Run Analysis</Button>
            </Col>
            <Col md="auto">
              <Button size="sm" variant="outline-dark" onClick={async ()=>{
                setActionMsg('Enabling automatic fitness updates…');
                try { const fn = httpsCallable(functions, 'enableFitnessAutomationDefaults'); const res:any = await fn({}); setActionMsg('Automation enabled: ' + JSON.stringify(res.data)); } catch(e:any){ setActionMsg('Enable automation failed: '+e.message); }
              }}>Enable Auto Fitness Updates</Button>
            </Col>
          </Row>
          {actionMsg && <Alert variant="light" className="mt-2 mb-0 py-1"><small>{actionMsg}</small></Alert>}
          {corrMsg && <Alert variant="light" className="mt-2 mb-0 py-1"><small>{corrMsg}</small></Alert>}
          <div className="text-muted mt-2" style={{fontSize:'0.85rem'}}>
            Tip: set your Parkrun Athlete ID in Settings → System Preferences → Fitness & Integrations.
          </div>
        </Card.Body>
      </Card>

      <Card className="mb-3">
        <Card.Body>
          <Line data={chartData} options={chartOptions} />
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <strong>Recent Workouts</strong>
        </Card.Header>
        <Card.Body className="p-0">
          <Table responsive hover className="mb-0">
            <thead>
              <tr>
                <th>Date</th>
                <th>Provider</th>
                <th>Event/Name</th>
                <th>Distance (km)</th>
                <th>Time</th>
                <th>Pace (min/km)</th>
                <th>Avg HR</th>
                <th>Pos</th>
                <th>Partic.</th>
                <th>Percentile</th>
                <th>Z4/Z5 (min)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(w => {
                const date = w.startDate ? new Date(w.startDate) : (w.utcStartDate ? new Date(w.utcStartDate) : null);
                const pace = paceMinPerKm(w);
                const z4min = w.hrZones ? (w.hrZones.z4Time_s/60) : 0;
                const z5min = w.hrZones ? (w.hrZones.z5Time_s/60) : 0;
                return (
                  <tr key={w.id}>
                    <td>{date ? date.toLocaleDateString() : ''}</td>
                    <td>
                      <Badge bg={w.provider==='parkrun' ? 'success' : 'primary'}>{w.provider}</Badge>
                    </td>
                    <td>
                      {w.provider==='parkrun' ? (w.event || w.name || '-') : (w.name || w.event || '-')}
                    </td>
                    <td>{((w.distance_m||0)/1000).toFixed(2)}</td>
                    <td>{fmtTime(w.movingTime_s ?? w.elapsedTime_s)}</td>
                    <td>{pace ? pace.toFixed(2) : '-'}</td>
                    <td>{w.avgHeartrate ?? '-'}</td>
                    <td>{w.position ?? '-'}</td>
                    <td>{w.participantsCount ?? '-'}</td>
                    <td>{w.percentileTop != null ? `${w.percentileTop}%` : '-'}</td>
                    <td>{(z4min+z5min) ? `${(z4min).toFixed(1)}/${(z5min).toFixed(1)}` : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </div>
  );
};

export default WorkoutsDashboard;
