import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://oedasgcdjppjwidhlqdr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_LGgDehtHMSyeJ1XyJDvQiQ_cdlqIKq7';
const API_BASE = `${SUPABASE_URL}/functions/v1/web-api`;
const SESSION_KEY = 'bao-hang-1291-web-session';
const CONFIG_TOPIC = 'site:1291:config';
const ALLOWED_ROLES = new Set(['ADMIN', 'ADMIN_INVENT']);

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 4 } },
});

let channel = null;
let connectedToken = '';

function readSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    return session?.access_token && ALLOWED_ROLES.has(session?.profile?.role) ? session : null;
  } catch {
    return null;
  }
}

async function disconnect() {
  const previous = channel;
  channel = null;
  connectedToken = '';
  if (previous) await client.removeChannel(previous).catch(() => {});
}

async function api(action, accessToken) {
  const response = await fetch(`${API_BASE}/${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
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
  if (!session || document.hidden) return;
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

async function connect() {
  const session = readSession();
  if (!session || document.hidden) {
    await disconnect();
    return;
  }
  if (channel && connectedToken === session.access_token) return;
  await disconnect();
  connectedToken = session.access_token;
  client.realtime.setAuth(session.access_token);
  channel = client
    .channel(CONFIG_TOPIC, { config: { private: true } })
    .on('broadcast', { event: 'config_changed' }, refreshVisibleConfig)
    .subscribe((status) => {
      document.body.dataset.configRealtime = status === 'SUBSCRIBED' ? 'online' : status.toLowerCase();
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
  if (document.hidden) disconnect(); else connect();
});
window.addEventListener('pageshow', connect);
connect();
