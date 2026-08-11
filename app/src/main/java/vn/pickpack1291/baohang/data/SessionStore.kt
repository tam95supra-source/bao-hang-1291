package vn.pickpack1291.baohang.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

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

    val isLoggedIn: Boolean get() = accessToken.isNotBlank() && profile != null
    val accessToken: String get() = prefs.getString(KEY_ACCESS, "").orEmpty()
    val refreshToken: String get() = prefs.getString(KEY_REFRESH, "").orEmpty()
    val expiresAt: Long get() = prefs.getLong(KEY_EXPIRES, 0)
    val deviceRegistered: Boolean get() = prefs.getBoolean(KEY_DEVICE_REGISTERED, false)

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
            .apply()
    }

    fun updateTokens(access: String, refresh: String, expiresAt: Long) {
        prefs.edit().putString(KEY_ACCESS, access).putString(KEY_REFRESH, refresh)
            .putLong(KEY_EXPIRES, expiresAt).apply()
    }

    fun markDeviceRegistered() = prefs.edit().putBoolean(KEY_DEVICE_REGISTERED, true).apply()

    fun clear() = prefs.edit().clear().apply()

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
    }
}
