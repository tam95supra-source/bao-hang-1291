package vn.pickpack1291.baohang.importer

import android.content.ContentResolver
import android.net.Uri
import android.util.Xml
import org.xmlpull.v1.XmlPullParser
import vn.pickpack1291.baohang.data.ImportUserRow
import vn.pickpack1291.baohang.data.SkuItem
import vn.pickpack1291.baohang.data.UserRole
import java.io.ByteArrayInputStream
import java.text.Normalizer
import java.util.Locale
import java.util.zip.ZipInputStream

class XlsxImporter(private val resolver: ContentResolver) {
    data class ParsedWorkbook(val rows: List<Map<Int, String>>)

    fun parseSkuFile(uri: Uri): List<SkuItem> {
        val rows = readWorkbook(uri).rows
        if (rows.isEmpty()) throw ImportException("File không có dữ liệu")
        val headers = headerMap(rows.first())
        val skuColumn = findHeader(headers, "sku", "ma sku")
        val nameColumn = findHeader(headers, "ten san pham", "ten hang", "product name")
        val deduplicated = linkedMapOf<String, SkuItem>()
        rows.drop(1).forEachIndexed { index, row ->
            val sku = row[skuColumn].orEmpty().trim()
            val name = row[nameColumn].orEmpty().trim()
            if (sku.isBlank() && name.isBlank()) return@forEachIndexed
            if (sku.isBlank() || name.isBlank()) {
                throw ImportException("Dòng ${index + 2}: thiếu SKU hoặc Tên sản phẩm")
            }
            val existing = deduplicated[sku]
            if (existing != null && !existing.productName.equals(name, ignoreCase = true)) {
                throw ImportException("SKU $sku có nhiều tên sản phẩm khác nhau")
            }
            deduplicated[sku] = SkuItem(sku, name)
        }
        if (deduplicated.isEmpty()) throw ImportException("Không tìm thấy SKU hợp lệ")
        return deduplicated.values.toList()
    }

    fun parseUserFile(uri: Uri): List<ImportUserRow> {
        val rows = readWorkbook(uri).rows
        if (rows.isEmpty()) throw ImportException("File không có dữ liệu")
        val headers = headerMap(rows.first())
        val codeColumn = findHeader(headers, "ma nhan vien", "employee code")
        val nameColumn = findHeader(headers, "ho ten", "ten nhan vien", "full name")
        val contractorColumn = findHeader(headers, "nha thau", "contractor")
        val roleColumn = findHeader(headers, "vai tro", "role")
        val activeColumn = findHeader(headers, "trang thai", "active")
        val passwordColumn = findHeader(headers, "mat khau khoi tao", "mat khau", "initial password")
        val unique = linkedMapOf<String, ImportUserRow>()
        rows.drop(1).forEachIndexed { index, row ->
            val line = index + 2
            val code = row[codeColumn].orEmpty().trim()
            val name = row[nameColumn].orEmpty().trim()
            if (code.isBlank() && name.isBlank()) return@forEachIndexed
            if (code.isBlank() || name.isBlank()) throw ImportException("Dòng $line: thiếu mã hoặc họ tên")
            if (!code.matches(Regex("[A-Za-z0-9._-]+"))) {
                throw ImportException("Dòng $line: mã nhân viên chỉ được dùng chữ, số, dấu chấm, gạch ngang hoặc gạch dưới")
            }
            val role = parseRole(row[roleColumn].orEmpty(), line)
            val active = parseActive(row[activeColumn].orEmpty(), line)
            if (unique.containsKey(code.lowercase())) throw ImportException("Mã nhân viên $code bị trùng")
            unique[code.lowercase()] = ImportUserRow(
                employeeCode = code,
                fullName = name,
                contractor = row[contractorColumn].orEmpty().trim(),
                role = role,
                active = active,
                initialPassword = row[passwordColumn].orEmpty()
            )
        }
        if (unique.isEmpty()) throw ImportException("Không tìm thấy nhân sự hợp lệ")
        return unique.values.toList()
    }

    private fun readWorkbook(uri: Uri): ParsedWorkbook {
        val entries = mutableMapOf<String, ByteArray>()
        resolver.openInputStream(uri)?.use { input ->
            ZipInputStream(input).use { zip ->
                var entry = zip.nextEntry
                while (entry != null) {
                    if (!entry.isDirectory && (
                            entry.name == "xl/sharedStrings.xml" ||
                                entry.name == "xl/worksheets/sheet1.xml"
                            )
                    ) {
                        entries[entry.name] = zip.readBytes()
                    }
                    zip.closeEntry()
                    entry = zip.nextEntry
                }
            }
        } ?: throw ImportException("Không mở được file")
        val sheet = entries["xl/worksheets/sheet1.xml"]
            ?: throw ImportException("Không tìm thấy Sheet1 trong file XLSX")
        val shared = entries["xl/sharedStrings.xml"]?.let(::parseSharedStrings).orEmpty()
        return ParsedWorkbook(parseSheet(sheet, shared))
    }

    private fun parseSharedStrings(bytes: ByteArray): List<String> {
        val parser = newParser(bytes)
        val strings = mutableListOf<String>()
        var inString = false
        var inText = false
        var buffer = StringBuilder()
        while (parser.eventType != XmlPullParser.END_DOCUMENT) {
            when (parser.eventType) {
                XmlPullParser.START_TAG -> if (parser.name == "si") {
                    inString = true
                    buffer = StringBuilder()
                } else if (inString && parser.name == "t") {
                    inText = true
                }
                XmlPullParser.TEXT -> if (inText) buffer.append(parser.text)
                XmlPullParser.END_TAG -> when (parser.name) {
                    "t" -> inText = false
                    "si" -> { strings.add(buffer.toString()); inString = false }
                }
            }
            parser.next()
        }
        return strings
    }

    private fun parseSheet(bytes: ByteArray, shared: List<String>): List<Map<Int, String>> {
        val parser = newParser(bytes)
        val rows = mutableListOf<Map<Int, String>>()
        var row = linkedMapOf<Int, String>()
        var cellColumn = 0
        var cellType = ""
        var cellValue = ""
        var capture = false
        while (parser.eventType != XmlPullParser.END_DOCUMENT) {
            when (parser.eventType) {
                XmlPullParser.START_TAG -> when (parser.name) {
                    "row" -> row = linkedMapOf()
                    "c" -> {
                        cellColumn = columnIndex(parser.getAttributeValue(null, "r").orEmpty())
                        cellType = parser.getAttributeValue(null, "t").orEmpty()
                        cellValue = ""
                    }
                    "v", "t" -> capture = true
                }
                XmlPullParser.TEXT -> if (capture) cellValue += parser.text
                XmlPullParser.END_TAG -> when (parser.name) {
                    "v", "t" -> capture = false
                    "c" -> {
                        val value = if (cellType == "s") {
                            cellValue.toIntOrNull()?.let(shared::getOrNull).orEmpty()
                        } else cellValue
                        if (value.isNotEmpty()) row[cellColumn] = value
                    }
                    "row" -> rows.add(row)
                }
            }
            parser.next()
        }
        return rows
    }

    private fun newParser(bytes: ByteArray): XmlPullParser = Xml.newPullParser().apply {
        setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        setInput(ByteArrayInputStream(bytes), "UTF-8")
    }

    private fun columnIndex(reference: String): Int {
        var result = 0
        reference.takeWhile { it.isLetter() }.forEach { result = result * 26 + (it.uppercaseChar() - 'A' + 1) }
        return (result - 1).coerceAtLeast(0)
    }

    private fun headerMap(row: Map<Int, String>) = row.mapValues { normalize(it.value) }

    private fun findHeader(headers: Map<Int, String>, vararg aliases: String): Int {
        val normalized = aliases.map(::normalize)
        return headers.entries.firstOrNull { it.value in normalized }?.key
            ?: throw ImportException("Thiếu cột bắt buộc: ${aliases.first()}")
    }

    private fun normalize(value: String): String = Normalizer.normalize(value.trim(), Normalizer.Form.NFD)
        .replace(Regex("\\p{M}+"), "").lowercase(Locale.ROOT).replace('đ', 'd')
        .replace(Regex("\\s+"), " ")

    private fun parseRole(value: String, line: Int): UserRole = when (normalize(value)) {
        "picker", "pick", "nguoi bao", "nguoi bao hang" -> UserRole.PICKER
        "invent user", "invent_user", "invent" -> UserRole.INVENT_USER
        "invent admin", "invent_admin", "admin" -> UserRole.INVENT_ADMIN
        else -> throw ImportException("Dòng $line: vai trò '$value' không hợp lệ")
    }

    private fun parseActive(value: String, line: Int): Boolean = when (normalize(value)) {
        "hoat dong", "active", "true", "1", "co" -> true
        "ngung", "ngung hoat dong", "inactive", "false", "0", "khong" -> false
        else -> throw ImportException("Dòng $line: trạng thái '$value' không hợp lệ")
    }
}

class ImportException(message: String) : Exception(message)
