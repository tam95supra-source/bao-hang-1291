package vn.pickpack1291.baohang.ui

import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import vn.pickpack1291.baohang.data.StockIssue
import java.util.UUID

class IssueBoardAdapter(
    private val createCard: (StockIssue) -> View
) : ListAdapter<StockIssue, IssueBoardAdapter.Holder>(Diff) {

    init { setHasStableIds(true) }

    override fun getItemId(position: Int): Long =
        runCatching { UUID.fromString(getItem(position).id).mostSignificantBits }
            .getOrElse { getItem(position).id.hashCode().toLong() }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val frame = FrameLayout(parent.context).apply {
            layoutParams = RecyclerView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }
        return Holder(frame)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val child = createCard(getItem(position))
        child.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        holder.frame.removeAllViews()
        holder.frame.addView(child)
    }

    class Holder(val frame: FrameLayout) : RecyclerView.ViewHolder(frame)

    private object Diff : DiffUtil.ItemCallback<StockIssue>() {
        override fun areItemsTheSame(oldItem: StockIssue, newItem: StockIssue): Boolean = oldItem.id == newItem.id
        override fun areContentsTheSame(oldItem: StockIssue, newItem: StockIssue): Boolean = oldItem == newItem
    }
}
