from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 anchor, got {count}')
    return text.replace(old, new, 1)

main_path = Path('app/src/main/java/vn/pickpack1291/baohang/ui/MainActivity.kt')
src = main_path.read_text(encoding='utf-8')

old = '''        inventRenderSignature = ""
        val tabButtons = mutableListOf<Button>()

        fun updateTabs() {
'''
new = '''        inventRenderSignature = ""
        val tabButtons = mutableListOf<Button>()
        val renderedSignatures = mutableMapOf<String, String>()

        fun updateTabs() {
'''
src = replace_once(src, old, new, 'rendered signature map')

old = '''            val signature = buildString {
                append(inventSelectedTab).append('|')
                list.forEach { append(it.id).append(':').append(it.status.wire).append(':').append(it.reportCount).append(':').append(it.issueVersion).append(';') }
            }
            if (!force && signature == inventRenderSignature) return
            inventRenderSignature = signature

            val scroll = content.parent as? ScrollView
            val oldScrollY = scroll?.scrollY ?: 0
            boardContainer.removeAllViews()
            if (list.isEmpty()) boardContainer.addView(infoBox("Không có SKU trong nhóm này."))
            list.forEach { issue -> boardContainer.addView(issueCard(issue, inventSelectedTab) { inventRefresh?.invoke() }) }
            scroll?.post { scroll.scrollTo(0, oldScrollY) }
'''
new = '''            val scroll = content.parent as? ScrollView
            val oldScrollY = scroll?.scrollY ?: 0
            if (list.isEmpty()) {
                val alreadyEmpty = boardContainer.childCount == 1 && boardContainer.getChildAt(0).tag == "__empty__"
                if (!alreadyEmpty) {
                    boardContainer.removeAllViews()
                    boardContainer.addView(infoBox("Không có SKU trong nhóm này.").apply { tag = "__empty__" })
                }
                renderedSignatures.clear()
                inventRenderSignature = "${inventSelectedTab}|empty"
                return
            }

            if (boardContainer.childCount == 1 && boardContainer.getChildAt(0).tag == "__empty__") {
                boardContainer.removeAllViews()
            }

            val desiredIds = list.map { it.id }
            list.forEachIndexed { index, issue ->
                val id = issue.id
                val issueSignature = buildString {
                    append(issue.status.wire).append(':')
                    append(issue.reportCount).append(':')
                    append(issue.issueVersion).append(':')
                    append(issue.assignedId.orEmpty()).append(':')
                    append(issue.assignedName).append(':')
                    append(issue.latestReporterName).append(':')
                    append(issue.recurrence30m)
                }
                var currentIndex = (0 until boardContainer.childCount)
                    .firstOrNull { boardContainer.getChildAt(it).tag == id } ?: -1

                if (currentIndex >= 0 && currentIndex != index) {
                    val existing = boardContainer.getChildAt(currentIndex)
                    boardContainer.removeViewAt(currentIndex)
                    boardContainer.addView(existing, index)
                    currentIndex = index
                }

                val needsReplace = currentIndex < 0 || force || renderedSignatures[id] != issueSignature
                if (needsReplace) {
                    val card = issueCard(issue, inventSelectedTab) { inventRefresh?.invoke() }.apply { tag = id }
                    if (currentIndex >= 0) {
                        boardContainer.removeViewAt(index)
                        boardContainer.addView(card, index)
                    } else {
                        boardContainer.addView(card, index)
                    }
                }
                renderedSignatures[id] = issueSignature
            }

            while (boardContainer.childCount > list.size) {
                boardContainer.removeViewAt(boardContainer.childCount - 1)
            }
            renderedSignatures.keys.retainAll(desiredIds.toSet())
            inventRenderSignature = buildString {
                append(inventSelectedTab).append('|')
                desiredIds.forEach { append(it).append(';') }
            }
            scroll?.post { if (scroll.scrollY != oldScrollY) scroll.scrollTo(0, oldScrollY) }
'''
src = replace_once(src, old, new, 'incremental board diff')

old = '''                val tab = button(label) {
                    inventSelectedTab = index
                    inventRenderSignature = ""
                    draw(true)
                }
'''
new = '''                val tab = button(label) {
                    inventSelectedTab = index
                    inventRenderSignature = ""
                    renderedSignatures.clear()
                    draw(true)
                }
'''
src = replace_once(src, old, new, 'tab reset signatures')

main_path.write_text(src, encoding='utf-8')

msg_path = Path('app/src/main/java/vn/pickpack1291/baohang/notifications/StockMessagingService.kt')
msg = msg_path.read_text(encoding='utf-8')
old = '''            runCatching { ContextCompat.startForegroundService(this, overlay) }
                .onFailure {
                    app.diagnostics.error("overlay_start_failed", it, mapOf("event_id" to eventId))
                    NotificationHelper.alert(this, sku, status, body, eventId)
                }
        } else {
            NotificationHelper.alert(this, sku, status, body, eventId)
        }
'''
new = '''            runCatching { ContextCompat.startForegroundService(this, overlay) }
                .onFailure {
                    app.diagnostics.error("overlay_start_failed", it, mapOf("event_id" to eventId))
                    NotificationHelper.alert(this, sku, status, body, eventId)
                    if (isHandlerOpenAlert && eventId.isNotBlank()) {
                        scope.launch { runCatching { app.repository.markAlertDisplayed(eventId) } }
                    }
                }
        } else {
            NotificationHelper.alert(this, sku, status, body, eventId)
            if (isHandlerOpenAlert && eventId.isNotBlank()) {
                scope.launch { runCatching { app.repository.markAlertDisplayed(eventId) } }
            }
        }
'''
msg = replace_once(msg, old, new, 'background OPEN displayed gate')
msg_path.write_text(msg, encoding='utf-8')

helper_path = Path('app/src/main/java/vn/pickpack1291/baohang/notifications/NotificationHelper.kt')
helper = helper_path.read_text(encoding='utf-8')
old = '''            .setContentTitle("Báo hàng 1291 • $status")
'''
new = '''            .setContentTitle(when (status.uppercase()) {
                "OPEN" -> "CÓ SKU CẦN XỬ LÝ"
                "AVAILABLE" -> "ĐÃ CÓ HÀNG"
                "SKIP_ALLOWED" -> "CHO PHÉP SKIP"
                else -> "Báo hàng 1291 • $status"
            })
'''
helper = replace_once(helper, old, new, 'notification title')
helper_path.write_text(helper, encoding='utf-8')

required = {
    main_path: ['renderedSignatures', 'boardContainer.getChildAt(it).tag == id', 'tag = "__empty__"'],
    msg_path: ['app.repository.markAlertDisplayed(eventId)'],
    helper_path: ['"OPEN" -> "CÓ SKU CẦN XỬ LÝ"'],
}
for path, tokens in required.items():
    text = path.read_text(encoding='utf-8')
    for token in tokens:
        if token not in text:
            raise SystemExit(f'missing guardrail {token} in {path}')
print('ANDROID_INCREMENTAL_UI_PATCH=PASS')
