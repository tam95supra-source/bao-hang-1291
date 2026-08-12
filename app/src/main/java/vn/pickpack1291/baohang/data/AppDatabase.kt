package vn.pickpack1291.baohang.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject
import java.text.Normalizer
import java.util.Locale

class AppDatabase(context: Context) : SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {
    override fun onConfigure(db: SQLiteDatabase) {
        super.onConfigure(db)
        db.setForeignKeyConstraintsEnabled(true)
        db.enableWriteAheadLogging()
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE sku_catalog(
                sku TEXT PRIMARY KEY,
                product_name TEXT NOT NULL,
                search_text TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"""
        )
        db.execSQL("CREATE INDEX idx_sku_name ON sku_catalog(product_name)")
        db.execSQL("CREATE INDEX idx_sku_search ON sku_catalog(search_text)")
        db.execSQL(
            """CREATE TABLE issue_cache(
                id TEXT PRIMARY KEY,
                sku TEXT NOT NULL,
                product_name TEXT NOT NULL,
                status TEXT NOT NULL,
                report_count INTEGER NOT NULL,
                reported_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                assigned_name TEXT NOT NULL DEFAULT '',
                latest_reporter_name TEXT NOT NULL DEFAULT '',
                latest_message TEXT NOT NULL DEFAULT ''
            )"""
        )
        db.execSQL("CREATE INDEX idx_issue_cache_status ON issue_cache(status, updated_at DESC)")
        db.execSQL(
            """CREATE TABLE outbox(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT NOT NULL DEFAULT ''
            )"""
        )
        db.execSQL("CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) db.execSQL("ALTER TABLE issue_cache ADD COLUMN latest_message TEXT NOT NULL DEFAULT ''")
        if (oldVersion < 3) {
            db.execSQL("ALTER TABLE sku_catalog ADD COLUMN search_text TEXT NOT NULL DEFAULT ''")
            db.execSQL("CREATE INDEX IF NOT EXISTS idx_sku_search ON sku_catalog(search_text)")
            val cursor = db.rawQuery("SELECT sku,product_name FROM sku_catalog", null)
            cursor.use {
                val values = ContentValues()
                while (it.moveToNext()) {
                    val sku = it.getString(0)
                    values.clear()
                    values.put("search_text", normalize("$sku ${it.getString(1)}"))
                    db.update("sku_catalog", values, "sku=?", arrayOf(sku))
                }
            }
            db.delete("metadata", "key=?", arrayOf("catalog_last_sync"))
        }
    }

    fun upsertSkus(items: List<SkuItem>) {
        if (items.isEmpty()) return
        writableDatabase.beginTransaction()
        try {
            val values = ContentValues()
            items.forEach { item ->
                values.clear()
                values.put("sku", item.sku)
                values.put("product_name", item.productName)
                values.put("search_text", normalize("${item.sku} ${item.productName}"))
                values.put("updated_at", System.currentTimeMillis().toString())
                writableDatabase.insertWithOnConflict("sku_catalog", null, values, SQLiteDatabase.CONFLICT_REPLACE)
            }
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
    }

    fun searchSkus(query: String, limit: Int = 20): List<SkuItem> {
        val normalized = normalize(query)
        if (normalized.isBlank()) return emptyList()
        val tokens = normalized.split(' ').filter { it.isNotBlank() }.take(6)
        val where = tokens.joinToString(" AND ") { "(lower(sku) LIKE ? OR search_text LIKE ?)" }
        val args = mutableListOf<String>()
        tokens.forEach { token -> args += "%$token%"; args += "%$token%" }
        val skuRaw = query.trim().lowercase(Locale.ROOT)
        val prefix = "$skuRaw%"
        args += skuRaw
        args += prefix
        args += "%$skuRaw%"
        args += limit.toString()
        val cursor = readableDatabase.rawQuery(
            """SELECT sku, product_name FROM sku_catalog
               WHERE $where
               ORDER BY CASE
                 WHEN lower(sku)=? THEN 0
                 WHEN lower(sku) LIKE ? THEN 1
                 WHEN lower(sku) LIKE ? THEN 2
                 ELSE 3 END, sku
               LIMIT ?""",
            args.toTypedArray()
        )
        return cursor.use {
            buildList { while (it.moveToNext()) add(SkuItem(it.getString(0), it.getString(1))) }
        }
    }

    fun skuCount(): Int = readableDatabase.rawQuery("SELECT COUNT(*) FROM sku_catalog", null).use {
        if (it.moveToFirst()) it.getInt(0) else 0
    }

    fun upsertIssues(issues: List<StockIssue>) {
        if (issues.isEmpty()) return
        writableDatabase.beginTransaction()
        try {
            val values = ContentValues()
            issues.forEach { issue ->
                values.clear()
                values.put("id", issue.id)
                values.put("sku", issue.sku)
                values.put("product_name", issue.productName)
                values.put("status", issue.status.wire)
                values.put("report_count", issue.reportCount)
                values.put("reported_at", issue.reportedAt)
                values.put("updated_at", issue.updatedAt)
                values.put("assigned_name", issue.assignedName)
                values.put("latest_reporter_name", issue.latestReporterName)
                values.put("latest_message", issue.latestMessage)
                writableDatabase.insertWithOnConflict("issue_cache", null, values, SQLiteDatabase.CONFLICT_REPLACE)
            }
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
    }

    fun cachedIssues(limit: Int = 200): List<StockIssue> {
        val cursor = readableDatabase.rawQuery(
            "SELECT id,sku,product_name,status,report_count,reported_at,updated_at,assigned_name,latest_reporter_name,latest_message FROM issue_cache ORDER BY updated_at DESC LIMIT ?",
            arrayOf(limit.toString())
        )
        return cursor.use {
            buildList {
                while (it.moveToNext()) add(
                    StockIssue(
                        it.getString(0), it.getString(1), it.getString(2),
                        IssueStatus.from(it.getString(3)), it.getInt(4), it.getString(5),
                        it.getString(6), it.getString(7), it.getString(8), it.getString(9)
                    )
                )
            }
        }
    }

    fun enqueue(action: String, payload: JSONObject): Long {
        val values = ContentValues().apply {
            put("action", action)
            put("payload", payload.toString())
            put("created_at", System.currentTimeMillis())
        }
        return writableDatabase.insert("outbox", null, values)
    }

    data class OutboxItem(val id: Long, val action: String, val payload: JSONObject)

    fun outbox(limit: Int = 100): List<OutboxItem> {
        val cursor = readableDatabase.rawQuery(
            "SELECT id,action,payload FROM outbox ORDER BY id LIMIT ?", arrayOf(limit.toString())
        )
        return cursor.use {
            buildList {
                while (it.moveToNext()) add(OutboxItem(it.getLong(0), it.getString(1), JSONObject(it.getString(2))))
            }
        }
    }

    fun removeOutbox(id: Long) = writableDatabase.delete("outbox", "id=?", arrayOf(id.toString()))

    fun failOutbox(id: Long, error: String) {
        writableDatabase.execSQL(
            "UPDATE outbox SET attempts=attempts+1,last_error=? WHERE id=?",
            arrayOf(error.take(500), id)
        )
    }

    fun setMetadata(key: String, value: String) {
        val values = ContentValues().apply { put("key", key); put("value", value) }
        writableDatabase.insertWithOnConflict("metadata", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun metadata(key: String): String? = readableDatabase.rawQuery(
        "SELECT value FROM metadata WHERE key=?", arrayOf(key)
    ).use { if (it.moveToFirst()) it.getString(0) else null }

    companion object {
        private const val DB_NAME = "bao_hang_1291.db"
        private const val DB_VERSION = 3

        fun normalize(value: String): String = Normalizer.normalize(value.trim(), Normalizer.Form.NFD)
            .replace(Regex("\\p{M}+"), "")
            .lowercase(Locale.ROOT)
            .replace('đ', 'd')
            .replace(Regex("\\s+"), " ")
    }
}
