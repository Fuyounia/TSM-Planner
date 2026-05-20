/* ============================================================
   TSM — app.js  v3.0
   Full Firebase Google Auth · Firestore Sync · Notifications
   ============================================================ */

// ───────────────────────────────────────────────────────────
// FIREBASE INIT
// ───────────────────────────────────────────────────────────
let fbAuth = null;
let fbDb   = null;
let currentUser = null;
let firestoreUnsub = null; // unsubscribe fn for onSnapshot

(function initFirebase() {
  if (typeof firebase === 'undefined' || typeof firebaseConfig === 'undefined') return;
  try {
    firebase.initializeApp(firebaseConfig);
    fbAuth = firebase.auth();
    fbDb   = firebase.firestore();
    fbDb.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    fbAuth.onAuthStateChanged(handleAuthStateChange);
  } catch (e) {
    console.warn('Firebase init failed:', e);
  }
})();

// ───────────────────────────────────────────────────────────
// SETTINGS STATE
// ───────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  userName:        'User',
  defaultReminder: '15',
  dailyDigest:     true,
  digestTime:      '08:00',
};

let settings = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('tsm-settings') || '{}') };

function saveSettings() {
  localStorage.setItem('tsm-settings', JSON.stringify(settings));
}

function applySettings() {
  // Only use settings name when NOT signed in (Google name takes over when signed in)
  if (!currentUser) {
    const nameEl = document.getElementById('user-name-display');
    if (nameEl) nameEl.textContent = settings.userName;
    const avatarEl = document.getElementById('user-avatar-display');
    if (avatarEl) {
      avatarEl.textContent = (settings.userName || 'U')[0].toUpperCase();
      avatarEl.style.backgroundImage = '';
    }
  }
}

// ───────────────────────────────────────────────────────────
// STATE
// ───────────────────────────────────────────────────────────
let tasks = [];
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();
let selectedCalDate = null;
let editingId = null;

function getLocalTasks() {
  return JSON.parse(localStorage.getItem('tsm-tasks') || '[]');
}

function seedSampleData() {
  if (tasks.length > 0) return;
  const fmt = d => d.toISOString().split('T')[0];
  const add = n => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
  tasks = [
    { id: uid(), name: 'Review project proposal',  date: fmt(add(0)),  time: '09:00', priority: 'high',   status: 'progress', category: 'work',     notes: 'Send feedback to team',   reminder: '15'   },
    { id: uid(), name: 'Team standup meeting',      date: fmt(add(0)),  time: '10:00', priority: 'medium', status: 'done',     category: 'work',     notes: '',                        reminder: '5'    },
    { id: uid(), name: 'Buy groceries',             date: fmt(add(1)),  time: '17:00', priority: 'low',    status: 'todo',     category: 'errands',  notes: 'Milk, bread, eggs',       reminder: '30'   },
    { id: uid(), name: 'Gym workout',               date: fmt(add(1)),  time: '07:00', priority: 'medium', status: 'todo',     category: 'health',   notes: '45 min cardio',           reminder: '15'   },
    { id: uid(), name: 'Quarterly report',          date: fmt(add(2)),  time: '14:00', priority: 'high',   status: 'todo',     category: 'work',     notes: 'Due EOD Friday',          reminder: '60'   },
    { id: uid(), name: 'Call Mom',                  date: fmt(add(2)),  time: '18:30', priority: 'medium', status: 'todo',     category: 'personal', notes: '',                        reminder: '15'   },
    { id: uid(), name: 'Doctor appointment',        date: fmt(add(4)),  time: '11:00', priority: 'high',   status: 'todo',     category: 'health',   notes: 'Bring insurance card',    reminder: '120'  },
    { id: uid(), name: 'Update portfolio website',  date: fmt(add(5)),  time: '',      priority: 'low',    status: 'todo',     category: 'personal', notes: '',                        reminder: 'none' },
    { id: uid(), name: 'Pay utility bills',         date: fmt(add(-1)), time: '',      priority: 'high',   status: 'todo',     category: 'errands',  notes: 'Past due!',               reminder: 'none' },
    { id: uid(), name: 'Read design patterns book', date: fmt(add(6)),  time: '20:00', priority: 'low',    status: 'todo',     category: 'personal', notes: 'Chapter 4 onwards',       reminder: '30'   },
  ];
  saveTasks();
}

// ───────────────────────────────────────────────────────────
// AUTH HANDLERS
// ───────────────────────────────────────────────────────────
async function handleAuthStateChange(user) {
  currentUser = user;

  // Detach old Firestore listener
  if (firestoreUnsub) {
    firestoreUnsub();
    firestoreUnsub = null;
  }

  if (user) {
    // ── Signed in ──
    updateAuthUI(user);
    setSyncStatus('connecting');

    // Attach real-time Firestore listener
    firestoreUnsub = fbDb
      .collection('users').doc(user.uid).collection('tasks')
      .onSnapshot(
        snap => {
          tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          refreshCurrentView();
          scheduleAllNotifications();
          setSyncStatus('synced');
          updateSyncLabel();
        },
        err => {
          console.warn('Firestore error:', err);
          setSyncStatus('offline');
        }
      );

    // Check if there are local tasks to offer migration
    const localTasks = getLocalTasks();
    const migrateBtn = document.getElementById('migrate-btn');
    if (migrateBtn && localTasks.length > 0) {
      migrateBtn.style.display = '';
      migrateBtn.textContent = `⬆ Import ${localTasks.length} local task${localTasks.length !== 1 ? 's' : ''}`;
    }

  } else {
    // ── Signed out ──
    updateAuthUI(null);
    tasks = getLocalTasks();
    if (tasks.length === 0) seedSampleData();
    refreshCurrentView();
    scheduleAllNotifications();
    setSyncStatus('local');
  }
}

function updateAuthUI(user) {
  const signinDiv  = document.getElementById('sidebar-signin');
  const footerDiv  = document.getElementById('sidebar-footer');
  const nameEl     = document.getElementById('user-name-display');
  const avatarEl   = document.getElementById('user-avatar-display');

  // Settings modal panels
  const signedOut  = document.getElementById('settings-auth-signedout');
  const signedIn   = document.getElementById('settings-auth-signedin');

  if (user) {
    // Sidebar
    if (signinDiv) signinDiv.style.display = 'none';
    if (footerDiv) footerDiv.style.display = 'flex';
    if (nameEl)    nameEl.textContent = user.displayName ? user.displayName.split(' ')[0] : 'You';
    if (avatarEl) {
      if (user.photoURL) {
        avatarEl.style.backgroundImage = `url('${user.photoURL}')`;
        avatarEl.style.backgroundSize  = 'cover';
        avatarEl.textContent = '';
      } else {
        avatarEl.style.backgroundImage = '';
        avatarEl.textContent = (user.displayName || 'U')[0].toUpperCase();
      }
    }

    // Settings modal
    if (signedOut) signedOut.style.display = 'none';
    if (signedIn)  signedIn.style.display = 'block';
    const photoEl = document.getElementById('settings-auth-photo');
    const nameAuth = document.getElementById('settings-auth-name');
    const emailAuth = document.getElementById('settings-auth-email');
    if (photoEl)    { photoEl.src = user.photoURL || ''; photoEl.style.display = user.photoURL ? '' : 'none'; }
    if (nameAuth)   nameAuth.textContent = user.displayName || '—';
    if (emailAuth)  emailAuth.textContent = user.email || '—';

  } else {
    // Sidebar
    if (signinDiv) signinDiv.style.display = 'flex';
    if (footerDiv) footerDiv.style.display = 'flex';
    if (nameEl)    nameEl.textContent = settings.userName || 'Local';
    if (avatarEl) {
      avatarEl.style.backgroundImage = '';
      avatarEl.textContent = (settings.userName || 'U')[0].toUpperCase();
    }

    // Settings modal
    if (signedOut) signedOut.style.display = 'block';
    if (signedIn)  signedIn.style.display = 'none';
  }
}

// ── Google sign-in ──────────────────────────────────────────
async function signInWithGoogle() {
  if (!fbAuth) { showToast('Firebase not available'); return; }
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');
    await fbAuth.signInWithPopup(provider);
    showToast('Signed in ✓');
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      showToast('Sign-in failed: ' + (err.message || err.code));
      console.error('Sign-in error:', err);
    }
  }
}

// ── Sign out ────────────────────────────────────────────────
async function signOutUser() {
  if (!fbAuth) return;
  try {
    await fbAuth.signOut();
    // Reload tasks from localStorage after sign-out
    tasks = getLocalTasks();
    if (tasks.length === 0) seedSampleData();
    refreshCurrentView();
    document.getElementById('settings-overlay').classList.remove('open');
    showToast('Signed out');
  } catch (err) {
    showToast('Sign-out failed');
  }
}

// ── Migrate localStorage → Firestore ───────────────────────
async function migrateLocalToFirestore() {
  if (!currentUser || !fbDb) return;
  const localTasks = getLocalTasks();
  if (!localTasks.length) { showToast('No local tasks to import'); return; }

  const btn = document.getElementById('migrate-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }

  try {
    const col = fbDb.collection('users').doc(currentUser.uid).collection('tasks');
    const batch = fbDb.batch();
    localTasks.forEach(t => batch.set(col.doc(t.id), t));
    await batch.commit();
    localStorage.removeItem('tsm-tasks');
    if (btn) btn.style.display = 'none';
    showToast(`${localTasks.length} tasks imported ✓`);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = '⬆ Import local tasks'; }
    showToast('Import failed — try again');
    console.error(err);
  }
}

// ── Sync status indicator ───────────────────────────────────
function setSyncStatus(state) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  const map = {
    synced:      { text: '● Synced',       cls: 'sync-ok'   },
    connecting:  { text: '◌ Connecting…',  cls: 'sync-wait' },
    offline:     { text: '○ Offline',      cls: 'sync-off'  },
    local:       { text: '◎ Local mode',   cls: 'sync-local'},
  };
  const s = map[state] || map.local;
  el.textContent  = s.text;
  el.className    = 'sync-status ' + s.cls;
}

function updateSyncLabel() {
  const el = document.getElementById('settings-sync-label');
  if (el) el.textContent = 'Last synced ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ───────────────────────────────────────────────────────────
// TASK PERSISTENCE — write to Firestore OR localStorage
// ───────────────────────────────────────────────────────────
function saveTasks() {
  // Used for local mode only (bulk save during seeding / clear-all)
  if (!currentUser) {
    localStorage.setItem('tsm-tasks', JSON.stringify(tasks));
  }
}

async function saveTaskDoc(task) {
  if (currentUser && fbDb) {
    try {
      await fbDb.collection('users').doc(currentUser.uid).collection('tasks').doc(task.id).set(task);
    } catch (err) {
      showToast('Save failed — check connection');
      console.error(err);
    }
  } else {
    // Upsert into local array and persist
    const idx = tasks.findIndex(t => t.id === task.id);
    if (idx !== -1) tasks[idx] = task; else tasks.unshift(task);
    saveTasks();
  }
}

async function deleteTaskDoc(id) {
  if (currentUser && fbDb) {
    try {
      await fbDb.collection('users').doc(currentUser.uid).collection('tasks').doc(id).delete();
    } catch (err) {
      showToast('Delete failed — check connection');
      console.error(err);
    }
  } else {
    tasks = tasks.filter(t => t.id !== id);
    saveTasks();
    refreshCurrentView();
  }
}

// ───────────────────────────────────────────────────────────
// NOTIFICATIONS
// ───────────────────────────────────────────────────────────
const notifTimers = {};

async function initNotifications() {
  if (!('Notification' in window)) {
    showToast('Notifications not supported in this browser');
    updateNotifUI();
    return;
  }
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();

  if (perm === 'granted') {
    showToast('Notifications enabled ✓');
    scheduleAllNotifications();
  } else {
    showToast(perm === 'denied'
      ? 'Notifications blocked — check browser settings'
      : 'Notification permission dismissed');
  }
  updateNotifUI();
}

function updateNotifUI() {
  const btn     = document.getElementById('notif-btn');
  const granted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  if (btn) {
    btn.style.color = granted ? '#D4860A' : '';
    btn.title       = granted ? 'Notifications enabled' : 'Enable notifications';
  }
  const bar = document.getElementById('notif-status-bar');
  if (bar) renderNotifStatusBar(bar);
  const enableBtn = document.getElementById('notif-enable-btn');
  if (enableBtn) enableBtn.style.display = granted ? 'none' : '';
}

function renderNotifStatusBar(bar) {
  if (!('Notification' in window)) {
    bar.innerHTML = '<div class="notif-status notif-denied">⚠ Notifications not supported in this browser.</div>';
    return;
  }
  const perm = Notification.permission;
  if (perm === 'granted') {
    bar.innerHTML = '<div class="notif-status notif-granted">🔔 Notifications are enabled. Reminders will fire at your chosen offset before each task.</div>';
  } else if (perm === 'denied') {
    bar.innerHTML = '<div class="notif-status notif-denied">🔕 Notifications are blocked by your browser. Click the lock icon in the address bar and allow notifications for this site.</div>';
  } else {
    bar.innerHTML = '<div class="notif-status notif-prompt">🔔 Click "Enable Notifications" above to receive task reminders.</div>';
  }
}

function scheduleAllNotifications() {
  Object.values(notifTimers).forEach(clearTimeout);
  Object.keys(notifTimers).forEach(k => delete notifTimers[k]);
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  tasks.forEach(t => scheduleTaskNotifications(t));
  if (settings.dailyDigest) scheduleDailyDigest();
}

function scheduleTaskNotifications(task) {
  if (task.status === 'done') return;
  if (!task.date || !task.time) return;
  if (!task.reminder || task.reminder === 'none') return;

  const taskMs    = new Date(`${task.date}T${task.time}:00`).getTime();
  if (isNaN(taskMs)) return;

  const now2      = Date.now();
  const offsetMin = parseInt(task.reminder, 10);
  const remindMs  = taskMs - offsetMin * 60_000;

  if (remindMs > now2) {
    const label = offsetMin === 0 ? 'Due Right Now!' : `${fmtOffset(offsetMin)} before`;
    notifTimers[`${task.id}_r`] = setTimeout(() => {
      fireNotification(
        `⏰ Reminder — ${label}`,
        `"${task.name}"${task.time ? ' at ' + fmtTime(task.time) : ''}`,
        task.priority, task.id
      );
    }, remindMs - now2);
  }

  if (offsetMin > 0 && taskMs > now2) {
    notifTimers[`${task.id}_0`] = setTimeout(() => {
      fireNotification(`▣ Task Due Now`, `"${task.name}" — ${task.category}`, task.priority, task.id);
    }, taskMs - now2);
  }
}

function fmtOffset(min) {
  if (min < 60)   return `${min} min`;
  if (min < 1440) return `${min / 60} hr`;
  const days = min / 1440;
  return `${days} day${days > 1 ? 's' : ''}`;
}

function fireNotification(title, body, priority = 'medium', taskId = '') {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const icons = { high: '🔴', medium: '🟡', low: '🟢' };
  const fullTitle = `${icons[priority] || '▣'} ${title}`;
  const options = {
    body,
    icon:               './favicon150-2.png',
    badge:              './favicon100-2.png',
    tag:                `tsm-${taskId || Date.now()}`,
    requireInteraction: priority === 'high',
    silent:             false,
  };

  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready
      .then(reg => reg.showNotification(fullTitle, options))
      .catch(() => new Notification(fullTitle, options));
  } else {
    new Notification(fullTitle, options);
  }
}

function scheduleDailyDigest() {
  clearTimeout(notifTimers['_digest']);
  const [h, m] = (settings.digestTime || '08:00').split(':').map(Number);
  const now2 = new Date();
  const next = new Date(now2);
  next.setHours(h, m, 0, 0);
  if (next <= now2) next.setDate(next.getDate() + 1);

  notifTimers['_digest'] = setTimeout(() => {
    const todayStr    = new Date().toISOString().split('T')[0];
    const todayTasks  = tasks.filter(t => t.date === todayStr && t.status !== 'done');
    const overdueTasks = tasks.filter(isOverdue);
    if (todayTasks.length || overdueTasks.length) {
      fireNotification(
        'Good morning — your day ahead',
        `${todayTasks.length} task${todayTasks.length !== 1 ? 's' : ''} today` +
        (overdueTasks.length ? ` · ${overdueTasks.length} overdue` : ''),
        'medium'
      );
    }
    scheduleDailyDigest();
  }, next - now2);
}

function refreshNotifications() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    scheduleAllNotifications();
  }
}

// ───────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

function fmtDate(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[+m - 1]} ${+d}, ${y}`;
}

function fmtTime(str) {
  if (!str) return '';
  let [h, min] = str.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(min).padStart(2, '0')} ${ampm}`;
}

function isOverdue(task) {
  if (task.status === 'done') return false;
  if (!task.date) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return new Date(task.date + 'T00:00:00') < today;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function escHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function reminderLabel(val) {
  const map = {
    none: 'No reminder', '0': 'At task time',
    '5': '5 min before',  '15': '15 min before',
    '30': '30 min before', '60': '1 hour before',
    '120': '2 hours before', '1440': '1 day before',
    '2880': '2 days before',
  };
  return map[String(val)] || 'No reminder';
}

function fmtDuration(ms) {
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1)    return 'less than a minute';
  if (totalMin < 60)   return `${totalMin}m`;
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  if (h < 24)  return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

// ───────────────────────────────────────────────────────────
// VIEW SWITCHING
// ───────────────────────────────────────────────────────────
function switchView(view, btn) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  if (btn) btn.classList.add('active');
  if (view === 'dashboard') renderDashboard();
  if (view === 'tasks')     renderTasks();
  if (view === 'calendar')  renderCalendar();
  if (view === 'schedule')  renderSchedule();
  if (view === 'reminders') renderReminders();
  document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ───────────────────────────────────────────────────────────
// DASHBOARD
// ───────────────────────────────────────────────────────────
function renderDashboard() {
  const now      = new Date();
  const todayStr = now.toISOString().split('T')[0];

  document.getElementById('stat-total').textContent    = tasks.length;
  document.getElementById('stat-done').textContent     = tasks.filter(t => t.status === 'done').length;
  document.getElementById('stat-progress').textContent = tasks.filter(t => t.status === 'progress').length;
  document.getElementById('stat-overdue').textContent  = tasks.filter(isOverdue).length;

  const upcoming = tasks
    .filter(t => t.status !== 'done' && t.date && t.date >= todayStr)
    .sort((a, b) => (a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1)
    .slice(0, 6);

  document.getElementById('upcoming-count').textContent = upcoming.length;
  document.getElementById('upcoming-list').innerHTML = upcoming.length
    ? upcoming.map(t => taskItemHTML(t)).join('')
    : '<li class="empty-msg">No upcoming tasks</li>';

  const todayTasks = tasks
    .filter(t => t.date === todayStr)
    .sort((a, b) => (a.time || '99:99') < (b.time || '99:99') ? -1 : 1);

  document.getElementById('today-label').textContent =
    now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  document.getElementById('today-schedule').innerHTML = todayTasks.length
    ? todayTasks.map(t => `
        <li class="schedule-item">
          <span class="sched-dot ${t.priority}"></span>
          <div>
            <span class="sched-time">${t.time ? fmtTime(t.time) : 'All day'}</span>
            <span class="sched-name ${t.status === 'done' ? 'done-text' : ''}">${escHtml(t.name)}</span>
          </div>
        </li>`).join('')
    : '<li class="empty-msg">Nothing scheduled today</li>';

  const cats = ['work', 'personal', 'health', 'errands', 'other'];
  const colorMap = { work: 'accent', personal: 'accent', health: 'green', errands: 'amber', other: '' };
  document.getElementById('progress-bars').innerHTML = cats.map(cat => {
    const catTasks = tasks.filter(t => t.category === cat);
    if (!catTasks.length) return '';
    const pct = Math.round((catTasks.filter(t => t.status === 'done').length / catTasks.length) * 100);
    return `
      <div class="progress-row">
        <span class="progress-label">${cat}</span>
        <div class="progress-track">
          <div class="progress-fill ${colorMap[cat]}" style="width:${pct}%"></div>
        </div>
        <span class="progress-pct">${pct}%</span>
      </div>`;
  }).join('');
}

// ───────────────────────────────────────────────────────────
// SHARED TASK ITEM HTML
// ───────────────────────────────────────────────────────────
function taskItemHTML(t) {
  const checked = t.status === 'done';
  const over    = isOverdue(t);
  return `
    <li class="task-item ${over ? 'overdue-item' : ''}" onclick="openEditTask('${t.id}')">
      <span class="task-check ${checked ? 'checked' : ''}" onclick="event.stopPropagation();toggleDone('${t.id}')">${checked ? '✓' : ''}</span>
      <div class="task-info">
        <div class="task-name-text ${checked ? 'done-text' : ''}">${escHtml(t.name)}</div>
        <div class="task-meta">
          <span class="priority-dot ${t.priority}"></span>
          <span class="task-date-tag ${over ? 'overdue-tag' : ''}">${t.date ? fmtDate(t.date) : ''}${t.time ? ' · ' + fmtTime(t.time) : ''}</span>
          <span class="cat-tag cat-${t.category}">${t.category}</span>
          ${over ? '<span class="overdue-badge">Overdue</span>' : ''}
        </div>
      </div>
      <div class="task-actions">
        <button class="task-action-btn" onclick="event.stopPropagation();deleteTask('${t.id}')" title="Delete">✕</button>
      </div>
    </li>`;
}

// ───────────────────────────────────────────────────────────
// TASKS VIEW
// ───────────────────────────────────────────────────────────
function renderTasks() {
  const sf = document.getElementById('filter-status').value;
  const pf = document.getElementById('filter-priority').value;

  const filtered = tasks.filter(t => {
    return (sf === 'all' || t.status === sf) && (pf === 'all' || t.priority === pf);
  }).sort((a, b) => {
    const pd = { high: 0, medium: 1, low: 2 };
    if (pd[a.priority] !== pd[b.priority]) return pd[a.priority] - pd[b.priority];
    return (a.date || '') < (b.date || '') ? -1 : 1;
  });

  const container = document.getElementById('tasks-container');
  if (!filtered.length) {
    container.innerHTML = '<div class="empty-msg" style="padding:3rem">No tasks match your filters</div>';
    return;
  }

  container.innerHTML = filtered.map(t => {
    const over = isOverdue(t);
    return `
      <div class="task-full-item ${over ? 'overdue-item' : ''}" onclick="openEditTask('${t.id}')">
        <span class="task-check ${t.status === 'done' ? 'checked' : ''}" onclick="event.stopPropagation();toggleDone('${t.id}')">${t.status === 'done' ? '✓' : ''}</span>
        <div class="task-full-info">
          <div class="task-full-name ${t.status === 'done' ? 'done-text' : ''}">${escHtml(t.name)}</div>
          <div class="task-full-meta">
            <span class="status-badge status-${t.status}">${t.status === 'progress' ? 'In Progress' : t.status === 'done' ? 'Done' : 'To Do'}</span>
            <span class="priority-dot ${t.priority}"></span>
            <span class="cat-tag cat-${t.category}">${t.category}</span>
            ${t.date ? `<span class="task-full-date ${over ? 'overdue-tag' : ''}">${fmtDate(t.date)}${t.time ? ' · ' + fmtTime(t.time) : ''}${over ? ' ⚠ Overdue' : ''}</span>` : ''}
            ${t.reminder && t.reminder !== 'none' ? `<span class="reminder-chip-sm">🔔 ${reminderLabel(t.reminder)}</span>` : ''}
          </div>
          ${t.notes ? `<div class="task-full-notes">${escHtml(t.notes)}</div>` : ''}
        </div>
        <div class="task-full-actions">
          <button class="task-action-btn" onclick="event.stopPropagation();openEditTask('${t.id}')" title="Edit">✎</button>
          <button class="task-action-btn" onclick="event.stopPropagation();deleteTask('${t.id}')" title="Delete">✕</button>
        </div>
      </div>`;
  }).join('');
}

// ───────────────────────────────────────────────────────────
// CALENDAR VIEW
// ───────────────────────────────────────────────────────────
function renderCalendar() {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('cal-month-label').textContent = `${months[calMonth]} ${calYear}`;

  const grid        = document.getElementById('cal-grid');
  const todayStr    = new Date().toISOString().split('T')[0];
  const firstDay    = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const dayHdrs     = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  let html = dayHdrs.map(d => `<div class="cal-day-header">${d}</div>`).join('');
  for (let i = 0; i < firstDay; i++) html += `<div class="cal-day empty"></div>`;

  for (let day = 1; day <= daysInMonth; day++) {
    const ds  = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dt  = tasks.filter(t => t.date === ds);
    const dots = dt.slice(0, 4).map(t => {
      const c = t.status === 'done' ? 'done' : t.priority === 'high' ? '' : t.priority === 'medium' ? 'amber' : 'green';
      return `<span class="cal-dot ${c}"></span>`;
    }).join('');
    html += `
      <div class="cal-day ${ds === todayStr ? 'today' : ''} ${selectedCalDate === ds ? 'selected' : ''}" onclick="selectCalDate('${ds}')">
        <span class="cal-day-num">${day}</span>
        <div class="cal-dots">${dots}</div>
      </div>`;
  }
  grid.innerHTML = html;
}

function changeMonth(dir) {
  calMonth += dir;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  selectedCalDate = null;
  renderCalendar();
  document.getElementById('cal-selected-label').textContent = 'Select a date';
  document.getElementById('cal-events-list').innerHTML = '<li class="empty-msg">Click a date to view tasks</li>';
}

function selectCalDate(ds) {
  selectedCalDate = ds;
  renderCalendar();
  document.getElementById('cal-selected-label').textContent = 'Tasks for ' + fmtDate(ds);
  const dt = tasks.filter(t => t.date === ds).sort((a, b) => (a.time || '99:99') < (b.time || '99:99') ? -1 : 1);
  document.getElementById('cal-events-list').innerHTML = dt.length
    ? dt.map(t => taskItemHTML(t)).join('')
    : '<li class="empty-msg">No tasks this day</li>';
}

// ───────────────────────────────────────────────────────────
// SCHEDULE VIEW
// ───────────────────────────────────────────────────────────
function renderSchedule() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const todayStr = today.toISOString().split('T')[0];

  const cols = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    const ds = d.toISOString().split('T')[0];
    const dt = tasks
      .filter(t => t.date === ds)
      .sort((a, b) => (a.time || '99:99') < (b.time || '99:99') ? -1 : 1);

    const events = dt.map(t => {
      const c = t.priority === 'high' ? '' : t.priority === 'medium' ? 'amber' : 'green';
      return `<div class="week-event ${c}" onclick="openEditTask('${t.id}')" title="${escHtml(t.name)}">${t.time ? fmtTime(t.time) + ' · ' : ''}${escHtml(t.name)}</div>`;
    }).join('') || '<div class="week-empty">—</div>';

    return `
      <div class="week-col ${ds === todayStr ? 'today-col' : ''}">
        <div class="week-col-header">
          <span class="week-col-day">${dayNames[i]}</span>
          <span class="week-col-date">${d.getDate()}</span>
        </div>
        <div class="week-events">${events}</div>
      </div>`;
  });

  document.getElementById('schedule-week').innerHTML = cols.join('');
}

// ───────────────────────────────────────────────────────────
// REMINDERS VIEW
// ───────────────────────────────────────────────────────────
function renderReminders() {
  const bar = document.getElementById('notif-status-bar');
  if (bar) renderNotifStatusBar(bar);

  const enableBtn = document.getElementById('notif-enable-btn');
  if (enableBtn) {
    const granted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
    enableBtn.style.display = granted ? 'none' : '';
  }

  const todayStr = new Date().toISOString().split('T')[0];

  const upcoming = tasks
    .filter(t => t.status !== 'done' && t.reminder && t.reminder !== 'none' && t.date && t.date >= todayStr)
    .sort((a, b) => (a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1);

  document.getElementById('reminder-count').textContent = upcoming.length;
  document.getElementById('reminder-list').innerHTML = upcoming.length
    ? upcoming.map(t => reminderItemHTML(t)).join('')
    : '<li class="empty-msg">No upcoming reminders scheduled</li>';

  const overdue = tasks.filter(isOverdue).sort((a, b) => a.date < b.date ? 1 : -1);
  document.getElementById('overdue-reminder-count').textContent = overdue.length;
  document.getElementById('overdue-reminder-list').innerHTML = overdue.length
    ? overdue.map(t => reminderItemHTML(t, true)).join('')
    : '<li class="empty-msg">No overdue tasks — great work! 🎉</li>';

  const all = tasks
    .filter(t => t.reminder && t.reminder !== 'none')
    .sort((a, b) => {
      const aOver = isOverdue(a), bOver = isOverdue(b);
      const aDone = a.status === 'done', bDone = b.status === 'done';
      if (aOver !== bOver) return aOver ? -1 : 1;
      if (aDone !== bDone) return aDone ? 1 : -1;
      return (a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1;
    });

  document.getElementById('all-reminder-list').innerHTML = all.length
    ? all.map(t => reminderItemHTML(t)).join('')
    : '<li class="empty-msg">No reminders set. Add a reminder when creating or editing a task.</li>';
}

function reminderItemHTML(t, forceOverdue = false) {
  const checked  = t.status === 'done';
  const over     = forceOverdue || isOverdue(t);
  const remLabel = reminderLabel(t.reminder);
  const now2     = Date.now();

  let fireLine = '';
  if (t.date && t.time && t.reminder && t.reminder !== 'none') {
    const taskMs    = new Date(`${t.date}T${t.time}:00`).getTime();
    const offsetMin = parseInt(t.reminder, 10);
    const remindMs  = taskMs - offsetMin * 60_000;
    if (!isNaN(taskMs)) {
      if (checked)              fireLine = 'completed';
      else if (remindMs > now2) fireLine = `fires in ${fmtDuration(remindMs - now2)}`;
      else if (taskMs > now2)   fireLine = 'reminder passed · task upcoming';
      else                      fireLine = 'past due';
    }
  } else if (!t.time && t.date && !checked) {
    fireLine = 'no time set — reminder won\'t fire';
  }

  return `
    <li class="reminder-item ${over ? 'overdue-item' : ''} ${checked ? 'done-item' : ''}" onclick="openEditTask('${t.id}')">
      <span class="task-check ${checked ? 'checked' : ''}" onclick="event.stopPropagation();toggleDone('${t.id}')">${checked ? '✓' : ''}</span>
      <div class="reminder-info">
        <div class="reminder-name ${checked ? 'done-text' : ''}">${escHtml(t.name)}</div>
        <div class="reminder-meta">
          <span class="priority-dot ${t.priority}"></span>
          <span class="task-date-tag ${over ? 'overdue-tag' : ''}">
            ${t.date ? fmtDate(t.date) : 'No date'}${t.time ? ' · ' + fmtTime(t.time) : ''}
          </span>
          <span class="cat-tag cat-${t.category}">${t.category}</span>
        </div>
        <div class="reminder-chips">
          <span class="reminder-chip">🔔 ${remLabel}</span>
          ${fireLine ? `<span class="reminder-chip reminder-fire">${fireLine}</span>` : ''}
          ${over     ? '<span class="overdue-badge">Overdue</span>' : ''}
          ${checked  ? '<span class="done-badge">Done</span>' : ''}
        </div>
      </div>
      <div class="task-actions">
        <button class="task-action-btn edit-btn" onclick="event.stopPropagation();openEditTask('${t.id}')" title="Edit">✎</button>
        <button class="task-action-btn" onclick="event.stopPropagation();deleteTask('${t.id}')" title="Delete">✕</button>
      </div>
    </li>`;
}

// ───────────────────────────────────────────────────────────
// MODAL — ADD / EDIT TASK
// ───────────────────────────────────────────────────────────
function openAddTask() {
  editingId = null;
  document.getElementById('modal-title').textContent  = 'New Task';
  document.getElementById('edit-id').value            = '';
  document.getElementById('task-name').value          = '';
  document.getElementById('task-date').value          = new Date().toISOString().split('T')[0];
  document.getElementById('task-time').value          = '';
  document.getElementById('task-priority').value      = 'medium';
  document.getElementById('task-status').value        = 'todo';
  document.getElementById('task-category').value      = 'work';
  document.getElementById('task-notes').value         = '';
  document.getElementById('task-reminder').value      = settings.defaultReminder || '15';
  document.getElementById('modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('task-name').focus(), 50);
}

function openEditTask(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  editingId = id;
  document.getElementById('modal-title').textContent  = 'Edit Task';
  document.getElementById('edit-id').value            = t.id;
  document.getElementById('task-name').value          = t.name;
  document.getElementById('task-date').value          = t.date   || '';
  document.getElementById('task-time').value          = t.time   || '';
  document.getElementById('task-priority').value      = t.priority;
  document.getElementById('task-status').value        = t.status;
  document.getElementById('task-category').value      = t.category;
  document.getElementById('task-notes').value         = t.notes  || '';
  document.getElementById('task-reminder').value      = t.reminder || 'none';
  document.getElementById('modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('task-name').focus(), 50);
}

async function saveTask() {
  const name = document.getElementById('task-name').value.trim();
  if (!name) {
    document.getElementById('task-name').classList.add('input-error');
    showToast('Please enter a task name');
    document.getElementById('task-name').focus();
    return;
  }
  document.getElementById('task-name').classList.remove('input-error');

  const task = {
    id:       editingId || uid(),
    name,
    date:     document.getElementById('task-date').value,
    time:     document.getElementById('task-time').value,
    priority: document.getElementById('task-priority').value,
    status:   document.getElementById('task-status').value,
    category: document.getElementById('task-category').value,
    notes:    document.getElementById('task-notes').value.trim(),
    reminder: document.getElementById('task-reminder').value,
  };

  // Cancel old timers for this task
  if (editingId) {
    clearTimeout(notifTimers[`${editingId}_r`]);
    clearTimeout(notifTimers[`${editingId}_0`]);
    delete notifTimers[`${editingId}_r`];
    delete notifTimers[`${editingId}_0`];
  }

  // Write to Firestore or local
  await saveTaskDoc(task);

  // For local mode, update in-memory array immediately (Firestore uses snapshot)
  if (!currentUser) {
    refreshCurrentView();
  }

  showToast(editingId ? 'Task updated ✓' : 'Task added ✓');

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    scheduleTaskNotifications(task);
  }
  closeModal();
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  document.getElementById('modal-overlay').classList.remove('open');
}

// ───────────────────────────────────────────────────────────
// SETTINGS MODAL
// ───────────────────────────────────────────────────────────
function openSettings() {
  document.getElementById('settings-name').value             = settings.userName;
  document.getElementById('settings-default-reminder').value = settings.defaultReminder;
  document.getElementById('settings-daily-digest').checked   = settings.dailyDigest;
  document.getElementById('settings-digest-time').value      = settings.digestTime;

  const permEl = document.getElementById('settings-notif-perm');
  if (permEl) {
    if (!('Notification' in window)) {
      permEl.textContent = 'Not supported';
      permEl.className   = 'perm-badge perm-denied';
    } else {
      const p = Notification.permission;
      permEl.textContent = p === 'granted' ? 'Enabled ✓' : p === 'denied' ? 'Blocked ✕' : 'Not yet enabled';
      permEl.className   = `perm-badge perm-${p}`;
    }
  }

  // Refresh auth state in settings panel
  updateAuthUI(currentUser);

  document.getElementById('settings-overlay').classList.add('open');
}

function closeSettingsModal(e) {
  if (e && e.target !== document.getElementById('settings-overlay')) return;
  document.getElementById('settings-overlay').classList.remove('open');
}

function saveSettingsUI() {
  settings.userName        = (document.getElementById('settings-name').value.trim() || 'User');
  settings.defaultReminder = document.getElementById('settings-default-reminder').value;
  settings.dailyDigest     = document.getElementById('settings-daily-digest').checked;
  settings.digestTime      = document.getElementById('settings-digest-time').value || '08:00';

  saveSettings();
  if (!currentUser) applySettings();
  refreshNotifications();
  document.getElementById('settings-overlay').classList.remove('open');
  showToast('Settings saved ✓');
}

// ───────────────────────────────────────────────────────────
// DATA ACTIONS
// ───────────────────────────────────────────────────────────
function exportTasks() {
  const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href:     url,
    download: `tsm-tasks-${new Date().toISOString().split('T')[0]}.json`,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Tasks exported ✓');
}

async function clearAllTasksConfirm() {
  if (!confirm('Delete ALL tasks? This cannot be undone.')) return;

  Object.values(notifTimers).forEach(clearTimeout);
  Object.keys(notifTimers).forEach(k => delete notifTimers[k]);

  if (currentUser && fbDb) {
    try {
      const snap = await fbDb.collection('users').doc(currentUser.uid).collection('tasks').get();
      const batch = fbDb.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    } catch (err) {
      showToast('Delete failed — check connection');
      return;
    }
  } else {
    tasks = [];
    saveTasks();
    if (settings.dailyDigest && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      scheduleDailyDigest();
    }
    refreshCurrentView();
  }

  document.getElementById('settings-overlay').classList.remove('open');
  showToast('All tasks deleted');
}

// ───────────────────────────────────────────────────────────
// TASK ACTIONS
// ───────────────────────────────────────────────────────────
async function toggleDone(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  const newStatus = t.status === 'done' ? 'todo' : 'done';

  if (currentUser && fbDb) {
    try {
      await fbDb.collection('users').doc(currentUser.uid).collection('tasks').doc(id).update({ status: newStatus });
    } catch (err) {
      showToast('Update failed');
      return;
    }
  } else {
    t.status = newStatus;
    saveTasks();
    refreshCurrentView();
  }

  if (newStatus === 'done') {
    clearTimeout(notifTimers[`${id}_r`]);
    clearTimeout(notifTimers[`${id}_0`]);
    delete notifTimers[`${id}_r`];
    delete notifTimers[`${id}_0`];
  } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    scheduleTaskNotifications({ ...t, status: newStatus });
  }

  showToast(newStatus === 'done' ? 'Marked complete ✓' : 'Marked incomplete');
}

async function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  clearTimeout(notifTimers[`${id}_r`]);
  clearTimeout(notifTimers[`${id}_0`]);
  delete notifTimers[`${id}_r`];
  delete notifTimers[`${id}_0`];
  await deleteTaskDoc(id);
  showToast('Task deleted');
}

function refreshCurrentView() {
  const active = document.querySelector('.view.active');
  if (!active) return;
  const view = active.id.replace('view-', '');
  if (view === 'dashboard') renderDashboard();
  if (view === 'tasks')     renderTasks();
  if (view === 'calendar')  { renderCalendar(); if (selectedCalDate) selectCalDate(selectedCalDate); }
  if (view === 'schedule')  renderSchedule();
  if (view === 'reminders') renderReminders();
}

// ───────────────────────────────────────────────────────────
// KEYBOARD SHORTCUTS
// ───────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const modalOpen    = document.getElementById('modal-overlay').classList.contains('open');
  const settingsOpen = document.getElementById('settings-overlay').classList.contains('open');

  if (e.key === 'Escape') {
    if (modalOpen)    document.getElementById('modal-overlay').classList.remove('open');
    if (settingsOpen) document.getElementById('settings-overlay').classList.remove('open');
    document.getElementById('sidebar').classList.remove('open');
  }

  if (e.key === 'n' && !modalOpen && !settingsOpen) {
    const tag = document.activeElement.tagName;
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) openAddTask();
  }
});

// ───────────────────────────────────────────────────────────
// URL PARAM ACTIONS  (e.g., ?action=new-task, ?view=schedule)
// ───────────────────────────────────────────────────────────
function handleUrlParams() {
  const p = new URLSearchParams(location.search);
  const view   = p.get('view');
  const action = p.get('action');

  if (view) {
    const btn = document.querySelector(`[data-view="${view}"]`);
    switchView(view, btn);
  }
  if (action === 'new-task') {
    setTimeout(openAddTask, 300);
  }
}

// ───────────────────────────────────────────────────────────
// INIT
// ───────────────────────────────────────────────────────────
applySettings();
updateNotifUI();
handleUrlParams();

// If Firebase is NOT available, boot with localStorage immediately
if (!fbAuth) {
  tasks = getLocalTasks();
  if (tasks.length === 0) seedSampleData();
  renderDashboard();
  setSyncStatus('local');
} else {
  // Firebase is available — onAuthStateChanged will drive everything.
  // Show initial dashboard skeleton while waiting for auth check.
  renderDashboard();
  setSyncStatus('connecting');
}

// Re-enable notification timers if permission already granted
if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
  scheduleAllNotifications();
}

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}
