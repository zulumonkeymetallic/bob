import React, { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { User } from 'firebase/auth';

const Admin = () => {
  const [traktUser, setTraktUser] = useState('');
  const [steamId, setSteamId] = useState('');
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
      await setDoc(profileRef, { traktUser, steamId }, { merge: true });
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

    const functions = getFunctions();
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
    const functions = getFunctions();
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
    const functions = getFunctions();
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
          <button className="btn btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-body">
          <h5 className="card-title">Sync</h5>
          <button className="btn btn-primary me-2" onClick={handleSyncTrakt}>Sync Trakt</button>
          <button className="btn btn-primary" onClick={handleSyncSteam}>Sync Steam</button>
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
        </div>
      </div>
    </div>
  );
};

export default Admin;