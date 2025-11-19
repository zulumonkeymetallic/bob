#!/usr/bin/env node
// Count duplicates by exact title string (case-sensitive by default; use --ci for case-insensitive)

const admin = require('firebase-admin');

function args() {
  const a = {}; const av = process.argv;
  for (let i=2;i<av.length;i++){if(av[i].startsWith('--')){const k=av[i].slice(2);const n=av[i+1];if(n && !n.startsWith('--')){a[k]=n;i++;} else {a[k]=true;}}}
  return a;
}

async function main(){
  const { uid, minCount='2', limit='50', ci } = args();
  if(!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  let q = db.collection('tasks');
  if(uid) q = q.where('ownerUid','==',String(uid));
  const snap = await q.get();
  const map = new Map();
  for(const d of snap.docs){
    const t=d.data()||{}; const raw=String(t.title||'');
    const key = ci ? raw.toLowerCase() : raw;
    if(!key) continue;
    const arr = map.get(key) || []; arr.push({id:d.id, ref:t.ref||t.reference||d.id, status:t.status||0});
    map.set(key, arr);
  }
  const dupes = Array.from(map.entries()).filter(([,arr])=>arr.length>=Number(minCount)).sort((a,b)=>b[1].length-a[1].length).slice(0,Number(limit));
  console.log(JSON.stringify({ totalTasks:snap.size, duplicateGroups:dupes.length, top:dupes.map(([title,arr])=>({title,count:arr.length,sample:arr.slice(0,5)})) },null,2));
}

main().catch(e=>{console.error(e?.message||e);process.exit(1)});

