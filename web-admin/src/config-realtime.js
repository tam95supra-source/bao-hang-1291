import '@fontsource-variable/inter/wght.css';
import { createClient } from './backend-runtime.js';

const BACKEND_BRIDGE_URL = 'https://backend.bao-hang-1291.invalid';
const BRIDGE_PUBLIC_KEY = 'compat-public';
const API_BASE = `${BACKEND_BRIDGE_URL}/functions/v1/web-api`;
const SESSION_KEY = 'bao-hang-1291-web-session';
const ISSUE_TOPIC = 'site:1291:issues';
const CONFIG_TOPIC = 'site:1291:config';
const CONFIG_ROLES = new Set(['ADMIN', 'ADMIN_INVENT']);
const ISSUE_TABS = new Set(['events', 'overview', 'picker']);
const FALLBACK_INTERVAL_MS = 6_000;

const client = createClient(BACKEND_BRIDGE_URL, BRIDGE_PUBLIC_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 6 } },
});

let issueChannel = null;
let configChannel = null;
let connectedToken = '';
let connectedRole = '';
let issueFallbackTimer = null;
let issueConnectTimer = null;
let issueRefreshTimer = null;

function readSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    return session?.access_token && session?.profile?.role ? session : null;
  } catch {
    return null;
  }
}

function setTicketRealtimeState(value) {
  document.body.dataset.ticketRealtime = value;
  const chip = document.querySelector('[data-health="REALTIME"]');
  const label = chip?.querySelector('em');
  if (!chip || !label) return;
  chip.classList.toggle('good', value === 'online');
  chip.classList.toggle('warn', value === 'fallback' || value === 'error');
  label.textContent = value === 'online' ? 'ONLINE' : value === 'connecting' ? 'ĐANG NỐI' : 'DỰ PHÒNG';
}

function activeTab() {
  return document.querySelector('.tabs button.active')?.dataset?.tab || '';
}

function refreshVisibleIssues() {
  if (document.hidden || !ISSUE_TABS.has(activeTab())) return;
  const refreshBoard = document.getElementById('refreshBoard');
  if (refreshBoard) {
    refreshBoard.click();
    return;
  }
  document.querySelector('.tabs button.active')?.click();
}

function scheduleIssueRefresh(delay = 90) {
  clearTimeout(issueRefreshTimer);
  issueRefreshTimer = setTimeout(refreshVisibleIssues, delay);
}

function stopIssueFallback() {
  clearInterval(issueFallbackTimer);
  issueFallbackTimer = null;
}

function startIssueFallback() {
  if (issueFallbackTimer || document.hidden || !readSession()) return;
  setTicketRealtimeState('fallback');
  issueFallbackTimer = setInterval(() => {
    if (!document.hidden && ISSUE_TABS.has(activeTab())) refreshVisibleIssues();
  }, FALLBACK_INTERVAL_MS);
}

async function api(action, accessToken) {
  const response = await fetch(`${API_BASE}/${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: BRIDGE_PUBLIC_KEY,
      authorization: `Bearer ${accessToken}`,
    },
    body: '{}',
  });
  if (!response.ok) throw new Error(`config realtime refresh ${response.status}`);
  return response.json();
}

function setValue(id, value) {
  const input = document.getElementById(id);
  if (!input || document.activeElement === input) return;
  input.value = String(value ?? '');
}

function setChecked(id, value) {
  const input = document.getElementById(id);
  if (!input || document.activeElement === input) return;
  input.checked = Boolean(value);
}

async function refreshVisibleConfig() {
  const session = readSession();
  if (!session || document.hidden || !CONFIG_ROLES.has(session.profile.role)) return;
  try {
    if (document.getElementById('ackMin')) {
      const config = await api('get-operational-config', session.access_token);
      setValue('ackMin', config.acknowledge_minutes);
      setValue('reminderMin', config.reminder_minutes);
      setValue('replenishMin', config.replenish_minutes);
      setValue('pickerAckMin', config.picker_ack_reminder_minutes);
      setChecked('autoSkipEnabled', config.auto_skip_enabled);
      setValue('autoSkipAfter', config.auto_skip_after_minutes);
    }
    if (document.getElementById('retentionDays')) {
      const config = await api('get-config', session.access_token);
      setValue('retentionDays', config.retention_days);
      setValue('logDays', config.diagnostic_log_retention_days);
      setChecked('staffAuto', config.staff_auto_sync_enabled);
      setValue('staffInterval', config.staff_sync_interval_minutes);
      setChecked('cfgAutoSkip', config.auto_skip_enabled);
      setValue('cfgAutoSkipAfter', config.auto_skip_after_minutes);
    }
    document.body.dataset.configRealtime = 'synced';
  } catch {
    document.body.dataset.configRealtime = 'retry-on-next-event';
  }
}

async function disconnect() {
  clearTimeout(issueConnectTimer);
  issueConnectTimer = null;
  clearTimeout(issueRefreshTimer);
  issueRefreshTimer = null;
  stopIssueFallback();
  const channels = [issueChannel, configChannel].filter(Boolean);
  issueChannel = null;
  configChannel = null;
  connectedToken = '';
  connectedRole = '';
  for (const channel of channels) await client.removeChannel(channel).catch(() => {});
  setTicketRealtimeState('offline');
}

function subscribeIssue(session) {
  setTicketRealtimeState('connecting');
  issueChannel = client
    .channel(ISSUE_TOPIC, { config: { private: true } })
    .on('broadcast', { event: 'issue_changed' }, () => scheduleIssueRefresh())
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        stopIssueFallback();
        setTicketRealtimeState('online');
        scheduleIssueRefresh(0);
        return;
      }
      if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) startIssueFallback();
    });
  clearTimeout(issueConnectTimer);
  issueConnectTimer = setTimeout(() => {
    if (document.body.dataset.ticketRealtime !== 'online') startIssueFallback();
  }, 5_000);
}

function subscribeConfig(session) {
  if (!CONFIG_ROLES.has(session.profile.role)) return;
  configChannel = client
    .channel(CONFIG_TOPIC, { config: { private: true } })
    .on('broadcast', { event: 'config_changed' }, refreshVisibleConfig)
    .subscribe((status) => {
      document.body.dataset.configRealtime = status === 'SUBSCRIBED' ? 'online' : status.toLowerCase();
    });
}

async function connect() {
  const session = readSession();
  if (!session || document.hidden) {
    await disconnect();
    return;
  }
  if (issueChannel && connectedToken === session.access_token && connectedRole === session.profile.role) return;
  await disconnect();
  connectedToken = session.access_token;
  connectedRole = session.profile.role;
  client.realtime.setAuth(session.access_token);
  subscribeIssue(session);
  subscribeConfig(session);
}

const originalSetItem = Storage.prototype.setItem;
Storage.prototype.setItem = function setItem(key, value) {
  originalSetItem.call(this, key, value);
  if (this === sessionStorage && key === SESSION_KEY) queueMicrotask(connect);
};

const originalRemoveItem = Storage.prototype.removeItem;
Storage.prototype.removeItem = function removeItem(key) {
  originalRemoveItem.call(this, key);
  if (this === sessionStorage && key === SESSION_KEY) queueMicrotask(disconnect);
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden) disconnect();
  else {
    connect();
    scheduleIssueRefresh(0);
    refreshVisibleConfig();
  }
});
window.addEventListener('pageshow', () => {
  connect();
  scheduleIssueRefresh(0);
});
connect();
