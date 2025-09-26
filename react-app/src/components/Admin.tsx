import React, { useState, useEffect } from 'react';
import { db, auth, functions, firebaseConfig } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { User } from 'firebase/auth';

const Admin = () => {
  const [traktUser, setTraktUser] = useState('');
  const [steamId, setSteamId] = useState('');
  const [parkrunAthleteId, setParkrunAthleteId] = useState('');
  const [stravaStatus, setStravaStatus] = useState<string>('');
  const [monzoStatus, setMonzoStatus] = useState<string>('');
  const [fitnessOverview, setFitnessOverview] = useState<any>(null);
  const [runAnalysis, setRunAnalysis] = useState<any>(null);
  const [eventSlug, setEventSlug] = useState('ormeau');
  const [startRun, setStartRun] = useState<number>(552);
  const [user, setUser] = useState<User | null>(null);
  const [log, setLog] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dataType, setDataType] = useState('goals');

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => {
      if (user) {
        setUser(user);
        const profileRef = doc(db, 'profiles', user.uid);
        getDoc(profileRef).then(docSnap => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            setTraktUser(data.traktUser || '');
            setSteamId(data.steamId || '');
            setParkrunAthleteId((data as any).parkrunAthleteId || '');
          }
        });
      } else {
        setUser(null);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleSave = async () => {
    if (user) {
      const profileRef = doc(db, 'profiles', user.uid);
      await setDoc(profileRef, { ownerUid: user.uid, traktUser, steamId, parkrunAthleteId }, { merge: true });
      logMessage('Profile saved!');
    }
  };

  const logMessage = (message: string) => {
    setLog(prevLog => prevLog + message + '\n');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFile(e.target.files[0]);
    }
  };

  const handleImport = () => {
    if (!file) {
      logMessage('Please select a file.');
      return;
    }

    const importItems = httpsCallable(functions, 'importItems');

    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      let items: any[] = [];
      const ext = file.name.split('.').pop()?.toLowerCase();

      if (ext === 'json') {
        items = JSON.parse(data as string);
      } else if (ext === 'xlsx') {
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        items = XLSX.utils.sheet_to_json(worksheet);
      } else if (ext === 'csv') {
        Papa.parse(data as string, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            items = results.data;
          },
        });
      }

      if (items.length > 0) {
        logMessage(`Importing ${items.length} ${dataType}...`);
        importItems({ type: dataType, items })
          .then(result => {
            logMessage(`Import successful: ${JSON.stringify(result.data)}`);
          })
          .catch(error => {
            logMessage(`Import failed: ${error.message}`);
          });
      }
    };

    if (file.name.split('.').pop()?.toLowerCase() === 'xlsx') {
      reader.readAsBinaryString(file);
    } else {
      reader.readAsText(file);
    }
  };

  const handleSyncTrakt = () => {
    const syncTrakt = httpsCallable(functions, 'syncTrakt');
    logMessage('Syncing Trakt...');
    syncTrakt()
      .then(result => {
        logMessage(`Trakt sync successful: ${JSON.stringify(result.data)}`);
      })
      .catch(error => {
        logMessage(`Trakt sync failed: ${error.message}`);
      });
  };

  const handleSyncSteam = () => {
    const syncSteam = httpsCallable(functions, 'syncSteam');
    logMessage('Syncing Steam...');
    syncSteam()
      .then(result => {
        logMessage(`Steam sync successful: ${JSON.stringify(result.data)}`);
      })
      .catch(error => {
        logMessage(`Steam sync failed: ${error.message}`);
      });
  };

  const handleConnectStrava = async () => {
    if (!user) return;
    try {
      setStravaStatus('Starting Strava OAuth...');
      const nonce = Math.random().toString(36).slice(2);
      // Build Functions URL from configured region + project
      const region = 'europe-west2';
      const projectId = (window as any).FIREBASE_PROJECT_ID || firebaseConfig.projectId;
      const url = `https://${region}-${projectId}.cloudfunctions.net/stravaOAuthStart?uid=${user.uid}&nonce=${nonce}`;
      const popup = window.open(url, 'strava-oauth', 'width=500,height=700');
      const check = setInterval(() => {
        if (popup?.closed) {
          clearInterval(check);
          setTimeout(() => setStravaStatus('Strava connected (if you completed the flow).'), 1500);
        }
      }, 800);
    } catch (e: any) {
      setStravaStatus('Failed to start Strava OAuth: ' + e.message);
    }
  };

  const handleConnectMonzo = async () => {
    if (!user) return;
    try {
      setMonzoStatus('Starting Monzo OAuth...');
      const nonce = Math.random().toString(36).slice(2);
      const region = 'europe-west2';
      const projectId = (window as any).FIREBASE_PROJECT_ID || firebaseConfig.projectId;
      const url = `https://${region}-${projectId}.cloudfunctions.net/monzoOAuthStart?uid=${user.uid}&nonce=${nonce}`;
      const popup = window.open(url, 'monzo-oauth', 'width=500,height=700');
      const check = setInterval(() => {
        if (popup?.closed) {
          clearInterval(check);
          setTimeout(() => setMonzoStatus('Monzo connected (if you completed the flow).'), 1500);
        }
      }, 800);
    } catch (e: any) {
      setMonzoStatus('Failed to start Monzo OAuth: ' + e.message);
    }
  };

  const handleSyncStrava = () => {
    const syncStrava = httpsCallable(functions, 'syncStrava');
    logMessage('Syncing Strava activities...');
    syncStrava({})
      .then(result => {
        logMessage(`Strava sync: ${JSON.stringify(result.data)}`);
        setStravaStatus('✅ Strava sync complete');
      })
      .catch(error => {
        logMessage(`Strava sync failed: ${error.message}`);
        setStravaStatus('❌ Strava sync failed: ' + error.message);
      });
  };

  const handleSyncParkrun = () => {
    if (!user) return;
    const syncParkrun = httpsCallable(functions, 'syncParkrun');
    const payload: any = {};
    if (parkrunAthleteId) payload.athleteId = parkrunAthleteId;
    logMessage(`Syncing Parkrun (${parkrunAthleteId || 'no ID set'})...`);
    syncParkrun(payload)
      .then(result => {
        logMessage(`Parkrun sync: ${JSON.stringify(result.data)}`);
      })
      .catch(error => {
        logMessage(`Parkrun sync failed: ${error.message}`);
      });
  };

  const handleGetFitnessOverview = () => {
    const getFitnessOverview = httpsCallable(functions, 'getFitnessOverview');
    setFitnessOverview(null);
    logMessage('Calculating fitness overview (last 90 days)...');
    getFitnessOverview({ days: 90 })
      .then(result => {
        setFitnessOverview(result.data);
        logMessage(`Fitness overview: ${JSON.stringify(result.data)}`);
      })
      .catch(error => {
        logMessage(`Fitness overview failed: ${error.message}`);
      });
  };

  const handleEnrichHR = () => {
    const enrichStravaHR = httpsCallable(functions, 'enrichStravaHR');
    logMessage('Enriching Strava workouts with HR zones (last 30 days)...');
    enrichStravaHR({ days: 30 })
      .then(res => logMessage(`HR enrichment: ${JSON.stringify(res.data)}`))
      .catch(err => logMessage(`HR enrichment failed: ${err.message}`));
  };

  const handleRunFitnessAnalysis = () => {
    const getRunFitnessAnalysis = httpsCallable(functions, 'getRunFitnessAnalysis');
    setRunAnalysis(null);
    logMessage('Computing run fitness analysis (Parkrun ↔ Strava HR)...');
    getRunFitnessAnalysis({ days: 180 })
      .then(res => {
        setRunAnalysis(res.data);
        logMessage(`Run analysis: ${JSON.stringify(res.data)}`);
      })
      .catch(err => logMessage(`Run analysis failed: ${err.message}`));
  };

  const handleComputeParkrunPercentiles = () => {
    const fn = httpsCallable(functions, 'computeParkrunPercentiles');
    logMessage(`Computing Parkrun percentiles for ${eventSlug} from run #${startRun}...`);
    fn({ eventSlug, startRun, onlyMissing: false, maxBack: 120 })
      .then(res => logMessage(`Percentiles update: ${JSON.stringify(res.data)}`))
      .catch(err => logMessage(`Percentiles update failed: ${err.message}`));
  };

  return (
    <div>
      <h2>Admin Page</h2>
      <div className="card mb-3">
        <div className="card-body">
          <h5 className="card-title">User Settings</h5>
          <div className="mb-3">
            <label htmlFor="traktUser" className="form-label">Trakt Username</label>
            <input
              type="text"
              className="form-control"
              id="traktUser"
              value={traktUser}
              onChange={e => setTraktUser(e.target.value)}
            />
          </div>
          <div className="mb-3">
            <label htmlFor="steamId" className="form-label">SteamID</label>
            <input
              type="text"
              className="form-control"
              id="steamId"
              value={steamId}
              onChange={e => setSteamId(e.target.value)}
            />
          </div>
          <div className="mb-3">
            <label htmlFor="parkrunAthleteId" className="form-label">Parkrun Athlete ID</label>
            <input
              type="text"
              className="form-control"
              id="parkrunAthleteId"
              value={parkrunAthleteId}
              onChange={e => setParkrunAthleteId(e.target.value)}
            />
            <div className="form-text">Found in your Parkrun profile URL (athleteNumber=...)</div>
          </div>
          <button className="btn btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-body">
          <h5 className="card-title">Sync</h5>
          <button className="btn btn-primary me-2" onClick={handleSyncTrakt}>Sync Trakt</button>
          <button className="btn btn-primary" onClick={handleSyncSteam}>Sync Steam</button>
          <div className="mt-3 d-flex gap-2 align-items-center">
            <button className="btn btn-outline-primary" onClick={handleConnectStrava}>Connect Strava</button>
            <button className="btn btn-primary" onClick={handleSyncStrava}>Sync Strava</button>
            {stravaStatus && <span className="ms-2 small text-muted">{stravaStatus}</span>}
          </div>
          <div className="mt-3 d-flex gap-2 align-items-center">
            <button className="btn btn-outline-primary" onClick={handleConnectMonzo}>Connect Monzo</button>
            {monzoStatus && <span className="ms-2 small text-muted">{monzoStatus}</span>}
          </div>
          <div className="mt-3 d-flex gap-2 align-items-center">
            <button className="btn btn-primary" onClick={handleSyncParkrun}>Sync Parkrun</button>
          </div>
          <div className="mt-3">
            <div className="row g-2 align-items-end">
              <div className="col-auto">
                <label className="form-label">Event Slug</label>
                <input className="form-control" value={eventSlug} onChange={e=>setEventSlug(e.target.value)} placeholder="e.g., ormeau" />
              </div>
              <div className="col-auto">
                <label className="form-label">Start Run #</label>
                <input className="form-control" type="number" value={startRun} onChange={e=>setStartRun(parseInt(e.target.value||'0'))} />
              </div>
              <div className="col-auto">
                <button className="btn btn-outline-primary" onClick={handleComputeParkrunPercentiles}>Compute Percentiles</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <h5 className="card-title">Import Data</h5>
          <div className="mb-3">
            <label htmlFor="file" className="form-label">Select file</label>
            <input type="file" className="form-control" id="file" onChange={handleFileChange} />
          </div>
          <div className="mb-3">
            <label htmlFor="dataType" className="form-label">Data type</label>
            <select
              className="form-select"
              id="dataType"
              value={dataType}
              onChange={e => setDataType(e.target.value)}
            >
              <option value="goals">Goals</option>
              <option value="okrs">OKRs</option>
              <option value="tasks">Tasks</option>
              <option value="resources">Resources</option>
              <option value="trips">Trips</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={handleImport}>Import</button>
        </div>
      </div>

      <div className="card mt-3">
        <div className="card-body">
          <h5 className="card-title">Log</h5>
          <pre>{log}</pre>
          <div className="mt-2">
            <button className="btn btn-outline-secondary" onClick={handleGetFitnessOverview}>Get Fitness Overview</button>
            <button className="btn btn-outline-secondary ms-2" onClick={handleEnrichHR}>Enrich HR Zones</button>
            <button className="btn btn-outline-secondary ms-2" onClick={handleRunFitnessAnalysis}>Run Fitness Analysis</button>
          </div>
          {fitnessOverview && (
            <div className="mt-3">
              <h6>Fitness Score: {fitnessOverview.fitnessScore}</h6>
              <div className="small text-muted">Last 30d Distance: {fitnessOverview.last30?.distanceKm} km, Avg Pace: {fitnessOverview.last30?.avgPaceMinPerKm} min/km</div>
              <div className="small text-muted">HRV 7d Avg: {fitnessOverview.hrv?.last7Avg}, 30d Avg: {fitnessOverview.hrv?.last30Avg}, Trend: {fitnessOverview.hrv?.trendPct}%</div>
              <div className="small text-muted">HR Zones (sec): Z1 {fitnessOverview.hrZones?.z1Time_s}, Z2 {fitnessOverview.hrZones?.z2Time_s}, Z3 {fitnessOverview.hrZones?.z3Time_s}, Z4 {fitnessOverview.hrZones?.z4Time_s}, Z5 {fitnessOverview.hrZones?.z5Time_s}</div>
            </div>
          )}
          {runAnalysis && (
            <div className="mt-3">
              <h6>Run Fitness Analysis</h6>
              <div className="small text-muted">Pairs: {runAnalysis.pairs?.length || 0}, Corr(Time↔AvgHR): {runAnalysis.correlationTimeVsAvgHR?.toFixed ? runAnalysis.correlationTimeVsAvgHR.toFixed(2) : runAnalysis.correlationTimeVsAvgHR}</div>
              <div className="small text-muted">HR Zones (sec) in matched runs: Z1 {runAnalysis.hrZonesAggregate?.z1Time_s}, Z2 {runAnalysis.hrZonesAggregate?.z2Time_s}, Z3 {runAnalysis.hrZonesAggregate?.z3Time_s}, Z4 {runAnalysis.hrZonesAggregate?.z4Time_s}, Z5 {runAnalysis.hrZonesAggregate?.z5Time_s}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Admin;
export {};
