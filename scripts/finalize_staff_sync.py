from pathlib import Path

src = Path('.github/workflows/temp-cutover-staff-source.yml')
dst = Path('.github/workflows/staff-sync.yml')
if src.exists():
    s = src.read_text(encoding='utf-8')
elif dst.exists():
    s = dst.read_text(encoding='utf-8')
else:
    raise SystemExit('STAFF_SYNC_SOURCE_MISSING')

s = s.replace('name: Temp cutover staff source to DỮ LIỆU THEO NGÀY', 'name: Staff sync — DỮ LIỆU THEO NGÀY', 1)
old_trigger = """on:
  push:
    branches: [main]
    paths:
      - '.github/workflows/temp-cutover-staff-source.yml'
"""
new_trigger = """on:
  schedule:
    - cron: '17 * * * *'
  workflow_dispatch:
"""
if old_trigger in s:
    s = s.replace(old_trigger, new_trigger, 1)
elif 'schedule:' not in s:
    raise SystemExit('TRIGGER_BLOCK_MISSING')

old_map = """          def upper_ascii(s):
              s=unicodedata.normalize('NFD',str(s or ''))
              return ''.join(c for c in s if unicodedata.category(c)!='Mn').upper()
"""
new_map = """          def upper_ascii(s):
              s=unicodedata.normalize('NFD',str(s or '')).replace('Đ','D').replace('đ','d')
              return ''.join(c for c in s if unicodedata.category(c)!='Mn').upper()
"""
if old_map in s:
    s = s.replace(old_map, new_map, 1)
if "replace('Đ','D').replace('đ','d')" not in s:
    raise SystemExit('COORDINATOR_NORMALIZATION_MISSING')

s = s.replace("p_trigger_source:'DEPLOY'", "p_trigger_source:(process.env.GITHUB_EVENT_NAME==='schedule'?'AUTO':'MANUAL')")
s = s.replace('ops/staff-source-cutover-result.txt', 'ops/staff-sync-last.txt')
s = s.replace('git add ops/staff-source-cutover-result.txt', 'git add ops/staff-sync-last.txt')
s = s.replace('chore(staff): record new source cutover result', 'chore(staff): record hourly staff sync result')

for gate in [
    "cron: '17 * * * *'",
    "STAFF_SHEET_ID: 1E7ZWz-4eMcBliQxDYBVoogIoeSYyiaXGwj0I6mbMm78",
    "STAFF_SHEET_NAME: DANH SÁCH NHÂN SỰ",
    "select A,B,D,E,F where G = 1291 and H = 'HY1'",
    "replace('Đ','D').replace('đ','d')",
]:
    if gate not in s:
        raise SystemExit('STEADY_STATE_GATE_MISSING:' + gate)

dst.write_text(s, encoding='utf-8')
if src.exists() and src != dst:
    src.unlink()
