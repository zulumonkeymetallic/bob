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
  // Recovered function helpers
  const [goalIdForApproval, setGoalIdForApproval] = useState('');
  const [approveAllLimit, setApproveAllLimit] = useState<number>(3);
  const [storyIdForTasks, setStoryIdForTasks] = useState('');
  const [monzoMerchantKey, setMonzoMerchantKey] = useState('');
  const [monzoDecision, setMonzoDecision] = useState<'keep'|'reduce'|'cancel'>('keep');
  const [monzoNote, setMonzoNote] = useState('');

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
      const createSession = httpsCallable(functions, 'createMonzoOAuthSession');
      const res: any = await createSession({ origin: window.location.origin });
      const data = res?.data || res;
      const startUrl = data?.startUrl || (data?.sessionId ? `${window.location.origin}/api/monzo/start?session=${data.sessionId}` : null);
      if (!startUrl) throw new Error('Missing session URL');
      const popup = window.open(startUrl, 'monzo-oauth', 'width=500,height=700');
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

  const handleSyncMonzo = () => {
    const syncMonzo = httpsCallable(functions, 'syncMonzo');
    logMessage('Syncing Monzo data...');
    setMonzoStatus('Running Monzo sync...');
    syncMonzo({})
      .then(result => {
        logMessage(`Monzo sync: ${JSON.stringify(result.data)}`);
        setMonzoStatus('✅ Monzo sync complete');
      })
      .catch(error => {
        logMessage(`Monzo sync failed: ${error.message}`);
        setMonzoStatus('❌ Monzo sync failed: ' + error.message);
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

  // ===== Recovered callable function bridges =====
  const handleApproveGoalResearch = async () => {
    try {
      if (!goalIdForApproval.trim()) { logMessage('Enter a goalId first'); return; }
      const fn = httpsCallable(functions, 'approveGoalResearch');
      logMessage(`Approving goal research for ${goalIdForApproval}...`);
      try {
        const res: any = await fn({ goalId: goalIdForApproval.trim(), schedule: true });
        logMessage(`approveGoalResearch: ${JSON.stringify(res.data)}`);
      } catch (err: any) {
        // Fallback: run orchestrateGoalPlanning which generates stories/tasks and schedules
        logMessage(`approveGoalResearch unavailable, falling back to orchestrateGoalPlanning…`);
        const alt = httpsCallable(functions, 'orchestrateGoalPlanning');
        const res2: any = await alt({ goalId: goalIdForApproval.trim(), researchOnly: false });
        logMessage(`orchestrateGoalPlanning: ${JSON.stringify(res2.data)}`);
      }
    } catch (e: any) {
      logMessage(`approveGoalResearch failed: ${e?.message || e}`);
    }
  };

  const handleApproveAllGoalResearch = async () => {
    try {
      const fn = httpsCallable(functions, 'approveAllGoalResearch');
      logMessage(`Approving all pending goal research (limit ${approveAllLimit})...`);
      const res: any = await fn({ schedule: true, limit: approveAllLimit });
      logMessage(`approveAllGoalResearch: ${JSON.stringify(res.data)}`);
    } catch (e: any) {
      logMessage(`approveAllGoalResearch failed: ${e?.message || e}`);
    }
  };

  const handleGenerateTasksForStory = async () => {
    try {
      if (!storyIdForTasks.trim()) { logMessage('Enter a storyId first'); return; }
      const fn = httpsCallable(functions, 'generateTasksForStory');
      logMessage(`Generating tasks for story ${storyIdForTasks}...`);
      try {
        const res: any = await fn({ storyId: storyIdForTasks.trim() });
        logMessage(`generateTasksForStory: ${JSON.stringify(res.data)}`);
      } catch (err: any) {
        // Fallback: orchestrateStoryPlanning will generate tasks and schedule
        logMessage(`generateTasksForStory unavailable, falling back to orchestrateStoryPlanning…`);
        const alt = httpsCallable(functions, 'orchestrateStoryPlanning');
        const res2: any = await alt({ storyId: storyIdForTasks.trim(), research: false });
        logMessage(`orchestrateStoryPlanning: ${JSON.stringify(res2.data)}`);
      }
    } catch (e: any) {
      logMessage(`generateTasksForStory failed: ${e?.message || e}`);
    }
  };

  const handleSetMonzoSubscriptionOverride = async () => {
    try {
      if (!monzoMerchantKey.trim()) { logMessage('Enter a merchant key'); return; }
      const fn = httpsCallable(functions, 'setMonzoSubscriptionOverride');
      logMessage(`Setting Monzo subscription override for ${monzoMerchantKey} → ${monzoDecision}...`);
      const res: any = await fn({ merchantKey: monzoMerchantKey.trim(), decision: monzoDecision, note: monzoNote || undefined });
      logMessage(`setMonzoSubscriptionOverride: ${JSON.stringify(res.data)}`);
    } catch (e: any) {
      logMessage(`setMonzoSubscriptionOverride failed: ${e?.message || e}`);
    }
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
            <button className="btn btn-primary" onClick={handleSyncMonzo}>Sync Monzo</button>
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
          <h5 className="card-title">Recovered Functions (deployed-only)</h5>
          <div className="mb-3">
            <label className="form-label">Goal ID (approveGoalResearch)</label>
            <input className="form-control" value={goalIdForApproval} onChange={e=>setGoalIdForApproval(e.target.value)} placeholder="goal document id" />
            <button className="btn btn-primary mt-2" onClick={handleApproveGoalResearch}>Approve Goal Research</button>
          </div>
          <div className="mb-3">
            <label className="form-label">Approve All (limit)</label>
            <input type="number" className="form-control" value={approveAllLimit} onChange={e=>setApproveAllLimit(Number(e.target.value)||1)} min={1} max={15} />
            <button className="btn btn-secondary mt-2" onClick={handleApproveAllGoalResearch}>Approve All Goal Research</button>
          </div>
          <div className="mb-3">
            <label className="form-label">Story ID (generateTasksForStory)</label>
            <input className="form-control" value={storyIdForTasks} onChange={e=>setStoryIdForTasks(e.target.value)} placeholder="story document id" />
            <button className="btn btn-primary mt-2" onClick={handleGenerateTasksForStory}>Generate Tasks For Story</button>
          </div>
          <div className="mb-2">
            <label className="form-label">Monzo Subscription Override</label>
            <div className="row g-2">
              <div className="col-sm-4">
                <input className="form-control" value={monzoMerchantKey} onChange={e=>setMonzoMerchantKey(e.target.value)} placeholder="merchant key (normalized)" />
              </div>
              <div className="col-sm-3">
                <select className="form-select" value={monzoDecision} onChange={e=>setMonzoDecision(e.target.value as any)}>
                  <option value="keep">keep</option>
                  <option value="reduce">reduce</option>
                  <option value="cancel">cancel</option>
                </select>
              </div>
              <div className="col-sm-5">
                <input className="form-control" value={monzoNote} onChange={e=>setMonzoNote(e.target.value)} placeholder="optional note" />
              </div>
            </div>
            <button className="btn btn-warning mt-2" onClick={handleSetMonzoSubscriptionOverride}>Set Override</button>
          </div>
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
