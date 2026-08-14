from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, got {count}")
    return text.replace(old, new, 1)

# --- SessionStore ---------------------------------------------------------
p = Path("app/src/main/java/vn/pickpack1291/baohang/data/SessionStore.kt")
s = p.read_text()

s = replace_once(
    s,
    '    val hasValidFallbackCredential: Boolean\n        get() = fallbackToken.isNotBlank() && fallbackUrl.startsWith("https://") && fallbackExpiresAtMillis > System.currentTimeMillis() + 60_000L\n',
    '    val hasValidFallbackCredential: Boolean\n        get() = fallbackToken.isNotBlank() && fallbackUrl.startsWith("https://") && fallbackExpiresAtMillis > System.currentTimeMillis() + 60_000L\n\n    val preferredAuthority: String\n        get() = prefs.getString(KEY_AUTHORITY_PREFERENCE, "SERVICE").orEmpty().uppercase()\n            .takeIf { it in setOf("SERVICE", "SHEET", "EMERGENCY") } ?: "SERVICE"\n',
    "SessionStore preferredAuthority property",
)

s = replace_once(
    s,
    '    fun clearFallbackCredential() {\n        prefs.edit().remove(KEY_FALLBACK_TOKEN).remove(KEY_FALLBACK_URL).remove(KEY_FALLBACK_EXPIRES).apply()\n    }\n',
    '    fun clearFallbackCredential() {\n        prefs.edit().remove(KEY_FALLBACK_TOKEN).remove(KEY_FALLBACK_URL).remove(KEY_FALLBACK_EXPIRES).apply()\n    }\n\n    fun setPreferredAuthority(mode: String) {\n        val normalized = mode.uppercase()\n        require(normalized in setOf("SERVICE", "SHEET", "EMERGENCY")) { "Invalid authority mode" }\n        prefs.edit().putString(KEY_AUTHORITY_PREFERENCE, normalized).apply()\n    }\n',
    "SessionStore setter",
)

s = replace_once(
    s,
    '            .putBoolean(KEY_DEVICE_REGISTERED, false)\n            .remove(KEY_ADMIN_TEST_ROLE)\n            .apply()\n',
    '            .putBoolean(KEY_DEVICE_REGISTERED, false)\n            .putString(KEY_AUTHORITY_PREFERENCE, "SERVICE")\n            .remove(KEY_ADMIN_TEST_ROLE)\n            .apply()\n',
    "SessionStore save default",
)

s = replace_once(
    s,
    '        const val KEY_FALLBACK_EXPIRES = "fallback_expires_v1"\n',
    '        const val KEY_FALLBACK_EXPIRES = "fallback_expires_v1"\n        const val KEY_AUTHORITY_PREFERENCE = "authority_preference_v1"\n',
    "SessionStore key",
)

p.write_text(s)

# --- SheetFallbackClient --------------------------------------------------
p = Path("app/src/main/java/vn/pickpack1291/baohang/network/SheetFallbackClient.kt")
s = p.read_text()

s = replace_once(
    s,
    'class SheetFallbackClient(private val session: SessionStore) {\n    class FallbackException(val code: String, message: String) : IOException(message)\n',
    'class SheetFallbackClient(private val session: SessionStore) {\n    class FallbackException(val code: String, message: String) : IOException(message)\n    data class Health(val ok: Boolean, val sheetMode: String, val schema: String)\n',
    "Sheet health model",
)

s = replace_once(
    s,
    '    suspend fun reportShortage(sku: String, eventId: String): ReportResult {\n',
    '''    suspend fun health(): Health {\n        if (!session.hasValidFallbackCredential) throw FallbackException("FALLBACK_TOKEN_EXPIRED", "Token fallback chưa sẵn sàng")\n        val separator = if (session.fallbackUrl.contains("?")) "&" else "?"\n        val request = Request.Builder().url(session.fallbackUrl + separator + "mode=health")\n            .get().header("Accept", "application/json").build()\n        val result = executeObject(request)\n        return Health(\n            ok = result.optBoolean("ok", false),\n            sheetMode = result.optString("sheet_mode", "UNKNOWN").uppercase(),\n            schema = result.optString("schema", "")\n        )\n    }\n\n    suspend fun reportShortage(sku: String, eventId: String): ReportResult {\n''',
    "Sheet health method",
)

p.write_text(s)

# --- AppRepository --------------------------------------------------------
p = Path("app/src/main/java/vn/pickpack1291/baohang/data/AppRepository.kt")
s = p.read_text()

s = replace_once(
    s,
    '    @Volatile var authorityMode: AuthorityMode = AuthorityMode.BLOCKED\n        private set\n',
    '''    @Volatile var authorityMode: AuthorityMode = runCatching { AuthorityMode.valueOf(session.preferredAuthority) }.getOrDefault(AuthorityMode.SERVICE)\n        private set\n\n    private val preferredAuthority: AuthorityMode\n        get() = runCatching { AuthorityMode.valueOf(session.preferredAuthority) }.getOrDefault(AuthorityMode.SERVICE)\n\n    private fun commitAuthority(mode: AuthorityMode) {\n        require(mode != AuthorityMode.BLOCKED)\n        authorityMode = mode\n        session.setPreferredAuthority(mode.name)\n    }\n''',
    "AppRepository preferred authority helpers",
)

s = replace_once(
    s,
    '        authorityMode = AuthorityMode.SERVICE\n        diagnostics.info("session_saved", mapOf("employee_code" to auth.profile.employeeCode, "role" to auth.profile.role.wire))\n        registerCurrentDevice()\n        refreshFallbackCredentialIfPossible(force = true)\n        provisionEmergencyIfPossible()\n',
    '        commitAuthority(AuthorityMode.SERVICE)\n        diagnostics.info("session_saved", mapOf("employee_code" to auth.profile.employeeCode, "role" to auth.profile.role.wire))\n        registerCurrentDevice()\n        refreshFallbackCredentialIfPossible(force = true)\n        provisionEmergencyIfPossible()\n        resolveAuthorityFromRecoveryState()\n',
    "AppRepository login recovery mode",
)

s = replace_once(
    s,
    '        authorityMode = AuthorityMode.SERVICE\n        refreshFallbackCredentialIfPossible()\n        provisionEmergencyIfPossible()\n',
    '        refreshFallbackCredentialIfPossible()\n        provisionEmergencyIfPossible()\n        resolveAuthorityFromRecoveryState()\n',
    "AppRepository refresh recovery mode",
)

# Replace read methods as a block.
start = s.index('    suspend fun loadMyIssues(): List<StockIssue> {')
end = s.index('    suspend fun claimIssue(issueId: String): StockIssue {')
read_block = '''    suspend fun loadMyIssues(): List<StockIssue> {\n        return when (preferredAuthority) {\n            AuthorityMode.SERVICE -> try {\n                direct.myIssues().also { commitAuthority(AuthorityMode.SERVICE); database.upsertIssues(it) }\n            } catch (error: Exception) {\n                if (!isServiceUnavailable(error)) return runCatching { api.myIssues().also(database::upsertIssues) }.getOrElse { database.cachedIssues(100) }\n                readMyIssuesFromFallbacks()\n            }\n            AuthorityMode.SHEET -> readMyIssuesFromSheetThenEmergency()\n            AuthorityMode.EMERGENCY -> readMyIssuesFromEmergency()\n            AuthorityMode.BLOCKED -> database.cachedIssues(100)\n        }\n    }\n\n    private suspend fun readMyIssuesFromFallbacks(): List<StockIssue> = readMyIssuesFromSheetThenEmergency()\n\n    private suspend fun readMyIssuesFromSheetThenEmergency(): List<StockIssue> {\n        if (session.hasValidFallbackCredential) {\n            try {\n                return sheet.myIssues().also { commitAuthority(AuthorityMode.SHEET); database.upsertIssues(it) }\n            } catch (sheetError: Exception) {\n                if (!isSheetUnavailable(sheetError)) return database.cachedIssues(100)\n            }\n        }\n        return readMyIssuesFromEmergency()\n    }\n\n    private suspend fun readMyIssuesFromEmergency(): List<StockIssue> {\n        if (!emergency.isProvisioned) { authorityMode = AuthorityMode.BLOCKED; return database.cachedIssues(100) }\n        return runCatching { emergency.myIssues() }\n            .onSuccess { commitAuthority(AuthorityMode.EMERGENCY); database.upsertIssues(it) }\n            .getOrElse { authorityMode = AuthorityMode.BLOCKED; database.cachedIssues(100) }\n    }\n\n    suspend fun loadActiveIssues(): List<StockIssue> = loadIssueBoard().let { it.open + it.claimed }\n\n    suspend fun loadIssueBoard(): IssueBoard {\n        return when (preferredAuthority) {\n            AuthorityMode.SERVICE -> try {\n                direct.issueBoard().also { commitAuthority(AuthorityMode.SERVICE); database.upsertIssues(it.open + it.claimed + it.recent) }\n            } catch (error: Exception) {\n                if (!isServiceUnavailable(error)) throw error\n                readBoardFromSheetThenEmergency()\n            }\n            AuthorityMode.SHEET -> readBoardFromSheetThenEmergency()\n            AuthorityMode.EMERGENCY -> readBoardFromEmergency()\n            AuthorityMode.BLOCKED -> cachedBoard()\n        }\n    }\n\n    private suspend fun readBoardFromSheetThenEmergency(): IssueBoard {\n        if (session.hasValidFallbackCredential) {\n            try {\n                return sheet.issueBoard().also { commitAuthority(AuthorityMode.SHEET); database.upsertIssues(it.open + it.claimed + it.recent) }\n            } catch (sheetError: Exception) {\n                if (!isSheetUnavailable(sheetError)) throw sheetError\n            }\n        }\n        return readBoardFromEmergency()\n    }\n\n    private suspend fun readBoardFromEmergency(): IssueBoard {\n        if (emergency.isProvisioned) {\n            try {\n                return emergency.issueBoard().also { commitAuthority(AuthorityMode.EMERGENCY); database.upsertIssues(it.open + it.claimed + it.recent) }\n            } catch (fireError: Exception) {\n                diagnostics.warn("emergency_board_unavailable", mapOf("error" to fireError.message.orEmpty().take(200)))\n            }\n        }\n        authorityMode = AuthorityMode.BLOCKED\n        return cachedBoard()\n    }\n\n    private fun cachedBoard(): IssueBoard {\n        val cached = database.cachedIssues(200)\n        return IssueBoard(cached.filter { it.status == IssueStatus.OPEN }, cached.filter { it.status.isClaimedBucket }, cached.filter { !it.status.isOpenBucket })\n    }\n\n'''
s = s[:start] + read_block + s[end:]

# Replace mutationWithAuthorities block.
start = s.index('    private suspend fun <T> mutationWithAuthorities(')
end = s.index('    private fun isServiceUnavailable(error: Exception): Boolean')
mutation_block = '''    private suspend fun <T> mutationWithAuthorities(\n        requestId: String,\n        operation: String,\n        service: suspend () -> T,\n        fallback: suspend () -> T,\n        emergencyCall: suspend () -> T\n    ): T {\n        var lastError: Exception? = null\n        val retryMs = longArrayOf(0L, 500L, 1_500L)\n\n        if (preferredAuthority == AuthorityMode.SERVICE) {\n            for (index in retryMs.indices) {\n                if (retryMs[index] > 0) delay(retryMs[index])\n                try {\n                    return service().also { commitAuthority(AuthorityMode.SERVICE) }\n                } catch (error: Exception) {\n                    if (!isServiceUnavailable(error)) {\n                        diagnostics.warn("service_business_rejected", mapOf("operation" to operation, "request_id" to requestId, "error" to error.message.orEmpty().take(200)))\n                        throw error\n                    }\n                    lastError = error\n                }\n            }\n        }\n\n        if (preferredAuthority in setOf(AuthorityMode.SERVICE, AuthorityMode.SHEET) && session.hasValidFallbackCredential) {\n            for (index in retryMs.indices) {\n                if (retryMs[index] > 0) delay(retryMs[index])\n                try {\n                    return fallback().also {\n                        commitAuthority(AuthorityMode.SHEET)\n                        diagnostics.warn("sheet_fallback_committed", mapOf("operation" to operation, "request_id" to requestId))\n                    }\n                } catch (error: Exception) {\n                    if (!isSheetUnavailable(error)) {\n                        diagnostics.warn("sheet_business_rejected", mapOf("operation" to operation, "request_id" to requestId, "error" to error.message.orEmpty().take(200)))\n                        throw error\n                    }\n                    lastError = error\n                }\n            }\n        }\n\n        if (emergency.isProvisioned) {\n            try {\n                return emergencyCall().also {\n                    commitAuthority(AuthorityMode.EMERGENCY)\n                    diagnostics.warn("firebase_emergency_committed", mapOf("operation" to operation, "request_id" to requestId))\n                }\n            } catch (error: EmergencyFirestoreClient.EmergencyException) {\n                if (!isEmergencyUnavailable(error)) throw error\n                lastError = error\n            } catch (error: Exception) {\n                lastError = error\n            }\n        }\n\n        // BLOCKED is an observed availability state only. Do not erase the sticky\n        // preferred authority; retry must resume the same hierarchy, never jump ahead.\n        authorityMode = AuthorityMode.BLOCKED\n        diagnostics.warn("mutation_blocked_no_authority", mapOf("operation" to operation, "request_id" to requestId, "preferred_authority" to preferredAuthority.name))\n        throw MutationUnavailableException("Không có cloud nào xác nhận thao tác. Dữ liệu chưa được gửi và sẽ không tự động gửi lại.", lastError)\n    }\n\n'''
s = s[:start] + mutation_block + s[end:]

# Insert recovery-state resolver before pending alerts.
needle = '    suspend fun pendingAlerts(): List<PendingAlert> = runCatching { direct.pendingAlerts() }.getOrElse { api.pendingAlerts() }\n'
insert = '''    private suspend fun resolveAuthorityFromRecoveryState() {\n        if (!session.hasValidFallbackCredential) return\n        runCatching { sheet.health() }.onSuccess { health ->\n            when (health.sheetMode) {\n                "ACTIVE_FALLBACK", "RECOVERY_IMPORTING", "RECOVERY_BLOCKED", "EMERGENCY_DRAIN" -> {\n                    // EMERGENCY stays sticky until Firestore events are durably ACKed into Sheet.\n                    if (preferredAuthority != AuthorityMode.EMERGENCY) commitAuthority(AuthorityMode.SHEET)\n                }\n                "SERVICE_CAUGHT_UP", "STANDBY", "ACTIVE_SERVICE" -> commitAuthority(AuthorityMode.SERVICE)\n                // STANDBY_PRE_CUTOVER intentionally leaves the current preference untouched.\n            }\n        }.onFailure { diagnostics.warn("authority_recovery_probe_deferred", mapOf("error" to it.message.orEmpty().take(160))) }\n    }\n\n''' + needle
s = replace_once(s, needle, insert, "AppRepository recovery resolver")

p.write_text(s)

print("sticky-authority patch applied")
