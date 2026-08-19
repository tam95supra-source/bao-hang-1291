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
        authDomain: `${FIREBASE_PROJECT}.web.app`,
        projectId: FIREBASE_PROJECT,
      })
      let auth
      try {
        auth = authModule.initializeAuth(app, { persistence: authModule.browserLocalPersistence })
      } catch (error) {
        if (error?.code !== 'auth/already-initialized') throw error
        auth = authModule.getAuth(app)
      }
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

async function firebasePasswordLogin(body) {
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

async function createManagedUser(body, init) {
  const code = String(body?.employee_code || '').trim()
  const fullName = String(body?.full_name || '').trim()
  const role = String(body?.role || '').trim().toUpperCase()
  const password = String(body?.password || body?.initial_password || '')
  if (!/^[a-z0-9._-]+$/i.test(code)) return jsonResponse({ error: 'Mã nhân viên không hợp lệ.' }, 400)
  if (!fullName) return jsonResponse({ error: 'Họ tên không được để trống.' }, 400)
  if (!['ADMIN_INVENT', 'INVENT', 'PICKER'].includes(role)) return jsonResponse({ error: 'Quyền tài khoản không hợp lệ.' }, 400)
  if (password.length < 8) return jsonResponse({ error: 'Mật khẩu phải có ít nhất 8 ký tự.' }, 400)
  const adminToken = bearer(init) || realtimeToken
  if (!adminToken) return jsonResponse({ error: 'Phiên đăng nhập không tồn tại.' }, 401)
  const email = `${code.toLowerCase()}@bao-hang-1291.local`
  let createdIdToken = ''
  try {
    const signupResponse = await originalFetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
    })
    const signup = await signupResponse.json().catch(() => ({}))
    if (!signupResponse.ok || !signup.localId || !signup.idToken) {
      const raw = signup?.error?.message || 'FIREBASE_CREATE_FAILED'
      return jsonResponse({ error: String(raw).includes('EMAIL_EXISTS') ? 'Mã nhân viên đã có tài khoản.' : `Không tạo được tài khoản Firebase: ${raw}` }, 400)
    }
    createdIdToken = signup.idToken
    const updateResponse = await originalFetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: createdIdToken, displayName: fullName, returnSecureToken: true }),
    })
    const updated = await updateResponse.json().catch(() => ({}))
    if (!updateResponse.ok) throw new Error(updated?.error?.message || 'FIREBASE_PROFILE_UPDATE_FAILED')
    if (updated.idToken) createdIdToken = updated.idToken
    const neonResponse = await originalFetch(`${NEON_API}/rpc/api_admin_create_profile_rpc`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        p_user_id: signup.localId,
        p_employee_code: code,
        p_full_name: fullName,
        p_role: role,
        p_contractor: String(body?.contractor || ''),
        p_source_position: String(body?.source_position || ''),
        p_test_role: testRole(init),
      }),
    })
    const text = await neonResponse.text()
    let profile = {}
    try { profile = text ? JSON.parse(text) : {} } catch { profile = { message: text } }
    if (!neonResponse.ok) throw new Error(profile?.message || profile?.error || `NEON_${neonResponse.status}`)
    return jsonResponse({ ok: true, profile })
  } catch (error) {
    if (createdIdToken) {
      try {
        await originalFetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: createdIdToken }),
        })
      } catch {}
    }
    const raw = String(error?.message || error)
    const message = raw.includes('FORBIDDEN') ? 'Tài khoản hiện tại không có quyền tạo quyền đã chọn.' : raw.includes('EMPLOYEE_CODE_EXISTS') ? 'Mã nhân viên đã tồn tại.' : raw
    return jsonResponse({ error: message }, raw.includes('FORBIDDEN') ? 403 : 400)
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
    // text/plain keeps this a CORS-simple request. Apps Script parses the JSON body itself.
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ action, id_token: token, ...body }),
  })
}

async function backendFetchAdapter(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href)
  if (url.hostname !== 'backend.bao-hang-1291.invalid') return originalFetch(input, init)

  try {
    if (url.pathname === '/auth/token') {
      const body = parseBody(init)
      const grant = url.searchParams.get('grant_type') || ''
      if (grant === 'password') return jsonResponse(await firebasePasswordLogin(body))
      if (grant === 'refresh_token') return jsonResponse(await refreshFirebase(body))
      return jsonResponse({ error: 'UNSUPPORTED_GRANT' }, 400)
    }
    if (url.pathname === '/auth/logout') {
      const { auth, signOut } = await firebaseRuntime()
      await signOut(auth).catch(() => {})
      realtimeToken = ''
      return jsonResponse({}, 204)
    }
    if (url.pathname.startsWith('/data/')) {
      const target = new URL(NEON_API + url.pathname.slice('/data'.length) + url.search)
      const headers = new Headers(init.headers || {})
      headers.delete('apikey')
      return originalFetch(target, { ...init, headers })
    }
    const functionMatch = url.pathname.match(/^\/api\/(web-api|api|issue-withdraw|admin-ops)\/([^/]+)$/)
    if (functionMatch) {
      const family = functionMatch[1]
      let action = decodeURIComponent(functionMatch[2])
      const body = parseBody(init)
      if (family === 'issue-withdraw') {
        action = ({ board:'withdrawn-board', search:'picker-search-digits', my:'picker-my-issues', withdraw:'withdraw-shortage' })[action] || action
      }
      if (family === 'admin-ops') {
        if (action === 'create-user') return createManagedUser(body, init)
        if (action === 'update-user') return worker('update-user', body, init)
        if (action === 'delete-user') return worker('user-disable', { user_id: body.id || body.user_id }, init)
      }
      if (['update-user', 'import-users', 'sync-google-sheet', 'staff-sync-now', 'upload-log', 'download-log', 'user-upsert', 'user-disable'].includes(action)) {
        return worker(action, body, init)
      }
      const response = await neonRpc(action, body, init)
      if (response) return response
      return jsonResponse({ error: `BACKEND_ACTION_UNSUPPORTED:${action}` }, 400)
    }
    return jsonResponse({ error: 'LEGACY_ENDPOINT_RETIRED' }, 410)
  } catch (error) {
    const message = String(error?.code || error?.message || error)
    const friendly = message.includes('auth/invalid-credential') ? 'Sai mã nhân viên hoặc mật khẩu' : message
    return jsonResponse({ error: friendly, message: friendly }, 400)
  }
}

function installFetchAdapter() {
  if (installed) return
  installed = true
  globalThis.fetch = backendFetchAdapter
}

class BackendChannel {
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
    channel(name) { return new BackendChannel(String(name || '')) },
    removeChannel(channel) { channel?.close?.(); return Promise.resolve('ok') },
  }
}
