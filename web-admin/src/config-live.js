import '@fontsource-variable/inter/wght.css';
import { createClient } from './backend-runtime.js';

const BACKEND_BRIDGE_URL = 'https://backend.bao-hang-1291.invalid';
const BRIDGE_PUBLIC_KEY = 'compat-public';
const API_BASE = `${BACKEND_BRIDGE_URL}/api/web-api`;
const SESSION_KEY = 'bao-hang-1291-web-session';
const CONFIG_TOPIC = 'site:1291:config';
const CONFIG_ROLES = new Set(['ADMIN', 'ADMIN_INVENT']);

const client = createClient(BACKEND_BRIDGE_URL, BRIDGE_PUBLIC_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 4 } },
});

let channel = null;
let connectedToken = '';
let connectedRole = '';

function readSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    return session?.access_token && session?.profile?.role ? session : null;
  } catch { return null; }
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
  if (!response.ok) throw new Error(`config refresh ${response.status}`);
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
      setValue('foundItemReminderMin', config.found_item_reminder_minutes || 5);
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
    document.body.dataset.configRealtime = 'online';
  } catch {
    document.body.dataset.configRealtime = 'retry';
  }
}
async function disconnect() {
  const current = channel;
  channel = null;
  connectedToken = '';
  connectedRole = '';
  if (current) await client.removeChannel(current).catch(() => {});
  document.body.dataset.configRealtime = 'offline';
}
async function connect() {
  const session = readSession();
  if (!session || document.hidden || !CONFIG_ROLES.has(session.profile.role)) {
    await disconnect();
    return;
  }
  if (channel && connectedToken === session.access_token && connectedRole === session.profile.role) return;
  await disconnect();
  connectedToken = session.access_token;
  connectedRole = session.profile.role;
  client.realtime.setAuth(session.access_token);
  document.body.dataset.configRealtime = 'connecting';
  channel = client
    .channel(CONFIG_TOPIC, { config: { private: true } })
    .on('broadcast', { event: 'config_changed' }, refreshVisibleConfig)
    .subscribe((status) => {
      document.body.dataset.configRealtime = status === 'SUBSCRIBED' ? 'online' : status.toLowerCase();
      if (status === 'SUBSCRIBED') refreshVisibleConfig();
    });
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
  else { connect(); refreshVisibleConfig(); }
});
window.addEventListener('pageshow', () => { connect(); refreshVisibleConfig(); });
connect();
