from pathlib import Path

p = Path('google-apps-script/DEPLOY_NEON.gs')
s = p.read_text(encoding='utf-8')

s = s.replace(
    'const variants = ["select A,B,D,E where G = 1291 and H = \'HY1\'","select A,B,D,E where G = \'1291\' and H = \'HY1\'"];',
    'const variants = ["select A,B,D,E,F where G = 1291 and H = \'HY1\'","select A,B,D,E,F where G = \'1291\' and H = \'HY1\'"];',
    1,
)
s = s.replace(
    "const position=String(row[2]||'').trim(),contractor=String(row[3]||'').trim();\n        byCode[code.toLowerCase()]={employee_code:code,full_name:name,contractor:contractor,source_position:position,role:staffRole_(position,code)};",
    "const position=String(row[2]||'').trim(),contractor=String(row[3]||'').trim(),department=String(row[4]||'').trim();\n        byCode[code.toLowerCase()]={employee_code:code,full_name:name,contractor:contractor,source_position:position,role:staffRole_(position,department,code)};",
    1,
)
old_role = """function staffRole_(position,code) {
  if(String(code)===BH_PROTECTED_ADMIN_CODE)return 'ADMIN';
  const p=String(position||'').toUpperCase();
  if(p.indexOf('INVENT')>=0)return 'INVENT';
  return 'PICKER';
}"""
new_role = """function staffRole_(position,department,code) {
  if(String(code)===BH_PROTECTED_ADMIN_CODE)return 'ADMIN';
  const p=String(position||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/Đ/g,'D').toUpperCase();
  const d=String(department||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/Đ/g,'D').toUpperCase();
  if(p.indexOf('DIEU PHOI')>=0)return 'ADMIN_INVENT';
  if(d.indexOf('INVENT')>=0||p.indexOf('INVENT')>=0)return 'INVENT';
  return 'PICKER';
}"""
if old_role in s:
    s = s.replace(old_role, new_role, 1)
elif 'function staffRole_(position,department,code)' not in s:
    raise SystemExit('STAFF_ROLE_BLOCK_MISSING')

s = s.replace(
    "if(caller.profile.role==='ADMIN_INVENT' && role!=='PICKER')throw new Error('FORBIDDEN');",
    "if(caller.profile.role==='ADMIN_INVENT' && ['INVENT','PICKER'].indexOf(role)<0)throw new Error('FORBIDDEN');",
    1,
)
s = s.replace(
    "if(caller.profile.role==='ADMIN_INVENT'&&target.role!=='PICKER')throw new Error('FORBIDDEN');",
    "if(caller.profile.role==='ADMIN_INVENT'&&['INVENT','PICKER'].indexOf(String(target.role||''))<0)throw new Error('FORBIDDEN');",
    1,
)

for gate in [
    "const BH_STAFF_SHEET_ID = '1E7ZWz-4eMcBliQxDYBVoogIoeSYyiaXGwj0I6mbMm78';",
    "const BH_STAFF_SHEET_NAME = 'DANH SÁCH NHÂN SỰ';",
    "select A,B,D,E,F where G = 1291 and H = 'HY1'",
    'staffRole_(position,department,code)',
    "p.indexOf('DIEU PHOI')>=0",
    "['INVENT','PICKER'].indexOf(role)<0",
]:
    if gate not in s:
        raise SystemExit('CANONICAL_GATE_MISSING:' + gate)

p.write_text(s, encoding='utf-8')
