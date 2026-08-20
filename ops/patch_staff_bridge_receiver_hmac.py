from pathlib import Path

p=Path('google-apps-script/STAFF_SOURCE_BRIDGE_RECEIVER.gs')
s=p.read_text()

s=s.replace(
    " * DỮ LIỆU THEO NGÀY emits only change metadata; this receiver authenticates the\n * trigger owner's Google OAuth identity, re-reads the trusted Sheet, then mutates\n * Firebase + Neon only for actual deltas.\n",
    " * DỮ LIỆU THEO NGÀY emits only signed change metadata. Shared HMAC material lives only\n * in Apps Script Properties; receiver re-reads the trusted Sheet before mutating Firebase/Neon.\n",
)

if "HMAC_PROP: 'STAFF_BRIDGE_HMAC_SECRET'" not in s:
    anchor="  SENDER_EMAIL: 'tam95.supra@gmail.com',\n"
    assert anchor in s
    s=s.replace(anchor,anchor+"  HMAC_PROP: 'STAFF_BRIDGE_HMAC_SECRET',\n  HMAC_MAX_SKEW_MS: 300000,\n",1)

old="  staffSourceBridgeVerifyGoogleSender_(String(body.oauth_token || ''));\n"
if old in s:
    s=s.replace(old,"  staffSourceBridgeVerifySender_(body);\n",1)
elif 'staffSourceBridgeVerifySender_(body);' not in s:
    raise RuntimeError('VERIFY_CALL_ANCHOR_NOT_FOUND')

if 'function staffSourceBridgeVerifySender_(body)' not in s:
    anchor='function staffSourceBridgeVerifyGoogleSender_(oauthToken) {'
    assert anchor in s
    helper=r'''function staffSourceBridgeVerifySender_(body) {
  const signature = String(body && body.hmac_sha256 || '').trim().toLowerCase();
  const secret = String(PropertiesService.getScriptProperties().getProperty(BH_STAFF_BRIDGE.HMAC_PROP) || '');
  if (signature && secret.length >= 32) {
    const sentAt = Date.parse(String(body.sent_at || ''));
    if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > BH_STAFF_BRIDGE.HMAC_MAX_SKEW_MS) {
      throw new Error('STAFF_BRIDGE_HMAC_STALE');
    }
    const expected = staffSourceBridgeHmacHex_(body, secret);
    if (!staffSourceBridgeSecureEq_(signature, expected)) throw new Error('STAFF_BRIDGE_HMAC_INVALID');
    return 'HMAC';
  }
  staffSourceBridgeVerifyGoogleSender_(String(body && body.oauth_token || ''));
  return 'OAUTH';
}

function staffSourceBridgeCanonical_(payload) {
  const oldCodes = payload.old_codes && typeof payload.old_codes === 'object' && !Array.isArray(payload.old_codes) ? payload.old_codes : {};
  const oldPart = Object.keys(oldCodes).sort(function(a,b){
    const na=Number(a), nb=Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na-nb;
    return String(a).localeCompare(String(b));
  }).map(function(k){ return String(k) + '=' + String(oldCodes[k] || ''); }).join('&');
  return [String(payload.action || ''),String(payload.event_id || ''),String(payload.source_id || ''),String(payload.source_tab || ''),String(payload.change_type || ''),String(payload.row_start || ''),String(payload.row_end || ''),String(payload.col_start || ''),String(payload.col_end || ''),String(payload.at || ''),String(payload.sent_at || ''),oldPart].join('\n');
}

function staffSourceBridgeHmacHex_(payload, secret) {
  const bytes = Utilities.computeHmacSha256Signature(staffSourceBridgeCanonical_(payload), secret, Utilities.Charset.UTF_8);
  return bytes.map(function(b){ return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function staffSourceBridgeSecureEq_(a, b) {
  a=String(a || ''); b=String(b || '');
  if (a.length !== b.length) return false;
  let diff=0;
  for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

'''
    s=s.replace(anchor,helper+anchor,1)

p.write_text(s)
