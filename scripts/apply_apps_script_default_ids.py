from pathlib import Path
p=Path('google-apps-script/Code.gs')
s=p.read_text(encoding='utf-8')
s=s.replace(""" * Required Script Properties (values MUST NOT be committed):
 * - WEBHOOK_SECRET                 server-to-server exporter/importer secret
 * - FALLBACK_TOKEN_SIGNING_SECRET  HMAC-SHA256 key used to verify 7-day fallback tokens
 * - TARGET_SPREADSHEET_ID          current private monthly workbook
 * - CURRENT_FOLDER_ID              BAO_HANG_1291/CURRENT
 * - ARCHIVE_FOLDER_ID              BAO_HANG_1291/ARCHIVE
 * - INDEX_SPREADSHEET_ID           private monthly index workbook (optional until cutover)
""",""" * Required Script Property:
 * - WEBHOOK_SECRET                 existing server-to-server exporter/importer secret
 *
 * Target Drive/Sheet IDs below are public resource identifiers, not secrets. Script Properties
 * may override them after monthly rotation, but cutover does not require manual property entry.
""")
marker="const SCHEMA_VERSION = 'target-final-v1';"
constants="""const DEFAULT_TARGET_SPREADSHEET_ID = '1f3kIUbx34zu_noi0cRGkwdWkjAihQY0Nm_Eyhc6KxBo';
const DEFAULT_CURRENT_FOLDER_ID = '122jX6MkcD1PeY-YcFBBWjz49nVZWK5nR';
const DEFAULT_ARCHIVE_FOLDER_ID = '19VRSzS5u9wXA0-Bnsv9j3O2d_fCkUDIf';
const DEFAULT_INDEX_SPREADSHEET_ID = '1i_KPYGsXpxCag-Oz5NkG4UmshZt2fbDFBcv1QH1-p8w';

"""
if constants.strip() not in s:
    s=s.replace(marker,constants+marker,1)
s=s.replace("const id = String(PropertiesService.getScriptProperties().getProperty('TARGET_SPREADSHEET_ID') || '').trim();","const id = String(PropertiesService.getScriptProperties().getProperty('TARGET_SPREADSHEET_ID') || DEFAULT_TARGET_SPREADSHEET_ID).trim();",1)
s=s.replace("const active = SpreadsheetApp.getActiveSpreadsheet();\n  if (!active) throw new Error('TARGET_SPREADSHEET_ID_NOT_CONFIGURED');\n  return active;","throw new Error('TARGET_SPREADSHEET_ID_NOT_CONFIGURED');",1)
s=s.replace("const props=PropertiesService.getScriptProperties(); const currentFolderId=String(props.getProperty('CURRENT_FOLDER_ID')||''),archiveFolderId=String(props.getProperty('ARCHIVE_FOLDER_ID')||'');","const props=PropertiesService.getScriptProperties(); const currentFolderId=String(props.getProperty('CURRENT_FOLDER_ID')||DEFAULT_CURRENT_FOLDER_ID),archiveFolderId=String(props.getProperty('ARCHIVE_FOLDER_ID')||DEFAULT_ARCHIVE_FOLDER_ID);",1)
s=s.replace("const id = String(PropertiesService.getScriptProperties().getProperty('INDEX_SPREADSHEET_ID') || '');","const id = String(PropertiesService.getScriptProperties().getProperty('INDEX_SPREADSHEET_ID') || DEFAULT_INDEX_SPREADSHEET_ID);",1)
p.write_text(s,encoding='utf-8')
Path('scripts/apply_apps_script_default_ids.py').unlink()
print('APPS_SCRIPT_DEFAULT_TARGET_IDS=READY')
