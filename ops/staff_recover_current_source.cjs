'use strict';

const fs = require('fs');

const deploy = fs.readFileSync('google-apps-script/DEPLOY_NEON.gs', 'utf8');
const bridge = fs.readFileSync('google-apps-script/STAFF_SOURCE_BRIDGE_RECEIVER.gs', 'utf8');
const filter = "String(row[6] || '').trim() !== '1291' || String(row[7] || '').trim().toUpperCase() !== 'HY1'";

if (!deploy.includes(filter)) throw new Error('CANONICAL_STAFF_FILTER_MISSING_DEPLOY');
if (!bridge.includes(filter)) throw new Error('CANONICAL_STAFF_FILTER_MISSING_BRIDGE');
if (!deploy.includes('STAFF_RECOVERY_RETIRED_CANONICAL_HY1')) throw new Error('LEGACY_502_RECOVERY_NOT_RETIRED');

console.log('STAFF_SOURCE_CONTRACT=1291_HY1');
console.log('LEGACY_502_RECOVERY_RETIRED=PASS');
