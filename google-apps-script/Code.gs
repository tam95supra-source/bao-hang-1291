/**
 * Báo hàng 1291 — webhook đồng bộ báo cáo vào Google Sheets.
 * Dùng dưới dạng Apps Script gắn với một Spreadsheet.
 * Script Property bắt buộc: WEBHOOK_SECRET.
 */

const EVENT_HEADERS = [
  'Queue ID', 'Thời gian', 'Loại sự kiện', 'Ticket ID', 'SKU', 'Tên sản phẩm',
  'Trạng thái', 'Số lượt báo', 'Người báo/Actor ID', 'Dữ liệu JSON'
];
const ISSUE_HEADERS = [
  'Ticket ID', 'SKU', 'Tên sản phẩm', 'Trạng thái', 'Số lượt báo',
  'Báo lần đầu', 'Cập nhật cuối', 'Invent xử lý', 'Số lần mở lại'
];
const USER_HEADERS = ['Mã nhân viên', 'Họ tên', 'Nhà thầu', 'Vai trò', 'Trạng thái', 'Cập nhật cuối'];

function setupBaoHang1291() {
  getOrCreateSheet_('SU_KIEN', EVENT_HEADERS);
  getOrCreateSheet_('TRANG_THAI_SKU', ISSUE_HEADERS);
  getOrCreateSheet_('NHAN_SU', USER_HEADERS);
  const info = getOrCreateSheet_('THONG_TIN', ['Mục', 'Giá trị']);
  if (info.getLastRow() < 2) {
    info.getRange(2, 1, 4, 2).setValues([
      ['Nguồn dữ liệu', 'Supabase — Báo hàng 1291'],
      ['Mật khẩu', 'KHÔNG đồng bộ vào Google Sheet'],
      ['Lưu báo cáo', '60 ngày theo cấu hình hệ thống'],
      ['Cập nhật', new Date()]
    ]);
  }
  return 'Đã tạo cấu trúc Google Sheet Báo hàng 1291';
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
    if (!expected || body.secret !== expected) return json_({ ok: false, error: 'Unauthorized' });
    const events = Array.isArray(body.events) ? body.events : [];
    const state = PropertiesService.getScriptProperties();
    let lastId = Number(state.getProperty('LAST_QUEUE_ID') || 0);
    let processed = 0;
    events.sort((a, b) => Number(a.id) - Number(b.id)).forEach(event => {
      const id = Number(event.id);
      if (!id || id <= lastId) return;
      applyEvent_(event);
      lastId = id;
      state.setProperty('LAST_QUEUE_ID', String(lastId));
      processed++;
    });
    return json_({ ok: true, processed, lastId });
  } catch (error) {
    return json_({ ok: false, error: String(error) });
  } finally {
    lock.releaseLock();
  }
}

function applyEvent_(event) {
  const payload = event.payload || {};
  const eventSheet = getOrCreateSheet_('SU_KIEN', EVENT_HEADERS);
  eventSheet.appendRow([
    event.id,
    new Date(event.created_at || Date.now()),
    event.event_type || '',
    payload.id || '',
    payload.sku || '',
    payload.product_name || '',
    payload.status || '',
    payload.report_count || '',
    payload.reporter_id || payload.actor_id || '',
    JSON.stringify(payload)
  ]);

  if (event.event_type === 'USER_UPSERT') {
    upsertByKey_(getOrCreateSheet_('NHAN_SU', USER_HEADERS), 1, payload.employee_code, [
      payload.employee_code || '', payload.full_name || '', payload.contractor || '',
      payload.role || '', payload.active ? 'HOẠT ĐỘNG' : 'NGỪNG HOẠT ĐỘNG',
      new Date(payload.updated_at || Date.now())
    ]);
    return;
  }
  if (payload.id && payload.sku) {
    upsertByKey_(getOrCreateSheet_('TRANG_THAI_SKU', ISSUE_HEADERS), 1, payload.id, [
      payload.id, payload.sku, payload.product_name || '', payload.status || '',
      payload.report_count || 1, new Date(payload.reported_at || event.created_at || Date.now()),
      new Date(payload.updated_at || event.created_at || Date.now()),
      payload.assigned_name || '', payload.reopen_count || 0
    ]);
  }
}

function getOrCreateSheet_(name, headers) {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(name);
  if (!sheet) sheet = book.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#123B5D').setFontColor('#FFFFFF').setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);
  }
  return sheet;
}

function upsertByKey_(sheet, keyColumn, key, rowValues) {
  if (!key) return;
  const lastRow = sheet.getLastRow();
  let row = lastRow + 1;
  if (lastRow >= 2) {
    const match = sheet.getRange(2, keyColumn, lastRow - 1, 1)
      .createTextFinder(String(key)).matchEntireCell(true).findNext();
    if (match) row = match.getRow();
  }
  sheet.getRange(row, 1, 1, rowValues.length).setValues([rowValues]);
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
