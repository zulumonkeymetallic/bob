#!/usr/bin/env node
// Generate react-app/src/firebase.ts for CI/preview builds
// Values come from env if provided, else fall back to project defaults.

const fs = require('fs');
const path = require('path');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'bob20250810';
const APP_ID = process.env.FIREBASE_APP_ID || '1:944624475821:web:95c596038cb9ebdf7df024';
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${PROJECT_ID}.appspot.com`;
const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyDsuR1TNHUE74awnbFaU5cA0FGya0voVFk';
const AUTH_DOMAIN = process.env.FIREBASE_AUTH_DOMAIN || `${PROJECT_ID}.firebaseapp.com`;
const MSG_SENDER_ID = process.env.FIREBASE_MESSAGING_SENDER_ID || '944624475821';
const REGION = process.env.FIREBASE_FUNCTIONS_REGION || 'europe-west2';

const outFile = path.join(__dirname, '..', 'react-app', 'src', 'firebase.ts');

const content = `import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

const firebaseConfig = {
  projectId: "${PROJECT_ID}",
  appId: "${APP_ID}",
  storageBucket: "${STORAGE_BUCKET}",
  apiKey: "${API_KEY}",
  authDomain: "${AUTH_DOMAIN}",
  messagingSenderId: "${MSG_SENDER_ID}",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
const functions = getFunctions(app, '${REGION}');

// Optional emulator hookups controlled by env
if (typeof window !== 'undefined' && process.env.REACT_APP_USE_FIREBASE_EMULATOR === 'true') {
  try { connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true }); } catch {}
  try { connectFirestoreEmulator(db, 'localhost', 8080); } catch {}
  try { connectFunctionsEmulator(functions, 'localhost', 5001); } catch {}
}

export { db, auth, storage, functions, firebaseConfig };
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, content, 'utf8');
console.log(`[generate-firebase-config] Wrote ${outFile}`);

