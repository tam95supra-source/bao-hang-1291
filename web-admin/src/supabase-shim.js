const FIREBASE_API_KEY = 'AIzaSyB-n368fntzxsuuLlvte9NXhcuX0DDbTXM'
const FIREBASE_PROJECT = 'bao-hang-1291'
const NEON_API = 'https://ep-morning-bread-az3w94qb.apirest.c-3.ap-southeast-1.aws.neon.tech/neondb/rest/v1'
const WORKER_URL = (globalThis.__BAO_HANG_WORKER_URL__ || '').trim()

let firebaseRuntimePromise
async function firebaseRuntime() {
  if (!firebaseRuntimePromise) {
    firebaseRuntimePromise = Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
    ]).then(([appModule, authModule, firestoreModule]) => {
      const app = appModule.getApps().find((item) => item.name === '[DEFAULT]') || appModule.initializeApp({
        apiKey: FIREBASE_API_KEY,
        authDomain: `${FIREBASE_PROJECT}.firebaseapp.com`,
        projectId: FIREBASE_PROJECT,
      })
      const auth = authModule.getAuth(app)
      authModule.setPersistence(auth, authModule.browserLocalPersistence).catch(() => {})
      return {
        auth,
        firestore: firestoreModule.getFirestore(app),
        signInWithEmailAndPassword: authModule.signInWithEmailAndPassword,
        signOut: authModule.signOut,
        doc: firestoreModule.doc,
        onSnapshot: firestoreModule.onSnapshot,
      }
    })
  }
  return firebaseRuntimePromise
}

let installed = false
let realtimeToken = ''
const originalFetch = globalThis.fetch.bind(globalThis)

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function parseBody(init) {
  if (!init?.body) return {}
  if (typeof init.body === 'string') {
    try { return JSON.parse(init.body) } catch { return {} }
  }
  return {}
}

function headerValue(init, name) {
  const headers = new Headers(init?.headers || {})
  return headers.get(name) || ''
}

function bearer(init) {
  const value = headerValue(init, 'authorization')
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : ''
}

function testRole(init) {
  const raw = (headerValue(init, 'x-admin-test-role') || headerValue(init, 'x-test-role')).trim().toUpperCase()
  return ['ADMIN_INVENT', 'INVENT', 'PICKER'].includes(raw) ? raw : null
}

async function supabaseLikeLogin(body) {
  const { auth, signInWithEmailAndPassword } = await firebaseRuntime()
  const credential = await signInWithEmailAndPassword(auth, String(body.email || ''), String(body.password || ''))
  const token = await credential.user.getIdToken()
  realtimeToken = token
  return {
    access_token: token,
    refresh_token: credential.user.refreshToken || '',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: credential.user.uid, email: credential.user.email },
  }
}

async function refreshFirebase(body) {
  const refreshToken = String(body.refresh_token || '')
  const { auth } = await firebaseRuntime()
  if (auth.currentUser) {
    const token = await auth.currentUser.getIdToken(true)
    realtimeToken = token
    return {
      access_token: token,
      refresh_token: auth.currentUser.refreshToken || refreshToken,
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: auth.currentUser.uid, email: auth.currentUser.email },
    }
  }
  const response = await originalFetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload?.error?.message || 'TOKEN_REFRESH_FAILED')
  realtimeToken = payload.id_token || ''
  return {
    access_token: payload.id_token,
    refresh_token: payload.refresh_token || refreshToken,
    expires_in: Number(payload.expires_in || 3600),
    token_type: 'bearer',
    user: { id: payload.user_id || '' },
  }
}

function withTestRole(payload, init) {
  return { ...payload, p_test_role: testRole(init) }
}

function mapRpc(action, body, init) {
  const b = body || {}
  const base = (extra = {}) => withTestRole(extra, init)
  switch (action) {
    case 'session-profile': return ['api_session_profile_rpc', base()]
    case 'search-skus': return ['api_search_skus_rpc', base({ p_query: b.query || '', p_limit: b.limit || 20 })]
    case 'picker-search-digits': return ['api_picker_search_digits_rpc', base({ p_query: b.query || '', p_limit: b.limit || 20 })]
    case 'report-shortage': return ['report_shortage_rpc', { p_sku: b.sku, p_client_request_id: b.client_request_id }]
    case 'active-issues': return ['api_active_issues_rpc', base({ p_limit: b.limit || 250 })]
    case 'issue-board': return ['api_issue_board_rpc', base()]
    case 'withdrawn-board': return ['api_withdrawn_board_rpc', base()]
    case 'issue-detail': return ['api_issue_detail_rpc', base({ p_issue_id: b.issue_id })]
    case 'picker-my-issues':
    case 'my-issues': return ['api_picker_my_issues_rpc', base()]
    case 'claim-issue': return ['api_claim_issue_rpc', base({ p_issue_id: b.issue_id, p_client_request_id: b.client_request_id || crypto.randomUUID() })]
    case 'reassign-issue': return ['api_reassign_issue_rpc', base({ p_issue_id: b.issue_id, p_new_assignee_id: b.new_assignee_id, p_reason: b.reason || '', p_client_request_id: b.client_request_id || crypto.randomUUID() })]
    case 'update-issue': return ['api_update_issue_rpc', base({ p_issue_id: b.issue_id, p_action: b.action, p_client_request_id: b.client_request_id || crypto.randomUUID() })]
    case 'restore-skipped': return ['api_restore_skipped_issue_rpc', base({ p_issue_id: b.issue_id, p_reason: b.reason || '' })]
    case 'withdraw-shortage': return ['api_withdraw_shortage_rpc', base({ p_issue_id: b.issue_id })]
    case 'pending-alerts': return ['api_pending_alerts_rpc', base()]
    case 'mark-alert-received': return ['api_mark_alert_received_rpc', base({ p_event_id: b.event_id })]
    case 'mark-alert-displayed': return ['api_mark_alert_displayed_rpc', base({ p_event_id: b.event_id })]
    case 'ack-alert': return ['api_ack_alert_rpc', base({ p_event_id: b.event_id })]
    case 'register-device': return ['api_register_device_rpc', base({ p_fcm_token: b.fcm_token, p_device_name: b.device_name || '', p_app_version: b.app_version || '', p_platform: b.platform || 'web' })]
    case 'sync-catalog': return ['api_sync_catalog_rpc', base({ p_after_sku: b.after_sku || null, p_updated_since: b.updated_since || null, p_sync_until: b.sync_until || null, p_limit: b.limit || 1000 })]
    case 'get-operational-config': return ['api_get_operational_config_rpc', base()]
    case 'save-operational-config': return ['api_save_operational_config_rpc', base({ p_acknowledge_minutes: b.acknowledge_minutes, p_reminder_minutes: b.reminder_minutes, p_replenish_minutes: b.replenish_minutes, p_picker_ack_reminder_minutes: b.picker_ack_reminder_minutes || 3, p_auto_skip_enabled: !!b.auto_skip_enabled, p_auto_skip_after_minutes: b.auto_skip_after_minutes || 120 })]
    case 'get-config': return ['api_get_config_rpc', base()]
    case 'save-config': return ['api_save_config_rpc', base({ p_config: b })]
    case 'list-users': return ['api_list_users_rpc', base()]
    case 'staff-sync-status': return ['api_staff_sync_status_rpc', base({ p_limit: b.limit || 20 })]
    case 'admin-summary': return ['api_admin_summary_rpc', base()]
    case 'service-metrics': return ['api_service_metrics_rpc', base()]
    case 'reports-summary': return ['api_reports_summary_rpc', base()]
    case 'issue-history': return ['api_issue_history_rpc', base({ p_limit: b.limit || 200 })]
    case 'audit-history': return ['api_audit_history_rpc', base({ p_limit: b.limit || 150 })]
    case 'list-logs': return ['api_list_logs_rpc', base({ p_limit: b.limit || 100, p_employee_code: b.employee_code || '' })]
    case 'import-skus': return ['api_import_skus_rpc', base({ p_items: b.items || [] })]
    case 'replace-catalog': return ['api_replace_catalog_rpc', base({ p_items: b.items || [], p_source_name: b.source_name || '' })]
    default: return null
  }
}

async function neonRpc(action, body, init) {
  const mapped = mapRpc(action, body, init)
  if (!mapped) return null
  const [rpc, params] = mapped
  const token = bearer(init) || realtimeToken
  const response = await originalFetch(`${NEON_API}/rpc/${encodeURIComponent(rpc)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  })
  const text = await response.text()
  return new Response(text, { status: response.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}

async function worker(action, body, init) {
  if (!WORKER_URL) return jsonResponse({ ok: false, error: 'WORKER_NOT_CONFIGURED' }, 503)
  const token = bearer(init) || realtimeToken
  return originalFetch(WORKER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, id_token: token, ...body }),
  })
}

async function compatibilityFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href)
  if (url.hostname !== 'compat.bao-hang-1291.invalid') return originalFetch(input, init)

  try {
    if (url.pathname === '/auth/v1/token') {
      const body = parseBody(init)
      const grant = url.searchParams.get('grant_type') || ''
      if (grant === 'password') return jsonResponse(await supabaseLikeLogin(body))
      if (grant === 'refresh_token') return jsonResponse(await refreshFirebase(body))
      return jsonResponse({ error: 'UNSUPPORTED_GRANT' }, 400)
    }
    if (url.pathname === '/auth/v1/logout') {
      const { auth, signOut } = await firebaseRuntime()
      await signOut(auth).catch(() => {})
      realtimeToken = ''
      return jsonResponse({}, 204)
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const target = new URL(NEON_API + url.pathname.slice('/rest/v1'.length) + url.search)
      const headers = new Headers(init.headers || {})
      headers.delete('apikey')
      return originalFetch(target, { ...init, headers })
    }
    const functionMatch = url.pathname.match(/^\/functions\/v1\/(web-api|api|issue-withdraw|admin-ops)\/([^/]+)$/)
    if (functionMatch) {
      const family = functionMatch[1]
      let action = decodeURIComponent(functionMatch[2])
      const body = parseBody(init)
      if (family === 'issue-withdraw') {
        action = ({ board:'withdrawn-board', search:'picker-search-digits', my:'picker-my-issues', withdraw:'withdraw-shortage' })[action] || action
      }
      if (family === 'admin-ops') {
        if (action === 'create-user') return worker('update-user', body, init)
        if (action === 'update-user') return worker('update-user', body, init)
        if (action === 'delete-user') return worker('user-disable', { user_id: body.id || body.user_id }, init)
      }
      if (['update-user', 'import-users', 'sync-google-sheet', 'staff-sync-now', 'upload-log', 'download-log', 'user-upsert', 'user-disable'].includes(action)) {
        return worker(action, body, init)
      }
      const response = await neonRpc(action, body, init)
      if (response) return response
      return jsonResponse({ error: `MIGRATION_ACTION_UNSUPPORTED:${action}` }, 400)
    }
    return jsonResponse({ error: 'SUPABASE_ENDPOINT_RETIRED' }, 410)
  } catch (error) {
    const message = String(error?.code || error?.message || error)
    const friendly = message.includes('auth/invalid-credential') ? 'Sai mã nhân viên hoặc mật khẩu' : message
    return jsonResponse({ error: friendly, message: friendly }, 400)
  }
}

function installFetchAdapter() {
  if (installed) return
  installed = true
  globalThis.fetch = compatibilityFetch
}

class ChannelShim {
  constructor(name) {
    this.name = name
    this.handlers = []
    this.unsub = null
    this.closed = false
  }

  on(type, filter, callback) {
    if (type === 'broadcast' && typeof callback === 'function') this.handlers.push({ filter, callback })
    return this
  }

  subscribe(statusCallback) {
    const topic = this.name.split(':').pop()
    if (!['issues', 'config', 'staff', 'catalog'].includes(topic)) {
      statusCallback?.('CHANNEL_ERROR')
      return this
    }
    this.closed = false
    statusCallback?.('CONNECTING')
    firebaseRuntime().then(({ firestore, doc, onSnapshot }) => {
      if (this.closed) return
      this.unsub = onSnapshot(
        doc(firestore, 'realtime', topic),
        (snapshot) => {
          if (!snapshot.exists()) return
          const event = snapshot.data() || {}
          this.handlers.forEach(({ filter, callback }) => {
            if (!filter?.event || filter.event === event.event_type) callback({ payload: event })
          })
        },
        () => statusCallback?.('CHANNEL_ERROR'),
      )
      statusCallback?.('SUBSCRIBED')
    }).catch(() => statusCallback?.('CHANNEL_ERROR'))
    return this
  }

  close() {
    this.closed = true
    this.unsub?.()
    this.unsub = null
  }
}

export function createClient() {
  installFetchAdapter()
  return {
    realtime: {
      setAuth(token) { realtimeToken = String(token || '') },
    },
    channel(name) { return new ChannelShim(String(name || '')) },
    removeChannel(channel) { channel?.close?.(); return Promise.resolve('ok') },
  }
}
