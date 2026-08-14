package vn.pickpack1291.baohang.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.util.UUID

class SessionStore(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "bao_hang_1291_secure",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    val sessionKind: String get() = prefs.getString(KEY_SESSION_KIND, "SERVICE").orEmpty()
    val isLoggedIn: Boolean get() = profile != null && (accessToken.isNotBlank() || (sessionKind == "BACKUP" && hasValidFallbackCredential))
    val accessToken: String get() = prefs.getString(KEY_ACCESS, "").orEmpty()
    val refreshToken: String get() = prefs.getString(KEY_REFRESH, "").orEmpty()
    val expiresAt: Long get() = prefs.getLong(KEY_EXPIRES, 0)
    val deviceRegistered: Boolean get() = prefs.getBoolean(KEY_DEVICE_REGISTERED, false)
    val deviceId: String
        get() {
            val existing = prefs.getString(KEY_DEVICE_ID, "").orEmpty()
            if (existing.isNotBlank()) return existing
            return UUID.randomUUID().toString().also { prefs.edit().putString(KEY_DEVICE_ID, it).commit() }
        }

    val fallbackToken: String get() = prefs.getString(KEY_FALLBACK_TOKEN, "").orEmpty()
    val fallbackUrl: String get() = prefs.getString(KEY_FALLBACK_URL, "").orEmpty()
    val fallbackExpiresAtMillis: Long get() = prefs.getLong(KEY_FALLBACK_EXPIRES, 0L)
    val hasValidFallbackCredential: Boolean
        get() = fallbackToken.isNotBlank() && fallbackUrl.startsWith("https://") && fallbackExpiresAtMillis > System.currentTimeMillis() + 60_000L

    val preferredAuthority: String
        get() = prefs.getString(KEY_AUTHORITY_PREFERENCE, "SERVICE").orEmpty().uppercase()
            .takeIf { it in setOf("SERVICE", "SHEET", "EMERGENCY") } ?: "SERVICE"

    val profile: UserProfile?
        get() {
            val id = prefs.getString(KEY_USER_ID, null) ?: return null
            return UserProfile(
                id,
                prefs.getString(KEY_EMPLOYEE_CODE, "").orEmpty(),
                prefs.getString(KEY_FULL_NAME, "").orEmpty(),
                prefs.getString(KEY_CONTRACTOR, "").orEmpty(),
                UserRole.from(prefs.getString(KEY_ROLE, null)),
                prefs.getBoolean(KEY_ACTIVE, true)
            )
        }

    val adminTestRole: UserRole?
        get() {
            if (profile?.role != UserRole.ADMIN) return null
            val raw = prefs.getString(KEY_ADMIN_TEST_ROLE, "").orEmpty()
            val role = UserRole.from(raw)
            return role.takeIf { raw.isNotBlank() && it != UserRole.ADMIN }
        }

    val effectiveRole: UserRole get() = adminTestRole ?: profile?.role ?: UserRole.PICKER

    fun save(session: AuthSession) {
        prefs.edit()
            .putString(KEY_ACCESS, session.accessToken)
            .putString(KEY_REFRESH, session.refreshToken)
            .putLong(KEY_EXPIRES, session.expiresAtEpochSeconds)
            .putString(KEY_USER_ID, session.profile.id)
            .putString(KEY_EMPLOYEE_CODE, session.profile.employeeCode)
            .putString(KEY_FULL_NAME, session.profile.fullName)
            .putString(KEY_CONTRACTOR, session.profile.contractor)
            .putString(KEY_ROLE, session.profile.role.wire)
            .putBoolean(KEY_ACTIVE, session.profile.active)
            .putBoolean(KEY_DEVICE_REGISTERED, false)
            .putString(KEY_AUTHORITY_PREFERENCE, "SERVICE")
            .remove(KEY_ADMIN_TEST_ROLE)
            .apply()
    }

    fun saveBackupProfile(profile: UserProfile) {
        prefs.edit()
            .remove(KEY_ACCESS).remove(KEY_REFRESH).putLong(KEY_EXPIRES, 0L)
            .putString(KEY_USER_ID, profile.id)
            .putString(KEY_EMPLOYEE_CODE, profile.employeeCode)
            .putString(KEY_FULL_NAME, profile.fullName)
            .putString(KEY_CONTRACTOR, profile.contractor)
            .putString(KEY_ROLE, profile.role.wire)
            .putBoolean(KEY_ACTIVE, profile.active)
            .putBoolean(KEY_DEVICE_REGISTERED, false)
            .putString(KEY_SESSION_KIND, "BACKUP")
            .remove(KEY_ADMIN_TEST_ROLE)
            .apply()
    }

    fun updateProfile(profile: UserProfile) {
        prefs.edit()
            .putString(KEY_USER_ID, profile.id)
            .putString(KEY_EMPLOYEE_CODE, profile.employeeCode)
            .putString(KEY_FULL_NAME, profile.fullName)
            .putString(KEY_CONTRACTOR, profile.contractor)
            .putString(KEY_ROLE, profile.role.wire)
            .putBoolean(KEY_ACTIVE, profile.active)
            .apply()
        if (profile.role != UserRole.ADMIN) prefs.edit().remove(KEY_ADMIN_TEST_ROLE).apply()
    }

    fun saveFallbackCredential(token: String, url: String, expiresAtMillis: Long) {
        prefs.edit()
            .putString(KEY_FALLBACK_TOKEN, token)
            .putString(KEY_FALLBACK_URL, url)
            .putLong(KEY_FALLBACK_EXPIRES, expiresAtMillis)
            .apply()
    }

    fun clearFallbackCredential() {
        prefs.edit().remove(KEY_FALLBACK_TOKEN).remove(KEY_FALLBACK_URL).remove(KEY_FALLBACK_EXPIRES).apply()
    }

    fun setPreferredAuthority(mode: String) {
        val normalized = mode.uppercase()
        require(normalized in setOf("SERVICE", "SHEET", "EMERGENCY")) { "Invalid authority mode" }
        prefs.edit().putString(KEY_AUTHORITY_PREFERENCE, normalized).apply()
    }

    fun setAdminTestRole(role: UserRole?) {
        require(profile?.role == UserRole.ADMIN) { "Chỉ ADMIN được kiểm thử quyền" }
        require(role == null || role != UserRole.ADMIN) { "Không cần giả lập ADMIN" }
        prefs.edit().apply {
            if (role == null) remove(KEY_ADMIN_TEST_ROLE) else putString(KEY_ADMIN_TEST_ROLE, role.wire)
        }.apply()
    }

    fun updateTokens(access: String, refresh: String, expiresAt: Long) {
        prefs.edit().putString(KEY_ACCESS, access).putString(KEY_REFRESH, refresh)
            .putLong(KEY_EXPIRES, expiresAt).apply()
    }

    fun markDeviceRegistered() = prefs.edit().putBoolean(KEY_DEVICE_REGISTERED, true).apply()

    fun clear() {
        val stableDeviceId = deviceId
        val publicFallbackUrl = fallbackUrl
        prefs.edit().clear().putString(KEY_DEVICE_ID, stableDeviceId).apply()
        if (publicFallbackUrl.startsWith("https://")) prefs.edit().putString(KEY_FALLBACK_URL, publicFallbackUrl).apply()
    }

    private companion object {
        const val KEY_ACCESS = "access"
        const val KEY_REFRESH = "refresh"
        const val KEY_EXPIRES = "expires"
        const val KEY_USER_ID = "user_id"
        const val KEY_EMPLOYEE_CODE = "employee_code"
        const val KEY_FULL_NAME = "full_name"
        const val KEY_CONTRACTOR = "contractor"
        const val KEY_ROLE = "role"
        const val KEY_ACTIVE = "active"
        const val KEY_DEVICE_REGISTERED = "device_registered"
        const val KEY_ADMIN_TEST_ROLE = "admin_test_role"
        const val KEY_DEVICE_ID = "device_id_v1"
        const val KEY_FALLBACK_TOKEN = "fallback_token_v1"
        const val KEY_FALLBACK_URL = "fallback_url_v1"
        const val KEY_FALLBACK_EXPIRES = "fallback_expires_v1"
        const val KEY_SESSION_KIND = "session_kind_v1"
        const val KEY_AUTHORITY_PREFERENCE = "authority_preference_v1"
    }
}
