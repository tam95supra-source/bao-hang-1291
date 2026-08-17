import json, os, time, urllib.error, urllib.parse, urllib.request

CANONICAL = '15_AJ8oB7cEeQjeM6Jb6dm0ki6NcqyxPRVRTAvQPHVM0'
ARCHIVE = '1f3kIUbx34zu_noi0cRGkwdWkjAihQY0Nm_Eyhc6KxBo'
NEON = 'https://ep-morning-bread-az3w94qb.apirest.c-3.ap-southeast-1.aws.neon.tech/neondb/rest/v1'
G = os.environ['GOOGLE_ACCESS_TOKEN']
F = os.environ['FIREBASE_ID_TOKEN']

def request(url, method='GET', body=None, bearer=None):
    data = None if body is None else json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode()
    headers = {'Accept': 'application/json'}
    if data is not None:
        headers['Content-Type'] = 'application/json'
    if bearer:
        headers['Authorization'] = 'Bearer ' + bearer
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'HTTP {e.code}: {e.read().decode()[:800]}')

def rpc(name, payload):
    return request(f'{NEON}/rpc/{name}', 'POST', payload, F)

def sheet_get(sheet_id, a1):
    q = urllib.parse.quote(a1, safe='!:$')
    out = request(f'https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{q}', bearer=G)
    return out.get('values', []) if out else []

def text(v):
    return '' if v is None else str(v)

def parse_payload(v):
    if isinstance(v, dict):
        return v
    if not v:
        return {}
    try:
        p = json.loads(v)
        return p if isinstance(p, dict) else {}
    except Exception:
        return {}

# Historical ACKed events are preserved in the former CURRENT sheet.
old = sheet_get(ARCHIVE, 'SU_KIEN!A1:P20000')
if not old or len(old[0]) < 16:
    raise RuntimeError('ARCHIVE_EVENT_SCHEMA_INVALID')
h = {name: idx for idx, name in enumerate(old[0])}
required = ['event_id','event_type','accepted_at_authority','actor_account_id','issue_id','sku','payload_json']
if any(k not in h for k in required):
    raise RuntimeError('ARCHIVE_EVENT_HEADERS_MISSING')

events = {}
for row in old[1:]:
    def c(name):
        i = h[name]
        return row[i] if i < len(row) else ''
    eid = text(c('event_id')).strip()
    if not eid:
        continue
    payload = parse_payload(c('payload_json'))
    events[eid] = {
        'event_id': eid,
        'numeric_id': None,
        'time': c('accepted_at_authority') or c('occurred_at_device'),
        'event_type': c('event_type'),
        'issue_id': c('issue_id'),
        'sku': c('sku'),
        'actor_id': c('actor_account_id'),
        'payload': payload,
        'pending': False,
    }

# Current pending queue is read from the production cached worker RPC.
pending = rpc('worker_sheet_batch_rpc', {'p_limit': 500}) or []
for e in pending:
    eid = text(e.get('event_id')).strip()
    if not eid:
        raise RuntimeError('PENDING_EVENT_ID_MISSING')
    events[eid] = {
        'event_id': eid,
        'numeric_id': int(e['id']),
        'time': e.get('accepted_at_authority') or e.get('created_at') or e.get('occurred_at_device'),
        'event_type': e.get('event_type'),
        'issue_id': e.get('issue_id'),
        'sku': e.get('sku'),
        'actor_id': e.get('actor_account_id') or (e.get('payload') or {}).get('actor_id') or (e.get('payload') or {}).get('reporter_id'),
        'payload': e.get('payload') or {},
        'pending': True,
    }

# Current snapshots come from Neon production APIs, not from stale Sheet state.
users_obj = rpc('api_list_users_rpc', {'p_test_role': None}) or {}
users = users_obj.get('users') or []
issues_obj = rpc('api_issue_history_rpc', {'p_limit': 500, 'p_test_role': None}) or {}
issues = issues_obj.get('issues') or []
if not users or not issues or not events:
    raise RuntimeError('NEON_SNAPSHOT_EMPTY')

# Use event payload timestamps/reopen_count to enrich the current snapshots.
user_updated = {}
issue_latest = {}
for e in events.values():
    p = e['payload']
    et = text(e['event_type']).upper()
    if et == 'USER_UPSERT' and p.get('employee_code'):
        code = text(p['employee_code'])
        if p.get('updated_at'):
            user_updated[code] = text(p['updated_at'])
    if e.get('issue_id'):
        iid = text(e['issue_id'])
        cur = issue_latest.get(iid)
        stamp = text(p.get('updated_at') or e.get('time'))
        if cur is None or stamp >= cur[0]:
            issue_latest[iid] = (stamp, p)

EVENT_HEADER = ['Mã sự kiện','Thời gian','Loại sự kiện','Ticket ID','SKU','Tên sản phẩm','Trạng thái','Số lượt báo','Người báo/Actor ID','Dữ liệu JSON']
ISSUE_HEADER = ['Ticket ID','SKU','Tên sản phẩm','Trạng thái','Số lượt báo','Báo lần đầu','Cập nhật cuối','Invent xử lý','Số lần mở lại']
USER_HEADER = ['Mã nhân viên','Họ tên','Nhà thầu','Vai trò','Trạng thái','Cập nhật cuối']

def event_sort_key(e):
    return (text(e.get('time')), text(e.get('event_id')))

event_values = [EVENT_HEADER]
for e in sorted(events.values(), key=event_sort_key):
    p = e['payload']
    event_values.append([
        e['event_id'], text(e['time']), text(e['event_type']), text(e['issue_id']), text(e['sku']),
        text(p.get('product_name')), text(p.get('status')), text(p.get('report_count') or 0), text(e['actor_id']),
        json.dumps(p, ensure_ascii=False, separators=(',', ':')),
    ])

issue_values = [ISSUE_HEADER]
for x in sorted(issues, key=lambda z: (text(z.get('reported_at')), text(z.get('id')))):
    iid = text(x.get('id'))
    p = issue_latest.get(iid, ('', {}))[1]
    issue_values.append([
        iid, text(x.get('sku')), text(x.get('product_name')), text(x.get('status')), text(x.get('report_count') or 0),
        text(x.get('reported_at')), text(x.get('updated_at')), text(x.get('assigned_name') or p.get('assigned_name')),
        text(p.get('reopen_count') or 0),
    ])

user_values = [USER_HEADER]
for u in sorted(users, key=lambda z: text(z.get('employee_code'))):
    code = text(u.get('employee_code'))
    user_values.append([
        code, text(u.get('full_name')), text(u.get('contractor')), text(u.get('role')),
        'HOẠT ĐỘNG' if u.get('active') else 'NGỪNG HOẠT ĐỘNG', text(user_updated.get(code)),
    ])

info_values = [
    ['Mục','Giá trị'],
    ['Nguồn dữ liệu','Neon PostgreSQL — BÁO HÀNG 1291'],
    ['Đăng nhập / thông báo','Firebase Auth + FCM — bao-hang-1291'],
    ['Sheet báo cáo chính',CANONICAL],
    ['Luồng lưu lịch sử','App/Web → Neon sheet_export_queue → Apps Script → SU_KIEN'],
    ['Snapshot nghiệp vụ','TRANG_THAI_SKU + NHAN_SU cập nhật theo khóa, không tạo trùng'],
    ['Mật khẩu','KHÔNG đồng bộ vào Google Sheet'],
    ['Cập nhật',time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())],
]

base = f'https://sheets.googleapis.com/v4/spreadsheets/{CANONICAL}'
request(base + '/values:batchClear', 'POST', {'ranges':['SU_KIEN!A:Z','TRANG_THAI_SKU!A:Z','NHAN_SU!A:Z','THONG_TIN!A:B']}, G)
request(base + '/values:batchUpdate', 'POST', {
    'valueInputOption':'RAW',
    'data':[
        {'range':'SU_KIEN!A1','majorDimension':'ROWS','values':event_values},
        {'range':'TRANG_THAI_SKU!A1','majorDimension':'ROWS','values':issue_values},
        {'range':'NHAN_SU!A1','majorDimension':'ROWS','values':user_values},
        {'range':'THONG_TIN!A1','majorDimension':'ROWS','values':info_values},
    ]
}, G)

# ACK only numeric IDs that were pending and are now physically in the canonical Sheet.
pending_ids = [e['numeric_id'] for e in events.values() if e['pending'] and e['numeric_id'] is not None]
if pending_ids:
    ack = int(rpc('worker_sheet_ack_rpc', {'p_ids': pending_ids}) or 0)
    if ack < len(pending_ids):
        raise RuntimeError(f'SHEET_ACK_SHORT {ack}/{len(pending_ids)}')

# Read-back evidence.
ranges = ['SU_KIEN!A:A','TRANG_THAI_SKU!A:A','NHAN_SU!A:A']
query = '&'.join('ranges=' + urllib.parse.quote(x, safe='!:$') for x in ranges)
check = request(base + '/values:batchGet?' + query, bearer=G)
lengths = [len(v.get('values', [])) for v in check.get('valueRanges', [])]
expected = [len(event_values), len(issue_values), len(user_values)]
if lengths != expected:
    raise RuntimeError(f'ROWCOUNT_MISMATCH got={lengths} expected={expected}')
by_code = {text(u.get('employee_code')): u for u in users}
for code in ('6281280','6282909','6319416','6330290','baohang1'):
    if code not in by_code:
        raise RuntimeError('PROFILE_MISSING_' + code)
if by_code['6281280'].get('role') != 'ADMIN' or not by_code['6281280'].get('active'):
    raise RuntimeError('PROTECTED_ADMIN_MISMATCH')
print(f'CANONICAL_SHEET_BACKFILL_PASS events={len(events)} issues={len(issues)} users={len(users)} acked_pending={len(pending_ids)}')
