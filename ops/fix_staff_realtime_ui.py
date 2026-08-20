from pathlib import Path

# Backend realtime: first snapshot of every subscription is baseline only.
p=Path('web-admin/src/backend-runtime.js')
s=p.read_text()
anchor="""    this.closed = false
    statusCallback?.('CONNECTING')"""
repl="""    this.closed = false
    let firstSnapshot = true
    statusCallback?.('CONNECTING')"""
if anchor in s:
    s=s.replace(anchor,repl,1)
elif 'let firstSnapshot = true' not in s:
    raise SystemExit('BACKEND_FIRST_SNAPSHOT_ANCHOR_NOT_FOUND')
old="""          const previous = realtimeSnapshotMarkers.get(topic)
          realtimeSnapshotMarkers.set(topic, marker)
          // Firestore emits the current document immediately after every subscribe.
          // Treat the first snapshot as a baseline and suppress reconnect duplicates.
          if (previous === undefined || previous === marker) return"""
new="""          const previous = realtimeSnapshotMarkers.get(topic)
          realtimeSnapshotMarkers.set(topic, marker)
          // Firestore emits the current document immediately after every subscribe.
          // Current state after reconnect is baseline, never a new event.
          if (firstSnapshot) { firstSnapshot = false; return }
          if (previous === marker) return"""
if old in s:
    s=s.replace(old,new,1)
elif 'if (firstSnapshot) { firstSnapshot = false; return }' not in s:
    raise SystemExit('BACKEND_BASELINE_ANCHOR_NOT_FOUND')
p.write_text(s)

# Main shell: no stale toast can survive a hidden browser tab.
p=Path('web-admin/src/main.js')
s=p.read_text()
old="""function showRealtimeNotice(text) {
  let el = document.getElementById('realtimeNotice');"""
new="""function showRealtimeNotice(text) {
  if (document.hidden) return;
  let el = document.getElementById('realtimeNotice');"""
if old in s:
    s=s.replace(old,new,1)
elif "function showRealtimeNotice(text) {\n  if (document.hidden) return;" not in s:
    raise SystemExit('NOTICE_HIDDEN_ANCHOR_NOT_FOUND')
old="""document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopRealtime(); else if (state.session) startRealtime();
});"""
new="""document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    const notice = document.getElementById('realtimeNotice');
    if (notice) notice.hidden = true;
    stopRealtime();
  } else if (state.session) startRealtime();
});"""
if old in s:
    s=s.replace(old,new,1)
elif "const notice = document.getElementById('realtimeNotice');" not in s:
    raise SystemExit('VISIBILITY_NOTICE_ANCHOR_NOT_FOUND')
p.write_text(s)

# Staff tab: persist search + scroll in sessionStorage, not only RAM.
p=Path('web-admin/src/ops-console.js')
s=p.read_text()
if "const USER_VIEW_STATE_KEY = 'bao-hang-1291-staff-view-state';" not in s:
    anchor="const SESSION_KEY = 'bao-hang-1291-web-session';\n"
    if anchor not in s: raise SystemExit('USER_STATE_KEY_ANCHOR_NOT_FOUND')
    helper="""const USER_VIEW_STATE_KEY = 'bao-hang-1291-staff-view-state';
function readUserViewState() {
  try {
    const value = JSON.parse(sessionStorage.getItem(USER_VIEW_STATE_KEY) || '{}');
    return { userSearch: String(value.userSearch || ''), userTableScrollTop: Math.max(0, Number(value.userTableScrollTop || 0)) };
  } catch { return { userSearch: '', userTableScrollTop: 0 }; }
}
const savedUserViewState = readUserViewState();
"""
    s=s.replace(anchor,anchor+helper,1)
s=s.replace("  userSearch: '',\n  userTableScrollTop: 0,", "  userSearch: savedUserViewState.userSearch,\n  userTableScrollTop: savedUserViewState.userTableScrollTop,",1)
if 'function persistUserViewState()' not in s:
    anchor="const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];\n"
    if anchor not in s: raise SystemExit('PERSIST_HELPER_ANCHOR_NOT_FOUND')
    helper="""function persistUserViewState() {
  try { sessionStorage.setItem(USER_VIEW_STATE_KEY, JSON.stringify({ userSearch: ui.userSearch, userTableScrollTop: ui.userTableScrollTop })); } catch (_) {}
}
"""
    s=s.replace(anchor,anchor+helper,1)
s=s.replace("if (existingSearch) ui.userSearch = existingSearch.value;", "if (existingSearch) { ui.userSearch = existingSearch.value; persistUserViewState(); }",1)
s=s.replace("if (existingUserTable) ui.userTableScrollTop = existingUserTable.scrollTop;", "if (existingUserTable) { ui.userTableScrollTop = existingUserTable.scrollTop; persistUserViewState(); }",1)
s=s.replace("searchInput.addEventListener('input', () => { ui.userSearch = searchInput.value; draw(); });", "searchInput.addEventListener('input', () => { ui.userSearch = searchInput.value; persistUserViewState(); draw(); });",1)
s=s.replace("userTableWrap.addEventListener('scroll', () => { ui.userTableScrollTop = userTableWrap.scrollTop; }, { passive: true });", "userTableWrap.addEventListener('scroll', () => { ui.userTableScrollTop = userTableWrap.scrollTop; persistUserViewState(); }, { passive: true });",1)
for marker in [
    "userSearch: savedUserViewState.userSearch",
    'function persistUserViewState()',
    'persistUserViewState(); draw();',
]:
    if marker not in s: raise SystemExit('STAFF_STATE_MARKER_MISSING:'+marker)
p.write_text(s)
