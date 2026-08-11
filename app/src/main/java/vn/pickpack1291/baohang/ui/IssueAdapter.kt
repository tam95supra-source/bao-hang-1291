package vn.pickpack1291.baohang.ui

import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.TextView
import vn.pickpack1291.baohang.R
import vn.pickpack1291.baohang.data.StockIssue
import java.time.Duration
import java.time.Instant

class IssueAdapter(private val context: Context) : BaseAdapter() {
    private val items = mutableListOf<StockIssue>()

    fun submit(newItems: List<StockIssue>) {
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }

    override fun getCount() = items.size
    override fun getItem(position: Int) = items[position]
    override fun getItemId(position: Int) = position.toLong()

    override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
        val view = convertView ?: LayoutInflater.from(context).inflate(R.layout.row_issue, parent, false)
        val item = getItem(position)
        view.findViewById<TextView>(R.id.tvIssueSku).text = item.sku
        view.findViewById<TextView>(R.id.tvIssueProduct).text = item.productName
        view.findViewById<TextView>(R.id.tvIssueElapsed).text = elapsed(item.reportedAt)
        val assignee = item.assignedName.ifBlank { "Chưa có người nhận" }
        view.findViewById<TextView>(R.id.tvIssueMeta).text =
            "${item.status.label} • ${item.reportCount} lượt báo • $assignee"
        return view
    }

    private fun elapsed(value: String): String = runCatching {
        val minutes = Duration.between(Instant.parse(value), Instant.now()).toMinutes().coerceAtLeast(0)
        if (minutes < 60) "${minutes}p" else "${minutes / 60}g${minutes % 60}p"
    }.getOrDefault("")
}
