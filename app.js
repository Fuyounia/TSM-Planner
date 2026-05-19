/* ============================================================
   Task Schedule Management — app.js  v2.0
   Full notification system · User settings · Reminders view
   ============================================================ */

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
  const nameEl = document.getElementById('user-name-display');
  if (nameEl) nameEl.textContent = settings.userName;
  const avatarEl = document.getElementById('user-avatar-display');
  if (avatarEl) avatarEl.textContent = (settings.userName || 'U')[0].toUpperCase();
}

// ───────────────────────────────────────────────────────────
// STATE
// ───────────────────────────────────────────────────────────
let tasks = JSON.parse(localStorage.getItem('tsm-tasks') || '[]');
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();
let selectedCalDate = null;
let editingId = null;

// Seed sample data on first load
if (tasks.length === 0) {
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
// NOTIFICATIONS
// ───────────────────────────────────────────────────────────
const notifTimers = {}; // key → setTimeout ID

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
    showToast(perm === 'denied' ? 'Notifications blocked — check browser settings' : 'Notification permission dismissed');
  }
  updateNotifUI();
}

function updateNotifUI() {
  const btn = document.getElementById('notif-btn');
  const granted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  if (btn) {
    btn.style.color = granted ? '#D4860A' : '';
    btn.title       = granted ? 'Notifications enabled' : 'Enable notifications';
  }
  // Update status bar if reminders view is active
  const bar = document.getElementById('notif-status-bar');
  if (bar) renderNotifStatusBar(bar);
  // Update enable button
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
    bar.innerHTML = '<div class="notif-status notif-denied">🔕 Notifications are blocked by your browser. To enable them, click the lock icon in the address bar and allow notifications for this site.</div>';
  } else {
    bar.innerHTML = '<div class="notif-status notif-prompt">🔔 Click "Enable Notifications" above to receive task reminders.</div>';
  }
}

// Schedule (or reschedule) ALL task reminders from scratch
function scheduleAllNotifications() {
  // Clear every existing timer
  Object.values(notifTimers).forEach(clearTimeout);
  Object.keys(notifTimers).forEach(k => delete notifTimers[k]);

  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  tasks.forEach(t => scheduleTaskNotifications(t));

  if (settings.dailyDigest) scheduleDailyDigest();
}

// Schedule the reminder(s) for a single task
function scheduleTaskNotifications(task) {
  if (task.status === 'done') return;
  if (!task.date || !task.time) return;
  if (!task.reminder || task.reminder === 'none') return;

  const taskMs = new Date(`${task.date}T${task.time}:00`).getTime();
  if (isNaN(taskMs)) return;

  const now       = Date.now();
  const offsetMin = parseInt(task.reminder, 10);
  const remindMs  = taskMs - offsetMin * 60_000;

  // ── Chosen offset reminder ──────────────────────────────
  if (remindMs > now) {
    const label = offsetMin === 0
      ? 'Due Right Now!'
      : `${fmtOffset(offsetMin)} before`;

    notifTimers[`${task.id}_r`] = setTimeout(() => {
      fireNotification(
        `⏰ Reminder — ${label}`,
        `"${task.name}"${task.time ? ' at ' + fmtTime(task.time) : ''}`,
        task.priority,
        task.id
      );
    }, remindMs - now);
  }

  // ── At-time notification (only if offset reminder > 0) ──
  if (offsetMin > 0 && taskMs > now) {
    notifTimers[`${task.id}_0`] = setTimeout(() => {
      fireNotification(
        `▣ Task Due Now`,
        `"${task.name}" — ${task.category}`,
        task.priority,
        task.id
      );
    }, taskMs - now);
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
  const icons  = { high: '🔴', medium: '🟡', low: '🟢' };
  const fullTitle = `${icons[priority] || '▣'} ${title}`;
  const options = {
    body,
    icon:              './favicon75.png',
    badge:             './favicon38.png',
    tag:               `tsm-${taskId || Date.now()}`,
    requireInteraction: priority === 'high',
    silent:            false,
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
  const now = new Date();
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

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
    scheduleDailyDigest(); // reschedule for tomorrow
  }, next - now);
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

function saveTasks() { localStorage.setItem('tsm-tasks', JSON.stringify(tasks)); }

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
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function reminderLabel(val) {
  const map = {
    none: 'No reminder', '0': 'At task time',
    '5': '5 min before', '15': '15 min before',
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
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24)  return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
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

  // Upcoming: next 7 days, not done, sorted by date/time
  const upcoming = tasks
    .filter(t => t.status !== 'done' && t.date && t.date >= todayStr)
    .sort((a, b) => (a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1)
    .slice(0, 6);

  document.getElementById('upcoming-count').textContent = upcoming.length;
  document.getElementById('upcoming-list').innerHTML = upcoming.length
    ? upcoming.map(t => taskItemHTML(t)).join('')
    : '<li class="empty-msg">No upcoming tasks</li>';

  // Today's schedule sorted by time
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

  // Progress bars by category
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

  const grid     = document.getElementById('cal-grid');
  const todayStr = new Date().toISOString().split('T')[0];
  const firstDay    = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const dayHdrs = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

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
  // Status bar
  const bar = document.getElementById('notif-status-bar');
  if (bar) renderNotifStatusBar(bar);

  // Update enable button visibility
  const enableBtn = document.getElementById('notif-enable-btn');
  if (enableBtn) {
    const granted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
    enableBtn.style.display = granted ? 'none' : '';
  }

  const todayStr = new Date().toISOString().split('T')[0];

  // ── Upcoming reminders: future tasks with a reminder set, not done ──
  const upcoming = tasks
    .filter(t =>
      t.status !== 'done' &&
      t.reminder && t.reminder !== 'none' &&
      t.date && t.date >= todayStr
    )
    .sort((a, b) => (a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1);

  document.getElementById('reminder-count').textContent = upcoming.length;
  document.getElementById('reminder-list').innerHTML = upcoming.length
    ? upcoming.map(t => reminderItemHTML(t)).join('')
    : '<li class="empty-msg">No upcoming reminders scheduled</li>';

  // ── Overdue: past due date, not done ──────────────────────
  const overdue = tasks
    .filter(isOverdue)
    .sort((a, b) => a.date < b.date ? 1 : -1); // most recent overdue first

  document.getElementById('overdue-reminder-count').textContent = overdue.length;
  document.getElementById('overdue-reminder-list').innerHTML = overdue.length
    ? overdue.map(t => reminderItemHTML(t, true)).join('')
    : '<li class="empty-msg">No overdue tasks — great work! 🎉</li>';

  // ── All reminders: every task that has a reminder set ─────
  const all = tasks
    .filter(t => t.reminder && t.reminder !== 'none')
    .sort((a, b) => {
      // Sort: overdue first, then upcoming, then done
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
  const checked = t.status === 'done';
  const over    = forceOverdue || isOverdue(t);
  const remLabel = reminderLabel(t.reminder);
  const now      = Date.now();

  // Calculate when the reminder fires or a status description
  let fireLine = '';
  if (t.date && t.time && t.reminder && t.reminder !== 'none') {
    const taskMs    = new Date(`${t.date}T${t.time}:00`).getTime();
    const offsetMin = parseInt(t.reminder, 10);
    const remindMs  = taskMs - offsetMin * 60_000;

    if (!isNaN(taskMs)) {
      if (checked) {
        fireLine = 'completed';
      } else if (remindMs > now) {
        fireLine = `fires in ${fmtDuration(remindMs - now)}`;
      } else if (taskMs > now) {
        fireLine = 'reminder passed · task upcoming';
      } else {
        fireLine = 'past due';
      }
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
          ${over    ? '<span class="overdue-badge">Overdue</span>' : ''}
          ${checked ? '<span class="done-badge">Done</span>' : ''}
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

function saveTask() {
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

  if (editingId) {
    // Cancel old timers for this task before re-scheduling
    clearTimeout(notifTimers[`${editingId}_r`]);
    clearTimeout(notifTimers[`${editingId}_0`]);
    delete notifTimers[`${editingId}_r`];
    delete notifTimers[`${editingId}_0`];
    const idx = tasks.findIndex(t => t.id === editingId);
    if (idx !== -1) tasks[idx] = task;
    showToast('Task updated ✓');
  } else {
    tasks.unshift(task);
    showToast('Task added ✓');
  }

  saveTasks();
  // Schedule just this task's notifications (more efficient than full reschedule)
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    scheduleTaskNotifications(task);
  }
  closeModal();
  refreshCurrentView();
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  document.getElementById('modal-overlay').classList.remove('open');
}

// ───────────────────────────────────────────────────────────
// SETTINGS MODAL
// ───────────────────────────────────────────────────────────
function openSettings() {
  document.getElementById('settings-name').value            = settings.userName;
  document.getElementById('settings-default-reminder').value = settings.defaultReminder;
  document.getElementById('settings-daily-digest').checked  = settings.dailyDigest;
  document.getElementById('settings-digest-time').value     = settings.digestTime;

  // Show current notification permission status
  const permEl = document.getElementById('settings-notif-perm');
  if (permEl) {
    if (!('Notification' in window)) {
      permEl.textContent = 'Not supported';
      permEl.className = 'perm-badge perm-denied';
    } else {
      const p = Notification.permission;
      permEl.textContent = p === 'granted' ? 'Enabled ✓' : p === 'denied' ? 'Blocked ✕' : 'Not yet enabled';
      permEl.className = `perm-badge perm-${p}`;
    }
  }

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
  applySettings();
  refreshNotifications();
  document.getElementById('settings-overlay').classList.remove('open');
  showToast('Settings saved ✓');
}

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

function clearAllTasksConfirm() {
  if (!confirm('Delete ALL tasks? This cannot be undone.')) return;
  // Clear all timers
  Object.values(notifTimers).forEach(clearTimeout);
  Object.keys(notifTimers).forEach(k => delete notifTimers[k]);
  tasks = [];
  saveTasks();
  if (settings.dailyDigest && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    scheduleDailyDigest();
  }
  document.getElementById('settings-overlay').classList.remove('open');
  refreshCurrentView();
  showToast('All tasks deleted');
}

// ───────────────────────────────────────────────────────────
// TASK ACTIONS
// ───────────────────────────────────────────────────────────
function toggleDone(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  t.status = t.status === 'done' ? 'todo' : 'done';
  saveTasks();
  // If marking done, cancel its pending timers
  if (t.status === 'done') {
    clearTimeout(notifTimers[`${id}_r`]);
    clearTimeout(notifTimers[`${id}_0`]);
    delete notifTimers[`${id}_r`];
    delete notifTimers[`${id}_0`];
  } else {
    // Re-enable timers if un-done
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      scheduleTaskNotifications(t);
    }
  }
  refreshCurrentView();
  showToast(t.status === 'done' ? 'Marked complete ✓' : 'Marked incomplete');
}

function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  clearTimeout(notifTimers[`${id}_r`]);
  clearTimeout(notifTimers[`${id}_0`]);
  delete notifTimers[`${id}_r`];
  delete notifTimers[`${id}_0`];
  tasks = tasks.filter(t => t.id !== id);
  saveTasks();
  refreshCurrentView();
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
// INIT
// ───────────────────────────────────────────────────────────
applySettings();
renderDashboard();
updateNotifUI();

// Re-enable timers if permission was already granted from a previous session
if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
  scheduleAllNotifications();
}

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js').catch(() => {
    // Fails gracefully in file:// protocol — that's fine
  });
}
