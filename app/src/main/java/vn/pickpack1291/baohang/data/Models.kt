package vn.pickpack1291.baohang.data

import org.json.JSONObject

enum class UserRole(val wire: String) {
    PICKER("PICKER"),
    INVENT_USER("INVENT_USER"),
    INVENT_ADMIN("INVENT_ADMIN");

    companion object {
        fun from(value: String?): UserRole = entries.firstOrNull {
            it.wire.equals(value, ignoreCase = true)
        } ?: PICKER
    }
}

enum class IssueStatus(val wire: String, val label: String, val criticalForPicker: Boolean = false) {
    OPEN("OPEN", "CHỜ INVENT"),
    CLAIMED("CLAIMED", "INVENT ĐÃ NHẬN"),
    SEARCHING("SEARCHING", "INVENT ĐANG TÌM"),
    REPLENISHING("REPLENISHING", "ĐANG CHÂM HÀNG"),
    AVAILABLE("AVAILABLE", "ĐÃ CÓ HÀNG", true),
    SKIP_ALLOWED("SKIP_ALLOWED", "ĐƯỢC SKIP", true),
    CLOSED("CLOSED", "ĐÃ ĐÓNG");

    companion object {
        fun from(value: String?): IssueStatus = entries.firstOrNull {
            it.wire.equals(value, ignoreCase = true)
        } ?: OPEN
    }
}

data class UserProfile(
    val id: String,
    val employeeCode: String,
    val fullName: String,
    val contractor: String,
    val role: UserRole,
    val active: Boolean = true
) {
    companion object {
        fun fromJson(json: JSONObject) = UserProfile(
            id = json.optString("id"),
            employeeCode = json.optString("employee_code"),
            fullName = json.optString("full_name"),
            contractor = json.optString("contractor"),
            role = UserRole.from(json.optString("role")),
            active = json.optBoolean("active", true)
        )
    }
}

data class AuthSession(
    val accessToken: String,
    val refreshToken: String,
    val expiresAtEpochSeconds: Long,
    val profile: UserProfile
)

data class SkuItem(val sku: String, val productName: String) {
    override fun toString(): String = "$sku — $productName"
}

data class StockIssue(
    val id: String,
    val sku: String,
    val productName: String,
    val status: IssueStatus,
    val reportCount: Int,
    val reportedAt: String,
    val updatedAt: String,
    val assignedName: String = "",
    val latestReporterName: String = "",
    val latestMessage: String = ""
) {
    companion object {
        fun fromJson(json: JSONObject) = StockIssue(
            id = json.optString("id"),
            sku = json.optString("sku"),
            productName = json.optString("product_name"),
            status = IssueStatus.from(json.optString("status")),
            reportCount = json.optInt("report_count", 1),
            reportedAt = json.optString("reported_at"),
            updatedAt = json.optString("updated_at"),
            assignedName = json.optString("assigned_name"),
            latestReporterName = json.optString("latest_reporter_name"),
            latestMessage = json.optString("latest_message")
        )
    }
}

data class AppConfig(
    val acknowledgeMinutes: Int = 15,
    val reminderMinutes: Int = 5,
    val skipMinutes: Int = 30,
    val replenishMinutes: Int = 15
) {
    fun toJson() = JSONObject()
        .put("acknowledge_minutes", acknowledgeMinutes)
        .put("reminder_minutes", reminderMinutes)
        .put("skip_minutes", skipMinutes)
        .put("replenish_minutes", replenishMinutes)

    companion object {
        fun fromJson(json: JSONObject) = AppConfig(
            acknowledgeMinutes = json.optInt("acknowledge_minutes", 15),
            reminderMinutes = json.optInt("reminder_minutes", 5),
            skipMinutes = json.optInt("skip_minutes", 30),
            replenishMinutes = json.optInt("replenish_minutes", 15)
        )
    }
}

data class ReportResult(
    val issue: StockIssue,
    val wasAlreadyReported: Boolean,
    val message: String
)

data class ImportUserRow(
    val employeeCode: String,
    val fullName: String,
    val contractor: String,
    val role: UserRole,
    val active: Boolean,
    val initialPassword: String
)
