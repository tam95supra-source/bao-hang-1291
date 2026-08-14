from pathlib import Path
p=Path('google-apps-script/Code.gs')
s=p.read_text(encoding='utf-8')
old="  const signingSecret = String(PropertiesService.getScriptProperties().getProperty('FALLBACK_TOKEN_SIGNING_SECRET') || '');\n  if (signingSecret.length < 32) throw new Error('FALLBACK_AUTH_NOT_CONFIGURED');"
new="  const signingSecret = fallbackSigningSecret_();"
if old not in s:
    raise SystemExit('signing marker missing')
p.write_text(s.replace(old,new,1),encoding='utf-8')
Path('scripts/fix_apps_script_signing_secret.py').unlink()
print('APPS_SCRIPT_SIGNING_FALLBACK=READY')
