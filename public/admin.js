(function boot(){
  var s1 = document.createElement('script');
  s1.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js';
  s1.onload = function(){
    var s2 = document.createElement('script');
    s2.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js';
    s2.onload = function(){
      var s3 = document.createElement('script');
      s3.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions-compat.js';
      s3.onload = function(){
        var s4 = document.createElement('script');
        s4.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage-compat.js';
        s4.onload = init;
        document.head.appendChild(s4);
      };
      document.head.appendChild(s3);
    };
    document.head.appendChild(s2);
  };
  document.head.appendChild(s1);
})();

function readXlsx(file, cb){
  var reader = new FileReader();
  reader.onload = function(e){
    var data = new Uint8Array(e.target.result);
    var wb = XLSX.read(data, {type: 'array'});
    var first = wb.SheetNames[0];
    var ws = wb.Sheets[first];
    var json = XLSX.utils.sheet_to_json(ws, {defval: ''});
    cb(json);
  };
  reader.readAsArrayBuffer(file);
}

function init(){
  var config = { apiKey: "AIzaSyDsuR1TNHUE74awnbFaU5cA0FGya0voVFk", authDomain: "bob20250810.firebaseapp.com", projectId: "bob20250810" };
  firebase.initializeApp(config);
  var auth = firebase.auth();
  var db = firebase.firestore();
  var functions = firebase.functions("europe-west2");
  var storage = firebase.storage();

  var logEl = document.getElementById('log');
  function log(msg){ logEl.textContent += msg + "\n"; }

  function uploadOriginalFileIfRequested(file, uid) {
    var cb = document.getElementById('uploadToStorage');
    if (!cb || !cb.checked || !file || !uid) return Promise.resolve(null);
    var path = 'uploads/' + uid + '/' + Date.now() + '-' + file.name;
    var ref = storage.ref().child(path);
    var metadata = { contentType: file.type || 'application/octet-stream' };
    return ref.put(file, metadata)
      .then(function(snap){ return snap.ref.getDownloadURL(); })
      .then(function(url){ log('Uploaded source to Storage: ' + path); return url; })
      .catch(function(e){ log('Storage upload failed: ' + e.message); return null; });
  }

  document.getElementById('upload').onclick = function(){
    var radios = document.querySelectorAll('input[name="type"]:checked');
    var type = radios.length ? radios[0].value : 'goals';
    var file = document.getElementById('file').files[0];
    var pasted = document.getElementById('json').value.trim();
    var uid = auth.currentUser ? auth.currentUser.uid : null;

    var proceed = function(items){
      if (!items || !items.length) { log('No rows.'); return; }
      if (items.length > 500) items = items.slice(0,500);
      var fn = functions.httpsCallable('importItems');
      log('Importing '+items.length+' '+type+'...');
      fn({ type: type, items: items }).then(function(res){
        log('Done: '+ JSON.stringify(res.data));
      }).catch(function(e){ console.error(e); log('Error: '+ e.message); });
    };

    if (file) {
      var ext = (file.name.split('.').pop() || '').toLowerCase();
      uploadOriginalFileIfRequested(file, uid).then(function(){
        if (ext === 'csv') {
          Papa.parse(file, { header: true, skipEmptyLines: true,
            complete: function(results){ proceed(results.data || []); },
            error: function(err){ log('CSV parse error: ' + err); }
          });
        } else if (ext === 'xlsx') {
          readXlsx(file, proceed);
        } else if (ext === 'json') {
          var r = new FileReader();
          r.onload = function(){ try { proceed(JSON.parse(r.result)); } catch(e){ log('JSON error: '+e); } };
          r.readAsText(file);
        } else { log('Unsupported file extension: ' + ext); }
      });
    } else if (pasted) {
      try { proceed(JSON.parse(pasted)); } catch(e){ log('JSON error: '+e); }
    } else { log('Choose a file or paste JSON.'); }
  };

  var currentUid = null;
  function loadProfile(uid){
    db.collection('profiles').doc(uid).get().then(function(doc){
      var d = doc.exists ? doc.data() : {};
      document.getElementById('traktUser').value = d.traktUser || '';
      document.getElementById('steamId').value = d.steamId || '';
    });
  }

  document.getElementById('saveProfile').onclick = function(){
    if (!currentUid) { log('Sign in first.'); return; }
    var ref = db.collection('profiles').doc(currentUid);
    var payload = {
      ownerUid: currentUid,
      traktUser: document.getElementById('traktUser').value.trim(),
      steamId: document.getElementById('steamId').value.trim(),
      updatedAt: new Date().toISOString()
    };
    ref.set(payload, { merge: true }).then(function(){ log('Saved IDs.'); })
      .catch(function(e){ log('Save failed: ' + e.message); });
  };

  document.getElementById('syncTrakt').onclick = function(){
    if (!currentUid) { log('Sign in first.'); return; }
    functions.httpsCallable('syncTrakt')({}).then(function(r){ log('Trakt: ' + JSON.stringify(r.data)); })
      .catch(function(e){ log('Trakt error: ' + e.message); });
  };
  document.getElementById('syncSteam').onclick = function(){
    if (!currentUid) { log('Sign in first.'); return; }
    functions.httpsCallable('syncSteam')({}).then(function(r){ log('Steam: ' + JSON.stringify(r.data)); })
      .catch(function(e){ log('Steam error: ' + e.message); });
  };

  auth.onAuthStateChanged(function(u){
    currentUid = u ? u.uid : null;
    if (!u) log('Not signed in. Open the main app and sign in first.');
    else { log('Signed in as ' + (u.email || u.uid)); loadProfile(u.uid); }
  });
}
