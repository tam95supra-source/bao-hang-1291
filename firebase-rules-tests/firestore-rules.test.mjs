import fs from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';

const projectId = 'demo-bao-hang-1291';
const rules = await fs.readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
const env = await initializeTestEnvironment({ projectId, firestore: { rules } });

function bangkokDateParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(new Date());
  const value = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: value('year'), month: value('month'), day: value('day') };
}

function businessDb(uid, role, deviceId = `device-${uid}`) {
  return env.authenticatedContext(uid, {
    site: '1291', role, device_id: deviceId, emergency_enabled: true,
  }).firestore();
}

function shortageBatch(db, suffix, uid, role, deviceId, eventDeviceId = deviceId) {
  const eventId = `evt-${suffix}`;
  const issueId = `issue-${suffix}`;
  const sku = `SKU-${suffix}`;
  const key = `sku-${suffix}`;
  const { year, month, day } = bangkokDateParts();
  const batch = writeBatch(db);
  const controlRef = doc(db, 'emergency_control', 'sequence');
  const eventRef = doc(db, 'emergency_events', eventId);
  const stateRef = doc(db, 'emergency_state', key);
  const opsRef = doc(db, 'emergency_ops_state', key);
  const projectionRef = doc(db, 'emergency_user_state', `${uid}-${issueId}`);
  const event = {
    event_id: eventId,
    emergency_sequence: 1,
    source_mode: 'FIREBASE_EMERGENCY',
    event_type: 'REPORT_SHORTAGE',
    occurred_at_device: Timestamp.now(),
    accepted_at_authority: Timestamp.now(),
    actor_account_id: uid,
    actor_role: role,
    device_id: eventDeviceId,
    issue_id: issueId,
    sku,
    issue_version: 1,
    payload_json: '{}',
    payload_sha256: '0'.repeat(64),
    sheet_ack_at: null,
    reconciliation_status: 'PENDING_SHEET',
  };
  const linked = {
    sku,
    issue_id: issueId,
    status: 'OPEN',
    issue_version: 1,
    updated_at: serverTimestamp(),
    authority_mode: 'FIREBASE_EMERGENCY',
    last_event_id: eventId,
    last_emergency_sequence: 1,
  };
  batch.set(eventRef, event);
  batch.set(controlRef, {
    next_sequence: 1,
    sheet_acked_sequence: 0,
    last_event_id: eventId,
    updated_at: serverTimestamp(),
    quota_year: year,
    quota_month: month,
    quota_day: day,
    estimated_writes_today: 5,
    quota_level: 'OK',
  });
  batch.set(stateRef, linked);
  batch.set(opsRef, {
    ...linked,
    report_count: 1,
    claimed_by_account_id: '',
  });
  batch.set(projectionRef, {
    target_user_id: uid,
    issue_id: issueId,
    sku,
    status: 'OPEN',
    issue_version: 1,
    updated_at: serverTimestamp(),
    authority_mode: 'FIREBASE_EMERGENCY',
    last_event_id: eventId,
    last_emergency_sequence: 1,
  });
  return { batch, refs: { stateRef, opsRef, eventRef, controlRef } };
}

try {
  await env.clearFirestore();

  const unauth = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(unauth, 'emergency_state', 'missing')));

  const wrongSite = env.authenticatedContext('wrong-site', {
    site: '1292', role: 'ADMIN', device_id: 'device-wrong-site', emergency_enabled: true,
  }).firestore();
  await assertFails(getDoc(doc(wrongSite, 'emergency_state', 'missing')));

  const pickerUid = 'picker-test';
  const pickerDevice = 'device-picker-test';
  const picker = businessDb(pickerUid, 'PICKER', pickerDevice);
  const first = shortageBatch(picker, 'picker-ok', pickerUid, 'PICKER', pickerDevice);
  await assertSucceeds(first.batch.commit());
  await assertSucceeds(getDoc(first.refs.stateRef));
  await assertFails(getDoc(first.refs.opsRef));
  await assertFails(getDocs(collection(picker, 'emergency_events')));

  await env.clearFirestore();
  const badDevicePicker = businessDb('picker-bad-device', 'PICKER', 'device-bound');
  const badDevice = shortageBatch(
    badDevicePicker,
    'picker-bad-device',
    'picker-bad-device',
    'PICKER',
    'device-bound',
    'device-other',
  );
  await assertFails(badDevice.batch.commit());

  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await writeBatch(db)
      .set(doc(db, 'emergency_ops_state', 'seed'), {
        sku: 'SKU-SEED', issue_id: 'issue-seed', status: 'OPEN', report_count: 1,
        issue_version: 1, claimed_by_account_id: '', updated_at: Timestamp.now(),
        authority_mode: 'FIREBASE_EMERGENCY', last_event_id: 'evt-seed', last_emergency_sequence: 1,
      })
      .set(doc(db, 'emergency_events', 'evt-seed'), {
        event_id: 'evt-seed', emergency_sequence: 1, source_mode: 'FIREBASE_EMERGENCY',
        event_type: 'REPORT_SHORTAGE', occurred_at_device: Timestamp.now(), accepted_at_authority: Timestamp.now(),
        actor_account_id: 'picker-seed', actor_role: 'PICKER', device_id: 'device-picker-seed',
        issue_id: 'issue-seed', sku: 'SKU-SEED', issue_version: 1, payload_json: '{}', payload_sha256: '0'.repeat(64),
        sheet_ack_at: null, reconciliation_status: 'PENDING_SHEET',
      })
      .set(doc(db, 'emergency_control', 'sequence'), {
        next_sequence: 1, sheet_acked_sequence: 0, last_event_id: 'evt-seed', updated_at: Timestamp.now(),
        quota_year: bangkokDateParts().year, quota_month: bangkokDateParts().month, quota_day: bangkokDateParts().day,
        estimated_writes_today: 5, quota_level: 'OK',
      })
      .commit();
  });

  const invent = businessDb('invent-test', 'INVENT', 'device-invent-test');
  await assertSucceeds(getDocs(collection(invent, 'emergency_ops_state')));
  await assertSucceeds(getDocs(collection(invent, 'emergency_events')));

  const pickerRead = businessDb('picker-read', 'PICKER', 'device-picker-read');
  await assertFails(getDocs(collection(pickerRead, 'emergency_ops_state')));

  const drain = env.authenticatedContext('sheet-drain', {
    site: '1291', account_kind: 'SHEET_DRAIN', drain_enabled: true,
  }).firestore();
  await assertSucceeds(getDoc(doc(drain, 'emergency_control', 'sequence')));
  await assertSucceeds(getDocs(collection(drain, 'emergency_events')));
  await assertFails(getDoc(doc(drain, 'emergency_ops_state', 'seed')));

  const admin = businessDb('admin-test', 'ADMIN', 'device-admin-test');
  await assertFails(getDoc(doc(admin, '__private_probe__', 'x')));

  console.log('FIRESTORE_RULES_EMULATOR=PASS');
} finally {
  await env.cleanup();
}
