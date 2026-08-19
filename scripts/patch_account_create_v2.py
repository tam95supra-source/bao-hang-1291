from pathlib import Path
import re

backend = Path('web-admin/src/backend-runtime.js')
s = backend.read_text(encoding='utf-8')
marker = 'function withTestRole(payload, init) {'
helper = r'''async function createManagedUser(body, init) {
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

'''
if 'async function createManagedUser(body, init)' not in s:
    if marker not in s:
        raise SystemExit('BACKEND_MARKER_MISSING')
    s = s.replace(marker, helper + marker, 1)
old = "if (action === 'create-user') return worker('update-user', { ...body, initial_password: body.initial_password || body.password || '' }, init)"
new = "if (action === 'create-user') return createManagedUser(body, init)"
if old in s:
    s = s.replace(old, new, 1)
if new not in s:
    raise SystemExit('CREATE_ROUTE_MISSING')
backend.write_text(s, encoding='utf-8')

ui = Path('web-admin/src/ops-console.js')
s = ui.read_text(encoding='utf-8')
s = s.replace('`<button class="secondary" id="opsStaffSync">Đồng bộ nguồn ngay</button>`', '`<span class="ops-source-label">DỮ LIỆU THEO NGÀY · DANH SÁCH NHÂN SỰ</span>`')
s = s.replace("const auto = Boolean(service.config?.staff_auto_sync_enabled);\n    const interval = Number(service.config?.staff_sync_interval_minutes || 60);", "const auto = true;\n    const interval = 60;")
s = re.sub(r"\n    \$\('#opsStaffSync'\)\.onclick = async \(\) => \{.*?\n    \};", '', s, count=1, flags=re.S)
s = s.replace('Nguồn Google Sheet: <b>', 'DỮ LIỆU THEO NGÀY: <b>')
s = s.replace("Tự đồng bộ nguồn: <b>${auto ? `mỗi ${interval} phút` : 'đang tắt'}</b>", "Tự đồng bộ nguồn: <b>mỗi ${interval} phút</b>")
if "$('#opsStaffSync').onclick" in s:
    raise SystemExit('LEGACY_SYNC_CLICK_REMAINS')
ui.write_text(s, encoding='utf-8')
