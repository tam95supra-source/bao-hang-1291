from pathlib import Path
import re

p = Path('web-admin/src/backend-runtime.js')
s = p.read_text(encoding='utf-8')

# Remove the experimental browser-side Firebase signUp helper. Public signUp
# generates a Firebase UID that is not guaranteed to be a UUID, while the
# current Neon authority uses UUID profile IDs. Account creation must stay on
# the existing Firebase Admin worker until that identity contract changes.
s, n = re.subn(
    r"async function createManagedUser\(body, init\) \{.*?\n\}\n\n(?=function withTestRole\(payload, init\) \{)",
    '',
    s,
    count=1,
    flags=re.S,
)

s = s.replace(
    "if (action === 'create-user') return createManagedUser(body, init)",
    "if (action === 'create-user') return worker('update-user', { ...body, initial_password: body.initial_password || body.password || '' }, init)",
    1,
)

required = [
    "headers: { 'content-type': 'text/plain;charset=UTF-8' }",
    "if (action === 'create-user') return worker('update-user', { ...body, initial_password: body.initial_password || body.password || '' }, init)",
]
for gate in required:
    if gate not in s:
        raise SystemExit('ACCOUNT_CREATE_GATE_MISSING:' + gate)
if 'async function createManagedUser(body, init)' in s or 'api_admin_create_profile_rpc' in s:
    raise SystemExit('EXPERIMENTAL_CREATE_ROUTE_REMAINS')

p.write_text(s, encoding='utf-8')
