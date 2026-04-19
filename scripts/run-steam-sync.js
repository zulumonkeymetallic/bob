#!/usr/bin/env node
/*
  Trigger the deployed `syncSteam` callable for a user.

  Usage:
    node scripts/run-steam-sync.js --uid <UID> [--serviceAccount /abs/path/to/sa.json]
*/

const path = require('path');
const fs = require('fs');

let admin;
try {
  admin = require('firebase-admin');
} catch (e) {
  try { admin = require(path.join(process.cwd(), 'functions/node_modules/firebase-admin')); }
  catch (e2) { throw e; }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      if (a.includes('=')) {
        const [k, v] = a.slice(2).split('=');
        args[k] = v;
      } else {
        const k = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) { args[k] = next; i++; }
        else { args[k] = true; }
      }
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const uid = String(args.uid || '').trim();
  if (!uid) {
    console.error('Error: --uid <firebase-auth-uid> is required');
    process.exit(1);
  }

  const saDefault = path.join(process.env.HOME || process.env.USERPROFILE || '', '.secrets/bob/bob20250810-service-account.json');
  const saPath = String(args.serviceAccount || saDefault);
  if (!fs.existsSync(saPath)) {
    console.error(`Error: service account JSON not found at ${saPath}`);
    process.exit(1);
  }

  const serviceAccount = require(saPath);
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: 'bob20250810',
    });
  }

  const customToken = await admin.auth().createCustomToken(uid);
  const apiKey = 'AIzaSyDsuR1TNHUE74awnbFaU5cA0FGya0voVFk';
  const region = 'europe-west2';
  const projectId = 'bob20250810';

  const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`;
  const signInRes = await fetch(signInUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  if (!signInRes.ok) {
    const text = await signInRes.text();
    throw new Error(`signInWithCustomToken failed: ${signInRes.status} ${text}`);
  }
  const signInJson = await signInRes.json();
  const idToken = signInJson.idToken;
  if (!idToken) throw new Error('No idToken in sign-in response');

  const fnUrl = `https://${region}-${projectId}.cloudfunctions.net/syncSteam`;
  const fnRes = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify({ data: {} }),
  });
  if (!fnRes.ok) {
    const text = await fnRes.text();
    throw new Error(`syncSteam call failed: ${fnRes.status} ${text}`);
  }
  const payload = await fnRes.json();
  console.log(JSON.stringify(payload?.result ?? payload, null, 2));
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
