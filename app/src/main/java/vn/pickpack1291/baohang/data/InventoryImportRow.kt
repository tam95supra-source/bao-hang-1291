package vn.pickpack1291.baohang.data

data class InventoryImportRow(
    val rowKey: String,
    val sku: String,
    val binCode: String,
    val storageType: String,
    val isPickable: Boolean,
    val binQty: Double,
    val pendingOutQty: Double
)
