package vn.pickpack1291.baohang.data

import org.json.JSONObject

enum class UserRole(val wire: String, val label: String) {
    ADMIN("ADMIN", "Admin hệ thống"),
    ADMIN_INVENT("ADMIN_INVENT", "Admin Event"),
    INVENT("INVENT", "Người báo hàng"),
    PICKER("PICKER", "Picker / Người lấy hàng");

    val canProcessIssues: Boolean get() = this in setOf(ADMIN, ADMIN_INVENT, INVENT)
    val canViewReports: Boolean get() = this in setOf(ADMIN, ADMIN_INVENT)
    val canManageUsers: Boolean get() = this in setOf(ADMIN, ADMIN_INVENT)
    val canManageConfig: Boolean get() = this == ADMIN
    val canManageOperationalSla: Boolean get() = this in setOf(ADMIN, ADMIN_INVENT)
    val canReassign: Boolean get() = this in setOf(ADMIN, ADMIN_INVENT)
    val canImportSku: Boolean get() = this in setOf(ADMIN, ADMIN_INVENT)
    val canSeeExactInventory: Boolean get() = this != PICKER

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
    OPEN("OPEN", "CHỜ NHẬN"),
    CLAIMED("CLAIMED", "ĐANG XỬ LÝ"),
    SEARCHING("SEARCHING", "ĐANG XỬ LÝ"),
    REPLENISHING("REPLENISHING", "ĐANG XỬ LÝ"),
    AVAILABLE("AVAILABLE", "ĐÃ CÓ HÀNG / CHÂM BÙ", true),
    SKIP_ALLOWED("SKIP_ALLOWED", "ĐƯỢC PHÉP SKIP", true),
    CLOSED("CLOSED", "ĐÃ ĐÓNG");

    val isOpenBucket: Boolean get() = this in setOf(OPEN, CLAIMED, SEARCHING, REPLENISHING)
    val isClaimedBucket: Boolean get() = this in setOf(CLAIMED, SEARCHING, REPLENISHING)

    companion object {
        fun from(value: String?): IssueStatus = entries.firstOrNull { it.wire.equals(value, ignoreCase = true) } ?: OPEN
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
    val latestMessage: String = "",
    val assignedId: String? = null,
    val issueVersion: Long = 1,
    val previousIssueId: String? = null,
    val recurrence30m: Boolean = false
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
            latestMessage = json.optString("latest_message"),
            assignedId = json.optString("assigned_id").ifBlank { null },
            issueVersion = json.optLong("issue_version", 1),
            previousIssueId = json.optString("previous_issue_id").ifBlank { null },
            recurrence30m = json.optBoolean("recurrence_30m", false)
        )
    }
}

data class IssueBoard(
    val open: List<StockIssue>,
    val claimed: List<StockIssue>,
    val recent: List<StockIssue>
) {
    val skipped: List<StockIssue> get() = recent.filter { it.status == IssueStatus.SKIP_ALLOWED }
    val available: List<StockIssue> get() = recent.filter { it.status == IssueStatus.AVAILABLE }
}

data class PendingAlert(
    val eventId: String,
    val issueVersion: Long,
    val status: IssueStatus,
    val title: String,
    val message: String,
    val issue: StockIssue?
) {
    companion object {
        fun fromJson(json: JSONObject) = PendingAlert(
            eventId = json.optString("id"),
            issueVersion = json.optLong("issue_version", 1),
            status = IssueStatus.from(json.optString("status")),
            title = json.optString("title"),
            message = json.optString("message"),
            issue = json.optJSONObject("issue")?.let(StockIssue::fromJson)
        )
    }
}

data class OperationalConfig(
    val acknowledgeMinutes: Int = 15,
    val reminderMinutes: Int = 5,
    val replenishMinutes: Int = 15,
    val pickerAckReminderMinutes: Int = 3
) {
    fun toJson() = JSONObject()
        .put("acknowledge_minutes", acknowledgeMinutes)
        .put("reminder_minutes", reminderMinutes)
        .put("replenish_minutes", replenishMinutes)
        .put("picker_ack_reminder_minutes", pickerAckReminderMinutes)

    companion object {
        fun fromJson(json: JSONObject) = OperationalConfig(
            acknowledgeMinutes = json.optInt("acknowledge_minutes", 15),
            reminderMinutes = json.optInt("reminder_minutes", 5),
            replenishMinutes = json.optInt("replenish_minutes", 15),
            pickerAckReminderMinutes = json.optInt("picker_ack_reminder_minutes", 3)
        )
    }
}

data class AppConfig(
    val acknowledgeMinutes: Int = 15,
    val reminderMinutes: Int = 5,
    val replenishMinutes: Int = 15,
    val pickerAckReminderMinutes: Int = 3,
    val diagnosticLogRetentionDays: Int = 14,
    val retentionDays: Int = 60,
    val inventoryAutoSyncEnabled: Boolean = false,
    val inventorySyncIntervalMinutes: Int = 10,
    val inventoryOperatingStartHour: Int = 0,
    val inventoryOperatingEndHour: Int = 23,
    val inventoryFreshMinutes: Int = 10,
    val inventoryStaleMinutes: Int = 30
) {
    fun toJson() = JSONObject()
        .put("acknowledge_minutes", acknowledgeMinutes)
        .put("reminder_minutes", reminderMinutes)
        .put("replenish_minutes", replenishMinutes)
        .put("picker_ack_reminder_minutes", pickerAckReminderMinutes)
        .put("diagnostic_log_retention_days", diagnosticLogRetentionDays)
        .put("retention_days", retentionDays)
        .put("inventory_auto_sync_enabled", inventoryAutoSyncEnabled)
        .put("inventory_sync_interval_minutes", inventorySyncIntervalMinutes)
        .put("inventory_operating_start_hour", inventoryOperatingStartHour)
        .put("inventory_operating_end_hour", inventoryOperatingEndHour)
        .put("inventory_fresh_minutes", inventoryFreshMinutes)
        .put("inventory_stale_minutes", inventoryStaleMinutes)

    companion object {
        fun fromJson(json: JSONObject) = AppConfig(
            acknowledgeMinutes = json.optInt("acknowledge_minutes", 15),
            reminderMinutes = json.optInt("reminder_minutes", 5),
            replenishMinutes = json.optInt("replenish_minutes", 15),
            pickerAckReminderMinutes = json.optInt("picker_ack_reminder_minutes", 3),
            diagnosticLogRetentionDays = json.optInt("diagnostic_log_retention_days", 14),
            retentionDays = json.optInt("retention_days", 60),
            inventoryAutoSyncEnabled = json.optBoolean("inventory_auto_sync_enabled", false),
            inventorySyncIntervalMinutes = json.optInt("inventory_sync_interval_minutes", 10),
            inventoryOperatingStartHour = json.optInt("inventory_operating_start_hour", 0),
            inventoryOperatingEndHour = json.optInt("inventory_operating_end_hour", 23),
            inventoryFreshMinutes = json.optInt("inventory_fresh_minutes", 10),
            inventoryStaleMinutes = json.optInt("inventory_stale_minutes", 30)
        )
    }
}

data class InventoryStatus(
    val sku: String,
    val freshnessStatus: String,
    val stockStatus: String,
    val snapshotCapturedAt: String?,
    val pickableBinQty: Double? = null,
    val pendingOutQty: Double? = null,
    val availableQty: Double? = null
) {
    companion object {
        fun fromJson(json: JSONObject) = InventoryStatus(
            sku = json.optString("sku"),
            freshnessStatus = json.optString("freshness_status", "UNKNOWN"),
            stockStatus = json.optString("stock_status", "NO_DATA"),
            snapshotCapturedAt = json.optString("snapshot_captured_at").ifBlank { null },
            pickableBinQty = json.opt("pickable_bin_qty")?.toString()?.toDoubleOrNull(),
            pendingOutQty = json.opt("pickable_pending_out_qty")?.toString()?.toDoubleOrNull(),
            availableQty = json.opt("pickable_available_qty")?.toString()?.toDoubleOrNull()
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
