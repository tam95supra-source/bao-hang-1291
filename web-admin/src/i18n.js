const STORAGE_KEY = 'bao-hang-1291-language';

const EN = new Map([
  ['BÁO HÀNG 1291','SHORTAGE REPORT 1291'],
  ['Web nghiệp vụ','Operations Web'],
  ['Tiếng Việt Nam','Vietnamese'],
  ['Đổi mật khẩu','Change password'],
  ['Đăng xuất','Sign out'],
  ['Tổng quan','Overview'],
  ['Sự kiện','Shortage handling'],
  ['Danh mục SKU','SKU catalog'],
  ['Báo cáo','Reports'],
  ['Nhân sự & quyền','Staff & permissions'],
  ['Nhân sự','Staff'],
  ['Thiết bị','Devices'],
  ['Hệ thống & dung lượng','System & storage'],
  ['Nhật ký & kiểm tra','Logs & audit'],
  ['Nhật ký','Logs'],
  ['Cấu hình','Settings'],
  ['Phiên bản','Versions'],
  ['Thời gian nghiệp vụ','Operating times'],
  ['Báo thiếu hàng','Report shortage'],
  ['DỊCH VỤ','SERVICE'],
  ['CẬP NHẬT','REALTIME'],
  ['BÁO CÁO','REPORTING'],
  ['CHI PHÍ','COST'],
  ['HOẠT ĐỘNG','ONLINE'],
  ['ĐANG KẾT NỐI','CONNECTING'],
  ['ĐANG GIÁM SÁT','MONITORING'],
  ['Đang tải dữ liệu…','Loading data…'],
  ['Đang xử lý…','Processing…'],
  ['Đang đồng bộ…','Syncing…'],
  ['Làm mới','Refresh'],
  ['Xử lý báo thiếu','Shortage handling'],
  ['Realtime · cập nhật đúng dòng, không tải lại màn hình.','Realtime · updates only the changed row without reloading the page.'],
  ['Đang xử lý','In progress'],
  ['Chờ nhận','Waiting for pickup'],
  ['Gần đây','Recent'],
  ['Đã thu hồi','Withdrawn'],
  ['Chọn một SKU','Select an SKU'],
  ['Chi tiết và thao tác sẽ hiển thị tại đây.','Details and actions will appear here.'],
  ['Không có SKU trong nhóm này.','No SKU in this group.'],
  ['Chưa có tên SKU','SKU name unavailable'],
  ['Lượt báo','Report count'],
  ['Người xử lý','Handler'],
  ['Chưa nhận','Unassigned'],
  ['Báo lúc','Reported at'],
  ['Thời gian chờ','Waiting time'],
  ['SKU báo lại trong vòng 30 phút.','This SKU was reported again within 30 minutes.'],
  ['Nhận xử lý','Take ownership'],
  ['Có hàng','In stock'],
  ['Cho SKIP','Allow skip'],
  ['CHO PHÉP SKIP','ALLOW SKIP'],
  ['Cho phép SKIP','Allow skip'],
  ['Cho phép bỏ qua','Allow skip'],
  ['Điều phối lại','Reassign'],
  ['ĐÃ TÌM THẤY HÀNG','ITEM FOUND'],
  ['Đã tìm thấy hàng','Item found'],
  ['Đã có hàng','Available'],
  ['Đã bỏ qua','Skipped'],
  ['Đã đóng','Closed'],
  ['Đã thu hồi','Withdrawn'],
  ['Đang tìm hàng','Searching'],
  ['Đang châm hàng','Replenishing'],
  ['50% yêu cầu được tiếp nhận trong','50% of requests were picked up within'],
  ['50% yêu cầu được xử lý xong trong','50% of requests were completed within'],
  ['95% yêu cầu được tiếp nhận trong','95% of requests were picked up within'],
  ['95% yêu cầu được xử lý xong trong','95% of requests were completed within'],
  ['Yêu cầu báo lại trong 30 phút','Requests repeated within 30 minutes'],
  ['Yêu cầu đang cần xử lý','Requests needing action'],
  ['Quá thời gian tiếp nhận','Pickup overdue'],
  ['Hiệu quả xử lý','Handling performance'],
  ['Kết quả 24 giờ gần nhất','Last 24 hours'],
  ['Chất lượng xử lý 30 ngày','30-day handling quality'],
  ['SKU phát sinh báo thiếu nhiều nhất','Most frequently reported SKUs'],
  ['Chi tiết các yêu cầu báo thiếu','Shortage request details'],
  ['Thời gian báo','Reported at'],
  ['Tên hàng','Product name'],
  ['Kết quả','Result'],
  ['Thời gian nhận','Pickup time'],
  ['Thời gian xử lý','Handling time'],
  ['Báo lại trong 30 phút','Repeated within 30 minutes'],
  ['Có','Yes'],
  ['Không','No'],
  ['phút','min'],
  ['giờ','hours'],
  ['vừa xong','just now'],
  ['Thời gian tiếp nhận (phút)','Pickup target (minutes)'],
  ['Từ lúc người lấy hàng báo thiếu đến khi người xử lý nhận yêu cầu.','From shortage report until a handler accepts the request.'],
  ['Nhắc lại nếu chưa xử lý (phút)','Reminder interval if still pending (minutes)'],
  ['Khoảng cách giữa các lần nhắc khi yêu cầu vẫn chưa hoàn tất.','Interval between reminders while the request is still unresolved.'],
  ['Thời gian xử lý sau khi nhận (phút)','Handling target after pickup (minutes)'],
  ['Thời gian theo dõi sau khi người xử lý đã nhận yêu cầu.','Target time after a handler accepts the request.'],
  ['Nhắc người lấy hàng xác nhận (phút)','Picker acknowledgement reminder (minutes)'],
  ['Dùng cho cảnh báo có hàng hoặc được phép bỏ qua.','Used for available/skip acknowledgement alerts.'],
  ['Nhắc lại khi đã tìm thấy hàng (phút)','Item-found reminder interval (minutes)'],
  ['Mặc định 5 phút. Cảnh báo sẽ nhắc lại tới khi người lấy hàng xác nhận.','Default 5 minutes. The alert repeats until the picker acknowledges it.'],
  ['Tự động cho phép bỏ qua khi quá thời gian','Automatically allow skip after timeout'],
  ['Tự động bỏ qua sau (phút)','Auto-skip after (minutes)'],
  ['Có thể tắt hoàn toàn.','Can be disabled completely.'],
  ['LƯU THỜI GIAN NGHIỆP VỤ','SAVE OPERATING TIMES'],
  ['Đã lưu thời gian nghiệp vụ.','Operating times saved.'],
  ['Nhật ký web','Web logs'],
  ['Log thiết bị','Device logs'],
  ['Lịch sử nghiệp vụ','Business audit'],
  ['Chưa có log web.','No web logs yet.'],
  ['Chưa có log.','No logs yet.'],
  ['TẢI','DOWNLOAD'],
  ['Lưu log chẩn đoán (ngày)','Diagnostic log retention (days)'],
  ['Log cũ tự xóa để kiểm soát dung lượng.','Old logs are automatically removed to control storage.'],
  ['Tự động cho phép bỏ qua SKU','Automatically allow SKU skip'],
  ['Lưu cấu hình hệ thống','Save system settings'],
]);

const REGEX = [
  [/\b(\d+) phút\b/g, '$1 min'],
  [/\b(\d+) giờ\b/g, '$1 h'],
  [/\b(\d+) lượt\b/g, '$1 reports'],
  [/\b(\d+) người\b/g, '$1 people'],
  [/\b(\d+) yêu cầu\b/g, '$1 requests'],
];

let language = localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'vi';
const textOriginal = new WeakMap();
const attrOriginal = new WeakMap();
const selfChanged = new WeakSet();
let observer;

export function getLanguage() { return language; }
export function getLocale() { return language === 'en' ? 'en-US' : 'vi-VN'; }

export function translateText(value) {
  let out = String(value ?? '');
  if (language !== 'en' || !out.trim()) return out;
  const entries = [...EN.entries()].sort((a,b) => b[0].length - a[0].length);
  for (const [vi,en] of entries) out = out.split(vi).join(en);
  for (const [re,repl] of REGEX) out = out.replace(re,repl);
  return out;
}

export function t(vi, en = '') {
  if (language !== 'en') return vi;
  return en || EN.get(vi) || translateText(vi);
}

function translateNode(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE) return;
  if (node.parentElement?.closest('.bh-language-switcher,script,style')) return;
  if (!textOriginal.has(node)) textOriginal.set(node, node.nodeValue || '');
  const source = textOriginal.get(node);
  const next = language === 'en' ? translateText(source) : source;
  if (node.nodeValue !== next) {
    selfChanged.add(node);
    node.nodeValue = next;
  }
}

function translateAttrs(el) {
  if (!(el instanceof Element) || el.closest('.bh-language-switcher')) return;
  let saved = attrOriginal.get(el);
  if (!saved) { saved = {}; attrOriginal.set(el, saved); }
  for (const name of ['placeholder','title','aria-label']) {
    if (!el.hasAttribute(name)) continue;
    if (!(name in saved)) saved[name] = el.getAttribute(name) || '';
    const source = saved[name];
    const next = language === 'en' ? translateText(source) : source;
    if (el.getAttribute(name) !== next) el.setAttribute(name, next);
  }
}

export function translateTree(root = document.body) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) translateNode(root);
  else {
    if (root instanceof Element) translateAttrs(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; while ((n = walker.nextNode())) translateNode(n);
    root.querySelectorAll?.('[placeholder],[title],[aria-label]').forEach(translateAttrs);
  }
}

function ensureSwitcher() {
  if (!document.body || document.querySelector('.bh-language-switcher')) return;
  const wrap = document.createElement('label');
  wrap.className = 'bh-language-switcher';
  wrap.innerHTML = '<span>Ngôn ngữ</span><select aria-label="Ngôn ngữ giao diện"><option value="vi">Tiếng Việt Nam</option><option value="en">English</option></select>';
  wrap.querySelector('select').value = language;
  wrap.querySelector('select').addEventListener('change', (event) => setLanguage(event.target.value));
  document.body.appendChild(wrap);
  if (language === 'en') translateTree(wrap);
}

export function setLanguage(next) {
  language = next === 'en' ? 'en' : 'vi';
  localStorage.setItem(STORAGE_KEY, language);
  document.documentElement.lang = language === 'en' ? 'en' : 'vi';
  translateTree(document.body);
  ensureSwitcher();
  const select = document.querySelector('.bh-language-switcher select');
  if (select) select.value = language;
  window.dispatchEvent(new CustomEvent('bh:languagechange', { detail: { language } }));
}

export function installI18n() {
  document.documentElement.lang = language === 'en' ? 'en' : 'vi';
  ensureSwitcher();
  translateTree(document.body);
  observer?.disconnect();
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'characterData') {
        if (selfChanged.has(m.target)) { selfChanged.delete(m.target); continue; }
        textOriginal.set(m.target, m.target.nodeValue || '');
        translateNode(m.target);
      } else {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === Node.TEXT_NODE) translateNode(n);
          else if (n.nodeType === Node.ELEMENT_NODE) translateTree(n);
        });
      }
    }
    ensureSwitcher();
  });
  observer.observe(document.documentElement, { subtree:true, childList:true, characterData:true });
}
