from pathlib import Path
import re


def replace_function(path: str, name: str, replacement: str) -> None:
    p = Path(path)
    src = p.read_text(encoding='utf-8')
    pattern = rf"function {re.escape(name)}\([^\n]*\) \{{.*?^\}}"
    out, count = re.subn(pattern, replacement.rstrip(), src, count=1, flags=re.S | re.M)
    if count != 1:
        raise SystemExit(f'{path}: function {name} replacement count={count}')
    p.write_text(out + ('' if out.endswith('\n') else '\n'), encoding='utf-8')


replace_function(
    'google-apps-script/DEPLOY_NEON.gs',
    'staffRole_',
    """function staffRole_(position,department,code) {
  if(String(code)===BH_PROTECTED_ADMIN_CODE)return 'ADMIN';
  return 'PICKER';
}""",
)

replace_function(
    'google-apps-script/STAFF_SOURCE_BRIDGE_RECEIVER.gs',
    'staffSourceBridgeRole_',
    """function staffSourceBridgeRole_(position, department, code) {
  if (String(code) === BH_PROTECTED_ADMIN_CODE) return 'ADMIN';
  return 'PICKER';
}""",
)

workflow = Path('.github/workflows/staff-sync.yml')
s = workflow.read_text(encoding='utf-8')
old = "              role='ADMIN_INVENT' if 'DIEU PHOI' in p else ('INVENT' if 'INVENT' in d or 'INVENT' in p else 'PICKER')"
if old not in s:
    raise SystemExit('staff-sync role derivation anchor not found')
s = s.replace(old, "              role='PICKER'", 1)
workflow.write_text(s, encoding='utf-8')

full = Path('ops/full_staff_sync.mjs')
s = full.read_text(encoding='utf-8')
anchor = "if(!Array.isArray(source.staff)||source.staff.length<1||source.staff.length>500)throw new Error('SOURCE_COUNT_INVALID');\n"
insert = anchor + "source.staff = source.staff.filter(item => String(item.employee_code || '') !== '6281280').map(item => ({...item, role:'PICKER'}));\n"
if "map(item => ({...item, role:'PICKER'}))" not in s:
    if anchor not in s:
        raise SystemExit('full sync source normalization anchor not found')
    s = s.replace(anchor, insert, 1)
old_pass = "const pass=result.failed===0&&mismatches.length===0&&protectedAdmins.length===1&&gsheetActive.length===source.staff.length;\nconst proof={status:pass?'PASS':'FAIL',source_count:source.staff.length,total_profiles:finalProfiles.length,active_gsheet:gsheetActive.length,protected_admins:protectedAdmins.length,created:result.created,updated:result.updated,unchanged:result.unchanged,deactivated:result.deactivated,failed:result.failed,retries:result.retries,mismatch_count:mismatches.length,role_counts:roleCounts,error_summary:result.errors.slice(0,20).join('; ').slice(0,1500)};"
new_pass = "const gsheetElevated=gsheetActive.filter(p=>p.role!=='PICKER');\nconst pass=result.failed===0&&mismatches.length===0&&protectedAdmins.length===1&&gsheetActive.length===source.staff.length&&gsheetElevated.length===0;\nconst proof={status:pass?'PASS':'FAIL',source_count:source.staff.length,total_profiles:finalProfiles.length,active_gsheet:gsheetActive.length,gsheet_elevated:gsheetElevated.length,protected_admins:protectedAdmins.length,created:result.created,updated:result.updated,unchanged:result.unchanged,deactivated:result.deactivated,failed:result.failed,retries:result.retries,mismatch_count:mismatches.length,role_counts:roleCounts,error_summary:result.errors.slice(0,20).join('; ').slice(0,1500)};"
if old_pass not in s:
    raise SystemExit('full sync proof anchor not found')
s = s.replace(old_pass, new_pass, 1)
full.write_text(s, encoding='utf-8')

print('PATCH_STAFF_SOURCE_PICKER=PASS')
