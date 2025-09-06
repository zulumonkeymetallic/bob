// Motion-style UI with server-side Google Calendar OAuth & sync
(function loadSdk() {
  var s = document.createElement('script');
  s.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js';
  s.onload = function () {
    var s2 = document.createElement('script');
    s2.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js';
    s2.onload = function () {
      var s3 = document.createElement('script');
      s3.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js';
      s3.onload = function () {
        var s4 = document.createElement('script');
        s4.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions-compat.js';
        s4.onload = init;
        document.head.appendChild(s4);
      };
      document.head.appendChild(s3);
    };
    document.head.appendChild(s2);
  };
  s.onerror = function() {
    // Firebase failed to load, initialize basic navigation anyway
    initBasicNavigation();
  };
  document.head.appendChild(s);
})();

// Basic navigation that works without Firebase
function initBasicNavigation() {
  console.log('Initializing basic navigation (Firebase unavailable)');
  
  // Nav
  document.querySelectorAll('.nav-btn[data-view]').forEach(function(btn){
    btn.onclick = function(){
      document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      var view = btn.getAttribute('data-view');
      document.querySelectorAll('.view').forEach(v=>v.classList.remove('visible'));
      var el = document.getElementById('view-' + view);
      if (el) el.classList.add('visible');
      if (view === 'calendar') refreshCalendarView();
    };
  });
  
  // Set up basic routine UI without Firebase
  setupBasicRoutineUI();
}

function setupBasicRoutineUI() {
  var createBtn = document.getElementById('createRoutine');
  if (createBtn) {
    createBtn.onclick = function() {
      var title = prompt('Routine name:');
      if (title) {
        // Show demo routine builder
        showDemoRoutineBuilder(title);
      }
    };
  }
}

function showDemoRoutineBuilder(routineName) {
  var builder = document.getElementById('routineBuilder');
  if (!builder) return;
  
  builder.innerHTML = '<div class="routine-meta">' +
    '<label>Title:<br><input id="routineTitle" value="' + routineName + '" placeholder="Routine name"></label>' +
    '<label>Theme:<br><select id="routineTheme">' +
    '<option value="Health" selected>Health</option>' +
    '<option value="Growth">Growth</option>' +
    '<option value="Wealth">Wealth</option>' +
    '<option value="Tribe">Tribe</option>' +
    '<option value="Home">Home</option>' +
    '</select></label>' +
    '<label>Recurrence:<br><select id="routineRecurrence">' +
    '<option value="daily" selected>Daily</option>' +
    '<option value="weekly">Weekly</option>' +
    '</select></label>' +
    '<button onclick="saveDemoRoutine()">Save Routine</button>' +
    '</div>' +
    '<div><strong>Steps:</strong> <button onclick="addDemoStep()">+ Add Step</button></div>' +
    '<div id="routineSteps">' +
    '<div class="routine-step">' +
    '<div><strong>Meditation</strong><div class="step-info">10min · Priority 8</div></div>' +
    '<div class="step-actions"><button onclick="editDemoStep(this)">Edit</button><button onclick="deleteDemoStep(this)">Delete</button></div>' +
    '</div>' +
    '<div class="routine-step">' +
    '<div><strong>Exercise</strong><div class="step-info">30min · Priority 9</div></div>' +
    '<div class="step-actions"><button onclick="editDemoStep(this)">Edit</button><button onclick="deleteDemoStep(this)">Delete</button></div>' +
    '</div>' +
    '<div class="routine-step">' +
    '<div><strong>Journaling</strong><div class="step-info">15min · Priority 7</div></div>' +
    '<div class="step-actions"><button onclick="editDemoStep(this)">Edit</button><button onclick="deleteDemoStep(this)">Delete</button></div>' +
    '</div>' +
    '</div>';
}

window.addDemoStep = function() {
  var title = prompt('Step name:');
  if (!title) return;
  var effort = parseInt(prompt('Duration (minutes):', '10')) || 10;
  var importance = parseInt(prompt('Importance (1-10):', '5')) || 5;
  
  var stepsDiv = document.getElementById('routineSteps');
  if (stepsDiv) {
    var step = document.createElement('div');
    step.className = 'routine-step';
    step.innerHTML = '<div><strong>' + title + '</strong><div class="step-info">' + effort + 'min · Priority ' + importance + '</div></div>' +
      '<div class="step-actions"><button onclick="editDemoStep(this)">Edit</button><button onclick="deleteDemoStep(this)">Delete</button></div>';
    stepsDiv.appendChild(step);
  }
};

window.saveDemoRoutine = function() {
  var title = document.getElementById('routineTitle').value;
  var theme = document.getElementById('routineTheme').value;
  var recurrence = document.getElementById('routineRecurrence').value;
  
  alert('Demo: Routine "' + title + '" saved with theme "' + theme + '" and recurrence "' + recurrence + '".\n\nThis would create the routine in the backend when Firebase is connected.');
};

window.editDemoStep = function(button) {
  var step = button.closest('.routine-step');
  var stepTitle = step.querySelector('strong').textContent;
  var newTitle = prompt('Edit step name:', stepTitle);
  if (newTitle) {
    step.querySelector('strong').textContent = newTitle;
  }
};

window.deleteDemoStep = function(button) {
  if (confirm('Delete this step?')) {
    button.closest('.routine-step').remove();
  }
};

function init() {
  var config = { apiKey:"AIzaSyDsuR1TNHUE74awnbFaU5cA0FGya0voVFk", authDomain:"bob20250810.firebaseapp.com", projectId:"bob20250810" };
  firebase.initializeApp(config);

  var auth = firebase.auth();
  var db = firebase.firestore();
  var functions = firebase.functions("europe-west2");

  // Nav
  document.querySelectorAll('.nav-btn[data-view]').forEach(function(btn){
    btn.onclick = function(){
      document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      var view = btn.getAttribute('data-view');
      document.querySelectorAll('.view').forEach(v=>v.classList.remove('visible'));
      var el = document.getElementById('view-' + view);
      if (el) el.classList.add('visible');
      if (view === 'calendar') refreshCalendarView();
    };
  });

  // Buttons
  var connectBtn = document.getElementById('connectCal');
  var addTodayBtn = document.getElementById('addToday');
  var prioritiseBtn = document.getElementById('prioritise');
  var signinBtn = document.getElementById('signin');
  var signoutBtn = document.getElementById('signout');

  if (prioritiseBtn) prioritiseBtn.onclick = function(){ collectTasksForPrioritisation(db, auth, functions); };

  auth.onAuthStateChanged(function (user) {
    if (signinBtn) signinBtn.style.display = user ? 'none' : '';
    if (signoutBtn) signoutBtn.style.display = user ? '' : 'none';
    if (signoutBtn) signoutBtn.onclick = function(){ auth.signOut().catch(console.error); };
    if (user) {
      loadBoard(user, db); loadGoalsOkrs(user, db); loadToday(user, db); loadRoutines(user, db, functions);
      // Wire calendar buttons
      if (connectBtn) connectBtn.onclick = function(){ startServerOAuth(user.uid); };
      if (addTodayBtn) addTodayBtn.onclick = function(){
        createEventServer('Focus block: top priority', 60).then(refreshCalendarView).catch(console.error);
      };
      calendarStatus().then(function(st){ if (st.connected) addTodayBtn.style.display=''; });
    } else {
      clearBoard();
    }
  });

  // Calendar controls
  var dayBtn = document.getElementById('calDay');
  var weekBtn = document.getElementById('calWeek');
  var prevBtn = document.getElementById('calPrev');
  var nextBtn = document.getElementById('calNext');
  if (dayBtn) dayBtn.onclick = function(){ state.calMode = 'day'; refreshCalendarView(); };
  if (weekBtn) weekBtn.onclick = function(){ state.calMode = 'week'; refreshCalendarView(); };
  if (prevBtn) prevBtn.onclick = function(){ shiftCalendar(-1); };
  if (nextBtn) nextBtn.onclick = function(){ shiftCalendar(1); };

  async function calendarStatus(){
    try{
      var res = await functions.httpsCallable('calendarStatus')({});
      return res.data || {connected:false};
    } catch(e){ return {connected:false}; }
  }
  function startServerOAuth(uid){
    var nonce = Math.random().toString(36).slice(2);
    localStorage.setItem('oauth_nonce', nonce);
    window.location.href = '/api/oauth/start?uid='+encodeURIComponent(uid)+'&nonce='+encodeURIComponent(nonce);
  }
  async function createEventServer(title, minutes){
    var start = new Date();
    var end = new Date(start.getTime() + (minutes||60)*60*1000);
    var res = await functions.httpsCallable('createCalendarEvent')({
      summary: title, start: start.toISOString(), end: end.toISOString()
    });
    return res.data;
  }
}

var state = { calMode: 'day', calAnchor: new Date() };

function shiftCalendar(delta){
  if (state.calMode === 'day') state.calAnchor.setDate(state.calAnchor.getDate()+delta);
  else state.calAnchor.setDate(state.calAnchor.getDate() + (delta*7));
  refreshCalendarView();
}

async function refreshCalendarView(){
  var grid = document.getElementById('calendarGrid'); if (!grid) return;
  grid.innerHTML = '';
  var anchor = new Date(state.calAnchor.getTime());
  var rangeLabel = document.getElementById('calRange');

  var days = [];
  if (state.calMode === 'day'){
    days = [new Date(anchor.getTime())];
    if (rangeLabel) rangeLabel.textContent = anchor.toDateString();
  } else {
    var start = new Date(anchor.getTime()); start.setDate(start.getDate() - start.getDay());
    for (var i=0;i<7;i++){ var d = new Date(start.getTime()); d.setDate(start.getDate()+i); days.push(d); }
    if (rangeLabel) rangeLabel.textContent = days[0].toDateString() + ' – ' + days[6].toDateString();
  }

  var hours = []; for (var h=7; h<=20; h++) hours.push(h);
  days.forEach(function(){ var head = document.createElement('div'); head.className='calendar-row';
    var pad=document.createElement('div'); pad.className='calendar-hour'; pad.textContent=''; head.appendChild(pad);
    var dayCell=document.createElement('div'); dayCell.className='calendar-cell'; dayCell.textContent=''; head.appendChild(dayCell);
    grid.appendChild(head);
  });

  for (var i=0;i<hours.length;i++){
    var row = document.createElement('div'); row.className='calendar-row';
    var hour = document.createElement('div'); hour.className='calendar-hour'; hour.textContent = (hours[i]+':00');
    row.appendChild(hour);
    var cell = document.createElement('div'); cell.className='calendar-cell'; cell.id='h'+hours[i]; row.appendChild(cell);
    grid.appendChild(row);
  }

  try {
    var items = await firebase.functions("europe-west2").httpsCallable('listUpcomingEvents')({ maxResults: 50 });
    var events = (items && items.data && items.data.items) ? items.data.items : [];
    events.forEach(function(ev){
      if (!ev.start || !ev.start.dateTime) return;
      var st = new Date(ev.start.dateTime);
      var id = 'h'+st.getHours();
      var c = document.getElementById(id);
      if (c){ var chip=document.createElement('div'); chip.className='event'; chip.textContent=ev.summary||'(event)'; c.appendChild(chip); }
    });
  } catch(e){ /* not connected yet */ }
}

// Board & data (same as before, trimmed)
function clearBoard() {
  ['backlog', 'doing', 'done'].forEach(function (c) {
    var el = document.getElementById('col-' + c);
    if (!el) return;
    el.innerHTML = '';
  });
}

function loadBoard(user, db) {
  clearBoard();
  ['backlog', 'doing', 'done'].forEach(function (status) {
    db.collection('tasks')
      .where('ownerUid', '==', user.uid)
      .where('status', '==', status)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .onSnapshot(function (snap) {
        var el = document.getElementById('col-' + status);
        if (!el) return;
        el.innerHTML='';
        snap.forEach(function (doc) {
          var d = doc.data();
          var card = document.createElement('div');
          card.className = 'card';
          card.textContent = (d.title || '(untitled)') + (d.goalArea ? (' · ' + d.goalArea) : '');

          var area = (d.goalArea || d.area || '').toString().trim().toLowerCase();
          var colorMap = { growth:'#4A86E8', tribe:'#674EA7', wealth:'#93C47D', health:'#E06666', home:'#F6B26B' };
          if (colorMap[area]) { card.style.backgroundColor = colorMap[area]; card.style.color = '#000'; }

          el.appendChild(card);
          makeCardDraggable(card, doc.id, d.ownerUid);
        });
      }, console.error);
  });
}

function loadGoalsOkrs(user, db){
  db.collection('goals').where('ownerUid','==',user.uid).orderBy('createdAt','desc').limit(50).onSnapshot(function(snap){
    var list = document.getElementById('goalsList'); if (!list) return; list.innerHTML='';
    snap.forEach(function(doc){
      var d=doc.data(); var item=document.createElement('div'); item.className='item';
      item.textContent = (d.text||'(goal)') + (d.area? ' · '+d.area : '');
      list.appendChild(item);
    });
  });
  db.collection('okrs').where('ownerUid','==',user.uid).orderBy('createdAt','desc').limit(50).onSnapshot(function(snap){
    var list = document.getElementById('okrsList'); if (!list) return; list.innerHTML='';
    snap.forEach(function(doc){
      var d=doc.data(); var item=document.createElement('div'); item.className='item';
      var title=(d.title||'(okr)'); if(d.goalTitle) title+=' → '+d.goalTitle;
      item.textContent = title;
      list.appendChild(item);
    });
  });
}

function loadRoutines(user, db, functions){
  db.collection('routines').where('ownerUid','==',user.uid).orderBy('createdAt','desc').limit(50).onSnapshot(function(snap){
    var list = document.getElementById('routinesList'); if (!list) return; list.innerHTML='';
    snap.forEach(function(doc){
      var d=doc.data(); var item=document.createElement('div'); item.className='item';
      item.textContent = (d.title||'(routine)') + (d.themeId? ' · '+d.themeId : '');
      item.style.cursor = 'pointer';
      item.onclick = function(){ loadRoutineBuilder(doc.id, d, user, db, functions); };
      list.appendChild(item);
    });
  });
  
  var createBtn = document.getElementById('createRoutine');
  if (createBtn) createBtn.onclick = function(){ createNewRoutine(user, db, functions); };
}

function createNewRoutine(user, db, functions){
  var title = prompt('Routine name:');
  if (!title) return;
  
  functions.httpsCallable('createRoutine')({
    title: title,
    themeId: 'Health',
    recurrenceRule: 'daily',
    importanceScore: 5
  }).then(function(result){
    if (result.data.ok) {
      console.log('Routine created:', result.data.id);
    }
  }).catch(console.error);
}

function loadRoutineBuilder(routineId, routine, user, db, functions){
  var builder = document.getElementById('routineBuilder'); if (!builder) return;
  
  builder.innerHTML = '<div class="routine-meta">' +
    '<label>Title:<br><input id="routineTitle" value="'+(routine.title||'')+'" placeholder="Routine name"></label>' +
    '<label>Theme:<br><select id="routineTheme">' +
    '<option value="Health"'+(routine.themeId==='Health'?' selected':'')+'>Health</option>' +
    '<option value="Growth"'+(routine.themeId==='Growth'?' selected':'')+'>Growth</option>' +
    '<option value="Wealth"'+(routine.themeId==='Wealth'?' selected':'')+'>Wealth</option>' +
    '<option value="Tribe"'+(routine.themeId==='Tribe'?' selected':'')+'>Tribe</option>' +
    '<option value="Home"'+(routine.themeId==='Home'?' selected':'')+'>Home</option>' +
    '</select></label>' +
    '<label>Recurrence:<br><select id="routineRecurrence">' +
    '<option value="daily"'+(routine.recurrenceRule==='daily'?' selected':'')+'>Daily</option>' +
    '<option value="weekly"'+(routine.recurrenceRule==='weekly'?' selected':'')+'>Weekly</option>' +
    '</select></label>' +
    '<button onclick="saveRoutineMeta(\''+routineId+'\')">Save Changes</button>' +
    '</div>' +
    '<div><strong>Steps:</strong> <button onclick="addRoutineStep(\''+routineId+'\')">+ Add Step</button></div>' +
    '<div id="routineSteps"></div>';
  
  // Load steps
  db.collection('routine_steps').where('routineId','==',routineId).where('ownerUid','==',user.uid).orderBy('orderIndex').onSnapshot(function(snap){
    var stepsDiv = document.getElementById('routineSteps'); if (!stepsDiv) return;
    stepsDiv.innerHTML = '';
    snap.forEach(function(doc){
      var s = doc.data();
      var step = document.createElement('div');
      step.className = 'routine-step';
      step.innerHTML = '<div><strong>'+s.title+'</strong><div class="step-info">'+s.effortMinutes+'min · Priority '+s.importanceScore+'</div></div>' +
        '<div class="step-actions"><button onclick="editStep(\''+doc.id+'\')">Edit</button><button onclick="deleteStep(\''+doc.id+'\')">Delete</button></div>';
      stepsDiv.appendChild(step);
    });
  });
}

window.addRoutineStep = function(routineId){
  var title = prompt('Step name:');
  if (!title) return;
  var effort = parseInt(prompt('Duration (minutes):', '10')) || 10;
  var importance = parseInt(prompt('Importance (1-10):', '5')) || 5;
  
  firebase.functions("europe-west2").httpsCallable('createRoutineStep')({
    routineId: routineId,
    title: title,
    effortMinutes: effort,
    importanceScore: importance,
    orderIndex: Date.now() // Simple ordering
  }).catch(console.error);
};

window.saveRoutineMeta = function(routineId){
  var title = document.getElementById('routineTitle').value;
  var theme = document.getElementById('routineTheme').value;
  var recurrence = document.getElementById('routineRecurrence').value;
  
  firebase.firestore().collection('routines').doc(routineId).update({
    title: title,
    themeId: theme,
    recurrenceRule: recurrence
  }).catch(console.error);
};

window.editStep = function(stepId){
  // Simple edit for now
  alert('Edit functionality coming soon');
};

window.deleteStep = function(stepId){
  if (confirm('Delete this step?')) {
    firebase.firestore().collection('routine_steps').doc(stepId).delete().catch(console.error);
  }
};

function loadToday(user, db){
  db.collection('tasks').where('ownerUid','==',user.uid).where('status','in',['backlog','doing']).limit(20).get().then(function(qs){
    var list = document.getElementById('todayList'); if (!list) return; list.innerHTML='';
    qs.forEach(function(doc){
      var d=doc.data(); var item=document.createElement('div'); item.className='item';
      item.textContent=d.title||'(task)';
      if (d.goalArea){ var b=document.createElement('span'); b.className='badge'; b.textContent=d.goalArea; item.appendChild(b); }
      list.appendChild(item);
    });
  });
}

// AI (callable exists on backend)
function collectTasksForPrioritisation(db, auth, functions){
  var user = auth.currentUser; if (!user) return;
  db.collection('tasks')
    .where('ownerUid','==',user.uid)
    .where('status','in',['backlog','doing'])
    .limit(50)
    .get()
    .then(function(qs){
      var tasks=[]; qs.forEach(function(doc){ var d=doc.data();
        tasks.push({ id:doc.id, title:d.title||'', effort:d.effort||1, dueDate:d.dueDate||null, goalArea:d.goalArea||null });
      });
      var context={ focusAreas:['Health','Wealth'], dayHours:6 };
      return functions.httpsCallable('prioritizeBacklog')({ tasks, context });
    }).then(function(res){ if(res&&res.data) console.log('Prioritisation result:', res.data); })
    .catch(console.error);
}

// DnD
(function enableDnD(){
  ['backlog','doing','done'].forEach(function(status){
    var el=document.getElementById('col-'+status); if(!el) return;
    el.addEventListener('dragover', function(ev){ ev.preventDefault(); });
    el.addEventListener('drop', function(ev){
      ev.preventDefault();
      var data=ev.dataTransfer.getData('text/plain'); var parts=data.split('|');
      if(parts.length!==2) return; var id=parts[0]; var ownerUid=parts[1];
      var user=firebase.auth().currentUser; if(!user||user.uid!==ownerUid) return;
      firebase.firestore().collection('tasks').doc(id).update({ status: status }).then(function(){
        if (status === 'doing') {
          firebase.functions("europe-west2").httpsCallable('createCalendarEvent')({
            summary: 'Working on task', start: new Date().toISOString(), end: new Date(Date.now()+45*60*1000).toISOString()
          }).catch(console.error);
        }
      });
    });
  });
})();

function makeCardDraggable(cardEl, docId, ownerUid){
  cardEl.setAttribute('draggable','true');
  cardEl.addEventListener('dragstart', function(ev){
    ev.dataTransfer.setData('text/plain', docId+'|'+ownerUid);
  });
}
