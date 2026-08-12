package vn.pickpack1291.baohang.data

import org.json.JSONObject

enum class UserRole(val wire: String, val label: String) {
    ADMIN("ADMIN", "Admin"),
    ADMIN_INVENT("ADMIN_INVENT", "Admin Invent"),
    INVENT("INVENT", "Báo hàng Invent"),
    PICKER("PICKER", "Người lấy hàng");

    val canProcessIssues: Boolean get() = this in setOf(ADMIN, ADMIN_INVENT, INVENT)
    val canViewReports: Boolean get() = this in setOf(ADMIN, ADMIN_INVENT)
    val canManageUsers: Boolean get() = this == ADMIN
    val canManageConfig: Boolean get() = this == ADMIN
    val canImportSku: Boolean get() = this in setOf(ADMIN, ADMIN_INVENT)

    companion object {
        fun from(value: String?): UserRole = when (value?.trim()?.uppercase()) {
            "ADMIN" -> ADMIN
            "ADMIN_INVENT", "INVENT_ADMIN" -> ADMIN_INVENT
            "INVENT", "INVENT_USER" -> INVENT
            else -> PICKER
        }
    }
}

enum class IssueStatus(val wire: String, val label: String, val criticalForPicker: Boolean = false) {
    OPEN("OPEN", "BÁO THIẾU"),
    CLAIMED("CLAIMED", "BÁO THIẾU"),
    SEARCHING("SEARCHING", "BÁO THIẾU"),
    REPLENISHING("REPLENISHING", "BÁO THIẾU"),
    AVAILABLE("AVAILABLE", "ĐÃ CHÂM BÙ", true),
    SKIP_ALLOWED("SKIP_ALLOWED", "ĐƯỢC SKIP", true),
    CLOSED("CLOSED", "ĐÃ ĐÓNG");

    val isOpenBucket: Boolean get() = this in setOf(OPEN, CLAIMED, SEARCHING, REPLENISHING)

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

data class IssueBoard(
    val open: List<StockIssue>,
    val skipped: List<StockIssue>,
    val available: List<StockIssue>
)

data class PendingAlert(
    val eventId: String,
    val status: IssueStatus,
    val title: String,
    val message: String,
    val issue: StockIssue?
) {
    companion object {
        fun fromJson(json: JSONObject) = PendingAlert(
            eventId = json.optString("id"),
            status = IssueStatus.from(json.optString("status")),
            title = json.optString("title"),
            message = json.optString("message"),
            issue = json.optJSONObject("issue")?.let(StockIssue::fromJson)
        )
    }
}

data class AppConfig(
    val acknowledgeMinutes: Int = 15,
    val reminderMinutes: Int = 5,
    val replenishMinutes: Int = 15,
    val pickerAckReminderMinutes: Int = 3,
    val diagnosticLogRetentionDays: Int = 14
) {
    fun toJson() = JSONObject()
        .put("acknowledge_minutes", acknowledgeMinutes)
        .put("reminder_minutes", reminderMinutes)
        .put("replenish_minutes", replenishMinutes)
        .put("picker_ack_reminder_minutes", pickerAckReminderMinutes)
        .put("diagnostic_log_retention_days", diagnosticLogRetentionDays)

    companion object {
        fun fromJson(json: JSONObject) = AppConfig(
            acknowledgeMinutes = json.optInt("acknowledge_minutes", 15),
            reminderMinutes = json.optInt("reminder_minutes", 5),
            replenishMinutes = json.optInt("replenish_minutes", 15),
            pickerAckReminderMinutes = json.optInt("picker_ack_reminder_minutes", 3),
            diagnosticLogRetentionDays = json.optInt("diagnostic_log_retention_days", 14)
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
