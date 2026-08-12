from pathlib import Path


def replace(path: str, old: str, new: str, count: int = 1):
    p = Path(path)
    text = p.read_text()
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f"{path}: expected {count}, found {actual}: {old[:100]!r}")
    p.write_text(text.replace(old, new, count))

# Permission model: Admin Invent may manage lower-level users only; server enforces scope.
replace(
    "app/src/main/java/vn/pickpack1291/baohang/data/Models.kt",
    "    val canManageUsers: Boolean get() = this == ADMIN",
    "    val canManageUsers: Boolean get() = this in setOf(ADMIN, ADMIN_INVENT)",
)

replace(
    "app/src/main/java/vn/pickpack1291/baohang/network/ApiClient.kt",
    '''    suspend fun importUsers(items: List<ImportUserRow>): JSONObject {''',
    '''    suspend fun listUsers(): List<UserProfile> {
        val array = invoke("list-users", JSONObject()).optJSONArray("users") ?: JSONArray()
        return buildList { for (i in 0 until array.length()) add(UserProfile.fromJson(array.getJSONObject(i))) }
    }

    suspend fun updateUser(
        id: String,
        employeeCode: String,
        fullName: String,
        contractor: String,
        role: vn.pickpack1291.baohang.data.UserRole,
        active: Boolean,
        newPassword: String
    ): UserProfile {
        val payload = JSONObject()
            .put("id", id)
            .put("employee_code", employeeCode)
            .put("full_name", fullName)
            .put("contractor", contractor)
            .put("role", role.wire)
            .put("active", active)
        if (newPassword.isNotBlank()) payload.put("new_password", newPassword)
        return UserProfile.fromJson(invoke("update-user", payload).getJSONObject("profile"))
    }

    suspend fun importUsers(items: List<ImportUserRow>): JSONObject {''',
)

replace(
    "app/src/main/java/vn/pickpack1291/baohang/data/AppRepository.kt",
    '''    suspend fun importSkus(items: List<SkuItem>) = api.importSkus(items)
    suspend fun importUsers(items: List<ImportUserRow>) = api.importUsers(items)''',
    '''    suspend fun importSkus(items: List<SkuItem>) = api.importSkus(items)
    suspend fun listUsers() = api.listUsers()
    suspend fun updateUser(user: UserProfile, employeeCode: String, fullName: String, contractor: String, role: UserRole, active: Boolean, newPassword: String) =
        api.updateUser(user.id, employeeCode, fullName, contractor, role, active, newPassword).also {
            diagnostics.info("user_updated", mapOf("target_employee_code" to it.employeeCode, "target_role" to it.role.wire, "active" to it.active))
        }
    suspend fun importUsers(items: List<ImportUserRow>) = api.importUsers(items)''',
)

# Android direct user editor.
replace(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
    '''import android.widget.Button
import android.widget.EditText''',
    '''import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText''',
)
replace(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
    '''import vn.pickpack1291.baohang.data.StockIssue
import vn.pickpack1291.baohang.data.UserRole''',
    '''import vn.pickpack1291.baohang.data.StockIssue
import vn.pickpack1291.baohang.data.UserProfile
import vn.pickpack1291.baohang.data.UserRole''',
)
replace(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
    '''        content.addView(button("CẤU HÌNH HỆ THỐNG") { showConfig() })
        content.addView(button("IMPORT SKU.EXCEL")''',
    '''        content.addView(button("CẤU HÌNH HỆ THỐNG") { showConfig() })
        content.addView(button("QUẢN LÝ NHÂN SỰ") { showUsers() })
        content.addView(button("IMPORT SKU.EXCEL")''',
)
replace(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
    '''        content.addView(button("BÁO CÁO 30 NGÀY") { showReports() })
        content.addView(button("IMPORT SKU.EXCEL") { chooseSku.launch(XLSX_MIME) })''',
    '''        content.addView(button("BÁO CÁO 30 NGÀY") { showReports() })
        content.addView(button("QUẢN LÝ NHÂN SỰ") { showUsers() })
        content.addView(button("IMPORT SKU.EXCEL") { chooseSku.launch(XLSX_MIME) })''',
)

users_block = r'''
    private fun showUsers() {
        val content = page("QUẢN LÝ NHÂN SỰ")
        content.addView(button("← VỀ MENU QUYỀN") { renderForRole() })
        content.addView(infoBox("Admin có thể sửa mọi tài khoản nhưng ADMIN duy nhất vẫn không thể bị hạ quyền/vô hiệu hóa. Admin Invent chỉ sửa tài khoản Báo hàng Invent và Người lấy hàng."))
        val status = text("Đang tải nhân sự…", 14, false)
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(button("LÀM MỚI") { loadUsers(list, status) })
        content.addView(status)
        content.addView(list)
        addDiagnosticsButton(content)
        loadUsers(list, status)
    }

    private fun loadUsers(target: LinearLayout, status: TextView) {
        lifecycleScope.launch {
            status.text = "Đang tải nhân sự…"
            runCatching { app.repository.listUsers() }
                .onSuccess { users ->
                    target.removeAllViews()
                    status.text = "${users.size} tài khoản"
                    if (users.isEmpty()) target.addView(infoBox("Chưa có tài khoản."))
                    users.forEach { user ->
                        val card = LinearLayout(this@MainActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            setPadding(dp(12), dp(10), dp(12), dp(10))
                            setBackgroundResource(R.drawable.bg_card)
                            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0, dp(4), 0, dp(4)) }
                        }
                        card.addView(text("${user.employeeCode} • ${user.fullName}", 16, true))
                        card.addView(text("${user.role.label} • ${if (user.active) "Đang hoạt động" else "Đã khóa"}${if (user.contractor.isNotBlank()) " • ${user.contractor}" else ""}", 13, false))
                        val canEdit = when (app.session.effectiveRole) {
                            UserRole.ADMIN -> true
                            UserRole.ADMIN_INVENT -> user.role in setOf(UserRole.INVENT, UserRole.PICKER)
                            else -> false
                        }
                        if (canEdit) card.addView(button("CHỈNH SỬA") { editUser(user) { loadUsers(target, status) } })
                        target.addView(card)
                    }
                }
                .onFailure { error ->
                    status.text = "Lỗi: ${error.message}"
                    app.diagnostics.error("user_list_failed", error)
                }
        }
    }

    private fun editUser(user: UserProfile, refresh: () -> Unit) {
        val effective = app.session.effectiveRole
        val allowedRoles = when {
            user.role == UserRole.ADMIN -> listOf(UserRole.ADMIN)
            effective == UserRole.ADMIN -> listOf(UserRole.ADMIN_INVENT, UserRole.INVENT, UserRole.PICKER)
            else -> listOf(UserRole.INVENT, UserRole.PICKER)
        }
        val wrap = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(8), dp(20), 0) }
        fun field(hintText: String, value: String): EditText = EditText(this).apply {
            hint = hintText
            setText(value)
            wrap.addView(this)
        }
        val employeeCode = field("Mã nhân viên", user.employeeCode)
        val fullName = field("Họ tên", user.fullName)
        val contractor = field("Nhà thầu", user.contractor)
        val roleField = AutoCompleteTextView(this).apply {
            hint = "Quyền"
            threshold = 0
            setText(user.role.wire, false)
            setAdapter(ArrayAdapter(this@MainActivity, android.R.layout.simple_dropdown_item_1line, allowedRoles.map { it.wire }))
            setOnClickListener { showDropDown() }
            isEnabled = user.role != UserRole.ADMIN
            wrap.addView(this)
        }
        val active = CheckBox(this).apply {
            text = "Tài khoản đang hoạt động"
            isChecked = user.active
            isEnabled = user.role != UserRole.ADMIN
            wrap.addView(this)
        }
        val password = EditText(this).apply {
            hint = "Mật khẩu mới (để trống nếu giữ nguyên)"
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
            wrap.addView(this)
        }
        AlertDialog.Builder(this)
            .setTitle("Chỉnh sửa ${user.employeeCode}")
            .setView(wrap)
            .setNegativeButton("HỦY", null)
            .setPositiveButton("LƯU") { _, _ ->
                val roleWire = roleField.text.toString().trim().uppercase()
                val selectedRole = allowedRoles.firstOrNull { it.wire == roleWire }
                if (selectedRole == null) {
                    toast("Quyền không hợp lệ")
                    return@setPositiveButton
                }
                lifecycleScope.launch {
                    runCatching {
                        app.repository.updateUser(
                            user,
                            employeeCode.text.toString().trim(),
                            fullName.text.toString().trim(),
                            contractor.text.toString().trim(),
                            selectedRole,
                            active.isChecked,
                            password.text.toString()
                        )
                    }.onSuccess { updated ->
                        toast("Đã cập nhật ${updated.employeeCode}")
                        if (updated.id == app.session.profile?.id) runCatching { app.repository.refreshProfile() }
                        refresh()
                    }.onFailure { error -> toast(error.message ?: "Không cập nhật được nhân sự") }
                }
            }
            .show()
    }

'''
replace(
    "app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt",
    "    private fun showReports() {",
    users_block + "    private fun showReports() {",
)

# Backend endpoints and privilege boundaries.
api_path = Path("supabase/functions/api/index.ts")
api_text = api_path.read_text()
marker = "async function syncSheet() {"
if api_text.count(marker) != 1:
    raise SystemExit("api helper marker mismatch")
helper = r'''async function listUsers(context: Context) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
  const { data, error, count } = await admin.from("profiles").select("id,employee_code,full_name,contractor,role,active", { count: "exact" }).order("employee_code").limit(2000);
  if (error) throw error;
  if ((count ?? 0) > 2000) throw new HttpError(409, "Số nhân sự vượt giới hạn 2000 tài khoản");
  return { users: data ?? [], count: count ?? 0 };
}

async function updateManagedUser(context: Context, body: Record<string, unknown>) {
  requireRole(context, ["ADMIN", "ADMIN_INVENT"]);
  const targetId = required(body.id, "User ID");
  const { data: target, error: targetError } = await admin.from("profiles").select("id,employee_code,full_name,contractor,role,active").eq("id", targetId).single();
  if (targetError || !target) throw new HttpError(404, "Không tìm thấy tài khoản");
  if (context.effectiveRole === "ADMIN_INVENT" && !["INVENT", "PICKER"].includes(target.role)) throw new HttpError(403, "Admin Invent chỉ được sửa tài khoản Báo hàng Invent hoặc Người lấy hàng");

  const employeeCode = required(body.employee_code, "Mã nhân viên");
  const fullName = required(body.full_name, "Họ tên");
  const contractor = String(body.contractor ?? "").trim();
  const role = String(body.role ?? target.role).trim().toUpperCase() as Role;
  const active = typeof body.active === "boolean" ? body.active : Boolean(target.active);
  const newPassword = String(body.new_password ?? "");
  if (!["ADMIN", "ADMIN_INVENT", "INVENT", "PICKER"].includes(role)) throw new HttpError(400, "Quyền không hợp lệ");
  if (newPassword && newPassword.length < 8) throw new HttpError(400, "Mật khẩu mới cần ít nhất 8 ký tự");

  if (target.role === "ADMIN") {
    if (context.effectiveRole !== "ADMIN") throw new HttpError(403, "Tài khoản ADMIN được bảo vệ");
    if (role !== "ADMIN" || !active) throw new HttpError(409, "ADMIN_PROTECTED");
  } else {
    if (role === "ADMIN") throw new HttpError(409, "ADMIN_ALREADY_EXISTS");
    if (context.effectiveRole === "ADMIN_INVENT" && !["INVENT", "PICKER"].includes(role)) throw new HttpError(403, "Admin Invent không được cấp quyền cao hơn quyền của mình");
  }

  if (employeeCode.toLowerCase() !== String(target.employee_code).toLowerCase()) {
    const { data: duplicate, error: duplicateError } = await admin.from("profiles").select("id").ilike("employee_code", employeeCode).neq("id", targetId).maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) throw new HttpError(409, "Mã nhân viên đã tồn tại");
  }

  const values = { employee_code: employeeCode, full_name: fullName, contractor, role, active, updated_at: new Date().toISOString() };
  const { data: updated, error: updateError } = await admin.from("profiles").update(values).eq("id", targetId).select("id,employee_code,full_name,contractor,role,active").single();
  if (updateError || !updated) throw updateError ?? new Error("Không cập nhật được hồ sơ");

  const authValues: { email?: string; password?: string } = {};
  if (employeeCode.toLowerCase() !== String(target.employee_code).toLowerCase()) authValues.email = employeeEmail(employeeCode);
  if (newPassword) authValues.password = newPassword;
  if (Object.keys(authValues).length) {
    const { error: authError } = await admin.auth.admin.updateUserById(targetId, authValues);
    if (authError) {
      await admin.from("profiles").update({ employee_code: target.employee_code, full_name: target.full_name, contractor: target.contractor, role: target.role, active: target.active, updated_at: new Date().toISOString() }).eq("id", targetId);
      throw authError;
    }
  }
  const { error: queueError } = await admin.from("sheet_export_queue").insert({ event_type: "USER_UPSERT", payload: values });
  if (queueError) console.warn("USER_UPSERT queue deferred", errorText(queueError));
  return { profile: updated };
}

'''
api_path.write_text(api_text.replace(marker, helper + marker, 1))
replace(
    "supabase/functions/api/index.ts",
    '''    case "import-skus": { requireRole(context, ["ADMIN", "ADMIN_INVENT"]);''',
    '''    case "list-users": return listUsers(context);
    case "update-user": return updateManagedUser(context, body);
    case "import-skus": { requireRole(context, ["ADMIN", "ADMIN_INVENT"]);''',
)
replace(
    "supabase/functions/web-api/index.ts",
    '''  "import-skus", "import-users", "sync-google-sheet", "reports-summary", "issue-history", "audit-history",''',
    '''  "import-skus", "import-users", "list-users", "update-user", "sync-google-sheet", "reports-summary", "issue-history", "audit-history",''',
)

# Web: Admin Invent gets user editor; bulk import remains Admin-only.
replace(
    "web-admin/src/main.js",
    "const state = { session: null, testRole: null, selectedSku: null, pollTimer: null, activeTab: null };",
    "const state = { session: null, testRole: null, selectedSku: null, pollTimer: null, activeTab: null, managedUsers: [] };",
)
replace(
    "web-admin/src/main.js",
    "if(r==='ADMIN_INVENT')return[['overview','Tổng quan'],['operations','Báo hàng'],['reports','Báo cáo'],['logs','Log'],['sku','SKU']];",
    "if(r==='ADMIN_INVENT')return[['overview','Tổng quan'],['operations','Báo hàng'],['reports','Báo cáo'],['logs','Log'],['sku','SKU'],['users','Nhân sự']];",
)
web = Path("web-admin/src/main.js")
text = web.read_text()
start = text.index("function renderUsers(){")
end = text.index("async function previewUsers", start)
new_users = r'''function renderUsers(){
  const canImport=role()==='ADMIN';
  $('#content').innerHTML=`<div class="heading"><div><p class="eyebrow">NHÂN SỰ</p><h2>Quản lý tài khoản</h2></div><button id="refreshUsers" class="secondary">Làm mới</button></div><div class="card"><p class="muted">Admin sửa mọi tài khoản; ADMIN duy nhất vẫn được bảo vệ. Admin Invent chỉ sửa tài khoản Báo hàng Invent và Người lấy hàng.</p><div id="managedUsers"></div></div>${canImport?`<div class="heading compact"><h3>Import nhân sự</h3><button id="userTemplate" class="secondary">Tải file mẫu</button></div><div class="card"><input id="userFile" type="file" accept=".xlsx"><p class="muted">Vai trò import: ADMIN_INVENT, INVENT, PICKER. ADMIN hiện tại không thể tạo thêm, hạ quyền hoặc vô hiệu hóa.</p><div id="userMsg" class="message" hidden></div></div><div id="userPreview"></div>`:''}`;
  $('#refreshUsers').onclick=loadManagedUsers;
  if(canImport){$('#userFile').onchange=e=>previewUsers(e.target.files?.[0]);$('#userTemplate').onclick=downloadUserTemplate;}
  loadManagedUsers();
}
async function loadManagedUsers(){
  try{const d=await api('list-users');state.managedUsers=d.users||[];$('#managedUsers').innerHTML=state.managedUsers.map(u=>{const editable=role()==='ADMIN'||(role()==='ADMIN_INVENT'&&['INVENT','PICKER'].includes(u.role));return`<div class="row"><span><strong>${escapeHtml(u.employee_code)} · ${escapeHtml(u.full_name)}</strong><br><small>${escapeHtml(ROLES[u.role]||u.role)} · ${u.active?'Đang hoạt động':'Đã khóa'}${u.contractor?` · ${escapeHtml(u.contractor)}`:''}</small></span>${editable?`<button class="secondary" data-edit-user="${u.id}">Chỉnh sửa</button>`:''}</div>`;}).join('')||'<span class="muted">Chưa có tài khoản.</span>';$$('[data-edit-user]').forEach(b=>b.onclick=()=>openUserEditor(b.dataset.editUser));}catch(e){$('#managedUsers').innerHTML=`<div class="message" data-type="error">${escapeHtml(e.message)}</div>`;}
}
function openUserEditor(id){
  const u=state.managedUsers.find(x=>x.id===id);if(!u)return;const allowed=u.role==='ADMIN'?['ADMIN']:(role()==='ADMIN'?['ADMIN_INVENT','INVENT','PICKER']:['INVENT','PICKER']);
  document.body.insertAdjacentHTML('beforeend',`<div class="alert-modal" id="userEditorModal"><div class="card"><p class="eyebrow">CHỈNH SỬA NHÂN SỰ</p><h2>${escapeHtml(u.employee_code)}</h2><form id="editUserForm" class="form-grid"><label>Mã nhân viên<input id="editCode" value="${escapeHtml(u.employee_code)}" required></label><label>Họ tên<input id="editName" value="${escapeHtml(u.full_name)}" required></label><label>Nhà thầu<input id="editContractor" value="${escapeHtml(u.contractor||'')}"></label><label>Quyền<select id="editRole" ${u.role==='ADMIN'?'disabled':''}>${allowed.map(r=>`<option value="${r}" ${r===u.role?'selected':''}>${escapeHtml(ROLES[r]||r)}</option>`).join('')}</select></label><label><input id="editActive" type="checkbox" ${u.active?'checked':''} ${u.role==='ADMIN'?'disabled':''}> Tài khoản đang hoạt động</label><label>Mật khẩu mới<input id="editPassword" type="password" placeholder="Để trống nếu giữ nguyên"></label><div class="actions span"><button type="button" id="cancelUserEdit" class="secondary">HỦY</button><button class="primary">LƯU</button></div><div id="editUserMsg" class="message span" hidden></div></form></div></div>`);
  $('#cancelUserEdit').onclick=()=>$('#userEditorModal')?.remove();
  $('#editUserForm').onsubmit=async e=>{e.preventDefault();try{setBusy(true,'Đang cập nhật nhân sự…');await api('update-user',{id:u.id,employee_code:$('#editCode').value.trim(),full_name:$('#editName').value.trim(),contractor:$('#editContractor').value.trim(),role:$('#editRole').value||u.role,active:u.role==='ADMIN'?true:$('#editActive').checked,new_password:$('#editPassword').value});$('#userEditorModal')?.remove();await loadManagedUsers();}catch(err){message('#editUserMsg',err.message,'error');}finally{setBusy(false);}};
}

'''
web.write_text(text[:start] + new_users + text[end:])
