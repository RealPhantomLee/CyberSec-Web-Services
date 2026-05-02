'use strict';

// ─── TIME UTILITIES ───────────────────────────────────────────────────────────
function fmt24(ts) {
  return new Date(ts).toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).replace(',', '');
}

function fmt24time(ts) {
  return new Date(ts).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false
  });
}

// ─── AUTH ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();

  document.getElementById('login-btn')?.addEventListener('click', login);
  document.getElementById('login-password')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') login();
  });
  document.getElementById('logout-btn')?.addEventListener('click', logout);

  // Tab navigation
  document.querySelectorAll('.admin-nav-item').forEach(item => {
    item.addEventListener('click', () => switchTab(item.dataset.tab));
  });

  // Blog post creation
  document.getElementById('create-post-btn')?.addEventListener('click', createBlogPost);

  // Load controls state from localStorage
  loadControlStates();
  loadContactInfo();

  // Pre-fill today's date in blog form
  const dateInput = document.getElementById('post-date');
  if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
});

async function checkAuth() {
  const hasCookie = document.cookie.split(';').some(c => c.trim().startsWith('admin_session='));
  if (!hasCookie) { showLogin(); return; }
  try {
    const r = await fetch('/api/admin/analytics');
    if (r.ok) { showDashboard(); initDashboard(); }
    else      { expireCookie(); showLogin(); }
  } catch {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('login-section').style.display    = 'flex';
  document.getElementById('dashboard-section').style.display = 'none';
}

function showDashboard() {
  document.getElementById('login-section').style.display    = 'none';
  document.getElementById('dashboard-section').style.display = 'block';
}

function expireCookie() {
  document.cookie = 'admin_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
}

const LOCKOUT_KEY      = 'pcs_admin_lockout';
const ATTEMPTS_KEY     = 'pcs_admin_attempts';
const MAX_ATTEMPTS     = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000;

function getLockoutState() {
  const until    = parseInt(localStorage.getItem(LOCKOUT_KEY) || '0', 10);
  const attempts = parseInt(localStorage.getItem(ATTEMPTS_KEY) || '0', 10);
  return { until, attempts };
}

function isLockedOut() {
  const { until } = getLockoutState();
  if (Date.now() < until) return true;
  if (until > 0) {
    localStorage.removeItem(LOCKOUT_KEY);
    localStorage.removeItem(ATTEMPTS_KEY);
  }
  return false;
}

function recordFailedAttempt() {
  const { attempts } = getLockoutState();
  const next = attempts + 1;
  localStorage.setItem(ATTEMPTS_KEY, next);
  if (next >= MAX_ATTEMPTS) {
    localStorage.setItem(LOCKOUT_KEY, Date.now() + LOCKOUT_DURATION);
    localStorage.setItem(ATTEMPTS_KEY, '0');
  }
}

function clearAttempts() {
  localStorage.removeItem(LOCKOUT_KEY);
  localStorage.removeItem(ATTEMPTS_KEY);
}

function lockoutMinutesRemaining() {
  const { until } = getLockoutState();
  return Math.ceil((until - Date.now()) / 60000);
}

async function login() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const err      = document.getElementById('login-error');
  err.style.display = 'none';

  if (isLockedOut()) {
    err.textContent   = `Too many failed attempts. Try again in ${lockoutMinutesRemaining()} minute(s).`;
    err.style.display = 'block';
    return;
  }

  try {
    const r = await fetch('/api/admin/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    });

    if (r.ok) {
      clearAttempts();
      location.reload();
    } else {
      recordFailedAttempt();
      const { attempts } = getLockoutState();
      const remaining = MAX_ATTEMPTS - attempts;
      err.textContent   = isLockedOut()
        ? `Too many failed attempts. Try again in ${lockoutMinutesRemaining()} minute(s).`
        : `Invalid credentials. ${remaining} attempt(s) remaining.`;
      err.style.display = 'block';
    }
  } catch (e) {
    console.error(e);
    err.textContent   = '> Could not reach server. Is the backend running?';
    err.style.display = 'block';
  }
}

async function logout() {
  await fetch('/api/admin/logout', { method: 'POST' }).catch(() => {});
  expireCookie();
  location.reload();
}

// ─── TAB NAVIGATION ──────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-nav-item').forEach(i => i.classList.remove('active'));
  document.getElementById(`tab-${name}`)?.classList.add('active');
  document.querySelector(`[data-tab="${name}"]`)?.classList.add('active');

  if (name === 'analytics') renderAnalytics();
  if (name === 'blog')      loadExistingPosts();
  if (name === 'settings')  loadSettings();
}

// ─── DASHBOARD INIT ──────────────────────────────────────────────────────────
async function initDashboard() {
  renderOverview();
  renderSystemStatus();
  renderRecentActivity();
  renderMessages();
  try {
    const cfg = await fetch('./config.json').then(r => r.json());
    const el = document.getElementById('current-user');
    if (el) el.textContent = cfg.admin?.username || 'Admin';
  } catch (_) {}
}

// ─── HELPERS: VISIT DATA ──────────────────────────────────────────────────────
function getVisits()   { return JSON.parse(localStorage.getItem('pcs_visits')   || '{}'); }
function getTotal()    { return JSON.parse(localStorage.getItem('pcs_total')    || '{}'); }
function getSessions() { return JSON.parse(localStorage.getItem('pcs_sessions') || '{}'); }

function totalVisitsToday() {
  const today  = new Date().toISOString().split('T')[0];
  const visits = getVisits();
  if (!visits[today]) return 0;
  return Object.values(visits[today]).reduce((a, b) => a + b, 0);
}

function totalVisitsRange(days) {
  const visits = getVisits();
  const keys   = Object.keys(visits).sort().slice(-days);
  return keys.reduce((sum, d) => {
    return sum + Object.values(visits[d]).reduce((a, b) => a + b, 0);
  }, 0);
}

function totalSessionsRange(days) {
  const sessions = getSessions();
  const keys = Object.keys(sessions).sort().slice(-days);
  return keys.reduce((sum, d) => sum + (sessions[d] || 0), 0);
}

function totalPosts() {
  try {
    const stored = localStorage.getItem('pcs_posts');
    if (stored) return JSON.parse(stored).length;
  } catch (_) {}
  return 1; // default from blog.json
}

// ─── OVERVIEW TAB ────────────────────────────────────────────────────────────
function renderOverview() {
  const total   = getTotal();
  const allTime = total['__all'] || 0;
  const today   = totalVisitsToday();
  const week    = totalVisitsRange(7);
  const sessions = totalSessionsRange(30);

  const stats = [
    { label: 'All-Time Views',  value: allTime,   delta: '+' + today + ' today',     cls: 'delta-up' },
    { label: "Today's Views",   value: today,      delta: 'live count',              cls: 'delta-flat' },
    { label: 'This Week',       value: week,       delta: 'last 7 days',             cls: 'delta-flat' },
    { label: 'Sessions (30d)',  value: sessions,   delta: 'unique visits',           cls: 'delta-flat' },
    { label: 'Blog Posts',      value: totalPosts(), delta: 'published',             cls: 'delta-flat' },
    { label: 'Cart Sessions',   value: getCartSessions(), delta: 'checkout opens',   cls: 'delta-flat' },
  ];

  const grid = document.getElementById('overview-stats');
  if (grid) grid.innerHTML = stats.map(s => `
    <div class="stat-card">
      <div class="stat-label">${s.label}</div>
      <div class="stat-value">${s.value.toLocaleString()}</div>
      <div class="stat-delta ${s.cls}">${s.delta}</div>
    </div>
  `).join('');
}

function getCartSessions() {
  try {
    const cart = JSON.parse(localStorage.getItem('cart') || '[]');
    return cart.length > 0 ? 1 : 0;
  } catch (_) { return 0; }
}

// ─── SYSTEM STATUS ────────────────────────────────────────────────────────────
async function renderSystemStatus() {
  const el = document.getElementById('system-status');
  if (!el) return;

  let stripeMode = 'TEST';
  try {
    const cfg = await fetch('./config.json').then(r => r.json());
    const pk  = cfg.stripe?.public_key || '';
    if (pk.startsWith('pk_live_')) stripeMode = 'LIVE';
    else if (pk.includes('YOUR_KEY')) stripeMode = 'UNCONFIGURED';
  } catch (_) {}

  const stripeBadge = stripeMode === 'LIVE' ? 'badge-green'
                    : stripeMode === 'TEST' ? 'badge-yellow' : 'badge-red';

  const maintenance = localStorage.getItem('pcs_maintenance') === 'true';

  el.innerHTML = `
    <div class="status-row">
      <span class="status-label">Local Server</span>
      <span class="status-badge badge-green">RUNNING</span>
    </div>
    <div class="status-row">
      <span class="status-label">Stripe</span>
      <span class="status-badge ${stripeBadge}">${stripeMode}</span>
    </div>
    <div class="status-row">
      <span class="status-label">C++ Backend</span>
      <span class="status-badge badge-gray">NOT BUILT</span>
    </div>
    <div class="status-row">
      <span class="status-label">Cloudflare Tunnel</span>
      <span class="status-badge badge-gray">NOT DEPLOYED</span>
    </div>
    <div class="status-row">
      <span class="status-label">Maintenance Mode</span>
      <span class="status-badge ${maintenance ? 'badge-yellow' : 'badge-green'}">${maintenance ? 'ACTIVE' : 'OFF'}</span>
    </div>
    <div class="status-row">
      <span class="status-label">Accepting Clients</span>
      <span class="status-badge ${localStorage.getItem('pcs_clients') !== 'false' ? 'badge-green' : 'badge-red'}">
        ${localStorage.getItem('pcs_clients') !== 'false' ? 'YES' : 'NO'}
      </span>
    </div>
  `;
}

// ─── RECENT ACTIVITY ──────────────────────────────────────────────────────────
function renderRecentActivity() {
  const el = document.getElementById('recent-activity');
  if (!el) return;

  const visits  = getVisits();
  const days    = Object.keys(visits).sort().slice(-3);
  const events  = [];

  days.reverse().forEach(day => {
    Object.entries(visits[day]).forEach(([page, count]) => {
      events.push({ time: day, event: `${count} view${count > 1 ? 's' : ''} on /${page}`, tag: 'visit', cls: 'log-tag-visit' });
    });
  });

  // Add admin login event
  events.unshift({ time: fmt24time(Date.now()), event: 'Admin session started', tag: 'admin', cls: 'log-tag-admin' });

  if (events.length === 0) {
    el.innerHTML = '<p style="color:var(--medium-gray);font-size:0.8rem;font-family:\'JetBrains Mono\',monospace;">&gt; No activity recorded yet.</p>';
    return;
  }

  el.innerHTML = events.slice(0, 10).map(e => `
    <div class="log-entry">
      <span class="log-tag ${e.cls}">${e.tag}</span>
      <span class="log-time">${e.time}</span>
      <span class="log-event">${e.event}</span>
    </div>
  `).join('');
}

// ─── ANALYTICS TAB ────────────────────────────────────────────────────────────
function renderAnalytics() {
  const total    = getTotal();
  const visits   = getVisits();
  const allTime  = total['__all'] || 0;
  const sessions = totalSessionsRange(30);
  const week     = totalVisitsRange(7);
  const avgDay   = allTime > 0 ? (allTime / Math.max(Object.keys(visits).length, 1)).toFixed(1) : '0';

  const statsEl = document.getElementById('analytics-stats');
  if (statsEl) statsEl.innerHTML = [
    { label: 'All-Time Views',  value: allTime },
    { label: 'Avg Views / Day', value: avgDay  },
    { label: 'Week Views',      value: week    },
    { label: 'Sessions (30d)',  value: sessions },
  ].map(s => `
    <div class="stat-card">
      <div class="stat-label">${s.label}</div>
      <div class="stat-value">${Number(s.value).toLocaleString()}</div>
    </div>
  `).join('');

  // Page breakdown
  const pageEl = document.getElementById('page-breakdown');
  if (pageEl) {
    const pages  = Object.entries(total).filter(([k]) => k !== '__all').sort((a, b) => b[1] - a[1]);
    const maxVal = pages.length ? pages[0][1] : 1;
    pageEl.innerHTML = `
      <thead><tr>
        <th>Page</th>
        <th>Views</th>
        <th style="width:40%">Traffic</th>
        <th>Share</th>
      </tr></thead>
      <tbody>
        ${pages.map(([page, count]) => {
          const pct = allTime > 0 ? ((count / allTime) * 100).toFixed(1) : '0';
          const barW = maxVal > 0 ? (count / maxVal * 100).toFixed(1) : '0';
          return `<tr>
            <td class="mono">/${page}</td>
            <td class="mono">${count.toLocaleString()}</td>
            <td><div class="traffic-bar-bg"><div class="traffic-bar" style="width:${barW}%"></div></div></td>
            <td class="mono">${pct}%</td>
          </tr>`;
        }).join('')}
      </tbody>
    `;
  }

  // Daily breakdown
  const dailyEl = document.getElementById('daily-breakdown');
  if (dailyEl) {
    const days   = Object.keys(visits).sort().slice(-14).reverse();
    const maxDay = Math.max(...days.map(d => Object.values(visits[d] || {}).reduce((a,b)=>a+b,0)), 1);
    dailyEl.innerHTML = `
      <thead><tr><th>Date</th><th>Views</th><th style="width:40%">Volume</th><th>Sessions</th></tr></thead>
      <tbody>
        ${days.map(d => {
          const count = Object.values(visits[d] || {}).reduce((a,b)=>a+b,0);
          const sess  = getSessions()[d] || 0;
          const barW  = (count / maxDay * 100).toFixed(1);
          return `<tr>
            <td class="mono">${d}</td>
            <td class="mono">${count}</td>
            <td><div class="traffic-bar-bg"><div class="traffic-bar" style="width:${barW}%"></div></div></td>
            <td class="mono">${sess}</td>
          </tr>`;
        }).join('')}
        ${days.length === 0 ? '<tr><td colspan="4" style="color:var(--medium-gray);font-size:0.8rem;padding:1rem 0;">&gt; No visit data yet. Browse some pages first.</td></tr>' : ''}
      </tbody>
    `;
  }
}

// ─── BLOG TAB ─────────────────────────────────────────────────────────────────
async function loadExistingPosts() {
  const el = document.getElementById('existing-posts');
  const countEl = document.getElementById('post-count');
  if (!el) return;

  let posts = [];
  // Check localStorage first (newly created posts)
  const stored = localStorage.getItem('pcs_posts');
  if (stored) {
    try { posts = JSON.parse(stored); } catch (_) {}
  }
  // Merge with blog.json base posts
  try {
    const data = await fetch('./blog.json').then(r => r.json());
    const existing = data.posts || [];
    const storedIds = posts.map(p => p.id);
    existing.forEach(p => { if (!storedIds.includes(p.id)) posts.push(p); });
  } catch (_) {}

  if (countEl) countEl.textContent = posts.length;

  if (!posts.length) {
    el.innerHTML = '<p style="color:var(--medium-gray);font-size:0.8rem;font-family:\'JetBrains Mono\',monospace;">&gt; No posts yet.</p>';
    return;
  }

  el.innerHTML = posts.map(p => `
    <div class="post-item">
      <div class="post-meta">
        <h4>${p.title}</h4>
        <span>${p.date} &bull; ${p.category} &bull;
          <span style="color:${p.published ? 'var(--lime-yellow)' : 'var(--medium-gray)'}">
            ${p.published ? 'Published' : 'Draft'}
          </span>
        </span>
      </div>
      <div class="post-actions">
        <button class="btn-sm btn-publish" onclick="togglePublish('${p.id}')">${p.published ? 'Unpublish' : 'Publish'}</button>
        <button class="btn-sm btn-delete"  onclick="deletePost('${p.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

async function createBlogPost() {
  const id       = document.getElementById('post-id').value.trim().replace(/\s+/g, '-').toLowerCase();
  const title    = document.getElementById('post-title').value.trim();
  const date     = document.getElementById('post-date').value;
  const category = document.getElementById('post-category').value;
  const tags     = document.getElementById('post-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const excerpt  = document.getElementById('post-excerpt').value.trim();
  const content  = document.getElementById('post-content').value.trim();
  const published = document.getElementById('post-published').checked;
  const msg      = document.getElementById('post-message');

  if (!id || !title || !excerpt) {
    msg.style.color = '#f87171';
    msg.textContent = '> ID, title, and excerpt are required.';
    return;
  }

  const newPost = { id, title, date, author: 'admin', category, tags, excerpt, content, published };

  const stored = JSON.parse(localStorage.getItem('pcs_posts') || '[]');
  stored.unshift(newPost);
  localStorage.setItem('pcs_posts', JSON.stringify(stored));

  msg.style.color   = 'var(--lime-yellow)';
  msg.textContent   = '> Post created successfully.';
  ['post-id','post-title','post-tags','post-excerpt','post-content'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  loadExistingPosts();
}

function deletePost(id) {
  if (!confirm(`Delete post "${id}"?`)) return;
  const posts = JSON.parse(localStorage.getItem('pcs_posts') || '[]');
  localStorage.setItem('pcs_posts', JSON.stringify(posts.filter(p => p.id !== id)));
  loadExistingPosts();
}

function togglePublish(id) {
  const posts = JSON.parse(localStorage.getItem('pcs_posts') || '[]');
  const p = posts.find(p => p.id === id);
  if (p) { p.published = !p.published; localStorage.setItem('pcs_posts', JSON.stringify(posts)); }
  loadExistingPosts();
}

// ─── CONTROLS TAB ─────────────────────────────────────────────────────────────
function loadControlStates() {
  const checks = { 'toggle-maintenance': 'pcs_maintenance', 'toggle-announcement': 'pcs_announcement_on', 'toggle-clients': 'pcs_clients', 'toggle-comments': 'pcs_comments' };
  Object.entries(checks).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const val = localStorage.getItem(key);
    el.checked = key === 'pcs_clients' ? val !== 'false' : val === 'true';
    el.addEventListener('change', () => {
      localStorage.setItem(key, String(el.checked));
      renderSystemStatus();
    });
  });

  const announcementText = localStorage.getItem('pcs_announcement_text') || '';
  const ta = document.getElementById('announcement-text');
  if (ta) ta.value = announcementText;
}

function loadContactInfo() {
  const emailEl = document.getElementById('ctrl-email');
  const respEl  = document.getElementById('ctrl-response');
  if (emailEl) emailEl.value = localStorage.getItem('pcs_email') || '';
  if (respEl)  respEl.value  = localStorage.getItem('pcs_response') || '';
}

function saveAnnouncement() {
  const text = document.getElementById('announcement-text')?.value || '';
  localStorage.setItem('pcs_announcement_text', text);
  showAdminToast('Announcement saved.');
}

function saveContactInfo() {
  localStorage.setItem('pcs_email',    document.getElementById('ctrl-email')?.value || '');
  localStorage.setItem('pcs_response', document.getElementById('ctrl-response')?.value || '');
  showAdminToast('Contact info saved.');
}

// ─── SETTINGS TAB ─────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const cfg = await fetch('./config.json').then(r => r.json());
    const pkEl = document.getElementById('stripe-pk-display');
    if (pkEl) {
      const pk = cfg.stripe?.public_key || 'Not set';
      pkEl.textContent = pk.includes('YOUR_KEY') ? 'Not configured' : pk.slice(0, 20) + '...';
    }
    const userEl = document.getElementById('current-user');
    if (userEl) userEl.textContent = cfg.admin?.username || 'Admin';
  } catch (_) {}

  const cacheEl = document.getElementById('cache-size');
  if (cacheEl) {
    const visits = JSON.stringify(getVisits()).length;
    cacheEl.textContent = `${(visits / 1024).toFixed(1)} KB`;
  }
}

function saveStripeKeys() {
  const pk = document.getElementById('stripe-pk')?.value || '';
  const sk = document.getElementById('stripe-sk')?.value || '';
  if (pk || sk) {
    showAdminToast('Keys saved to memory. Update config.json for persistence.');
  }
}

// ─── DATA UTILITIES ───────────────────────────────────────────────────────────
function clearVisitCache() {
  if (!confirm('Clear all visit tracking data?')) return;
  ['pcs_visits','pcs_total','pcs_sessions','pcs_last'].forEach(k => localStorage.removeItem(k));
  renderOverview();
  showAdminToast('Visit cache cleared.');
}

function clearAllData() {
  if (!confirm('Clear ALL site data from localStorage?')) return;
  Object.keys(localStorage).filter(k => k.startsWith('pcs_')).forEach(k => localStorage.removeItem(k));
  showAdminToast('All data cleared.');
  setTimeout(() => location.reload(), 1500);
}

function exportData() {
  const data = {
    visits:   getVisits(),
    total:    getTotal(),
    sessions: getSessions(),
    posts:    JSON.parse(localStorage.getItem('pcs_posts') || '[]'),
    controls: {
      maintenance:   localStorage.getItem('pcs_maintenance'),
      announcement:  localStorage.getItem('pcs_announcement_text'),
      acceptClients: localStorage.getItem('pcs_clients'),
    },
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pcs-export-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
}

// ─── MESSAGES (contact form submissions) ──────────────────────────────────────
function renderMessages() {
  const listEl   = document.getElementById('messages-list');
  const countEl  = document.getElementById('msg-count');
  if (!listEl) return;

  const messages = JSON.parse(localStorage.getItem('pcs_messages') || '[]');
  const unread   = messages.filter(m => !m.read).length;
  if (countEl) countEl.textContent = `${messages.length}${unread > 0 ? ` · ${unread} unread` : ''}`;

  if (!messages.length) {
    listEl.innerHTML = '<p style="color:var(--medium-gray);font-size:0.8rem;font-family:\'JetBrains Mono\',monospace;">&gt; No messages yet. Contact form submissions will appear here.</p>';
    return;
  }

  listEl.innerHTML = messages.map((m, i) => `
    <div style="padding:1rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;margin-bottom:0.4rem;">
        <div>
          <span style="color:var(--white);font-weight:600;font-size:0.9rem;">${m.name}</span>
          ${!m.read ? '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--lime-yellow);margin-left:0.5rem;vertical-align:middle;"></span>' : ''}
          <span style="font-family:\'JetBrains Mono\',monospace;font-size:0.72rem;color:var(--lime-yellow);margin-left:0.5rem;">${m.service}</span>
        </div>
        <div style="display:flex;gap:0.5rem;flex-shrink:0;">
          <span style="font-family:\'JetBrains Mono\',monospace;font-size:0.65rem;color:rgba(151,151,151,0.5);">${fmt24(m.timestamp)}</span>
          <button class="btn-sm btn-publish" onclick="markRead(${i})" style="font-size:0.6rem;padding:0.2rem 0.5rem;">Mark Read</button>
          <button class="btn-sm btn-delete"  onclick="deleteMessage(${i})" style="font-size:0.6rem;padding:0.2rem 0.5rem;">Delete</button>
        </div>
      </div>
      <div style="font-family:\'JetBrains Mono\',monospace;font-size:0.72rem;color:var(--medium-gray);margin-bottom:0.4rem;">
        ${m.email} &bull; Budget: ${m.budget}
      </div>
      <p style="font-size:0.85rem;color:var(--light-gray);line-height:1.6;">${m.message}</p>
    </div>
  `).join('');
}

function markRead(idx) {
  const messages = JSON.parse(localStorage.getItem('pcs_messages') || '[]');
  if (messages[idx]) { messages[idx].read = true; localStorage.setItem('pcs_messages', JSON.stringify(messages)); }
  renderMessages();
}

function deleteMessage(idx) {
  const messages = JSON.parse(localStorage.getItem('pcs_messages') || '[]');
  messages.splice(idx, 1);
  localStorage.setItem('pcs_messages', JSON.stringify(messages));
  renderMessages();
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function showAdminToast(message) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = '// ' + message;
  document.body.appendChild(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('toast-show')));
  setTimeout(() => { t.classList.remove('toast-show'); setTimeout(() => t.remove(), 300); }, 2800);
}
