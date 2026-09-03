const STORAGE_KEY = 'bao-hang-1291-language';

const EN = new Map([
  ['VẬN HÀNH','OPERATIONS'],
  ['QUẢN LÝ','MANAGEMENT'],
  ['HẠ TẦNG','INFRASTRUCTURE'],
  ['THIẾT LẬP','SETTINGS'],
  ['Phiên bản ứng dụng','App versions'],
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

  ['Ngôn ngữ','Language'],
  ['Ngôn ngữ giao diện','Interface language'],
  ['Tiếng Anh','English'],
  ['Admin hệ thống','System administrator'],
  ['Admin Event','Event administrator'],
  ['Người báo hàng','Shortage handler'],
  ['Người lấy hàng','Picker'],
  ['Picker / Người lấy hàng','Picker'],
  ['Đăng nhập bằng tài khoản Báo hàng 1291.','Sign in with your Shortage Report 1291 account.'],
  ['Mã nhân viên','Employee ID'],
  ['Mật khẩu','Password'],
  ['ĐĂNG NHẬP','SIGN IN'],
  ['Lấy lại mật khẩu','Reset password'],
  ['Quyền được kiểm tra tại server. Web không chứa service-role key, thông tin xác thực máy chủ hoặc private key.','Permissions are enforced on the server. The web app contains no service-role key, server credential, or private key.'],
  ['Đang xác thực…','Signing in…'],
  ['Tài khoản đã ngừng hoạt động.','This account is inactive.'],
  ['Nhập mã nhân viên trước khi lấy lại mật khẩu.','Enter the employee ID before resetting the password.'],
  ['Đang kiểm tra tài khoản…','Checking account…'],
  ['Xác nhận tài khoản sẽ được đặt lại mật khẩu.','Confirm the account whose password will be reset.'],
  ['Họ tên','Full name'],
  ['Email nhận mật khẩu','Password recovery email'],
  ['Hủy','Cancel'],
  ['GỬI MẬT KHẨU MỚI','SEND NEW PASSWORD'],
  ['Đang tạo và gửi mật khẩu tạm…','Creating and sending a temporary password…'],
  ['Không thể gửi mật khẩu mới.','Unable to send the new password.'],
  ['Đóng','Close'],
  ['Mật khẩu mới tối thiểu 8 ký tự.','The new password must contain at least 8 characters.'],
  ['Mật khẩu mới','New password'],
  ['Nhập lại mật khẩu','Confirm new password'],
  ['ĐỔI MẬT KHẨU','CHANGE PASSWORD'],
  ['Mật khẩu mới phải có ít nhất 8 ký tự.','The new password must contain at least 8 characters.'],
  ['Hai lần nhập mật khẩu chưa khớp.','The two password entries do not match.'],
  ['Đang đổi mật khẩu…','Changing password…'],
  ['Đã đổi mật khẩu thành công.','Password changed successfully.'],
  ['ĐANG KIỂM THỬ QUYỀN:','TESTING ROLE:'],
  ['API cũng bị hạ quyền tương ứng.','API permissions are reduced to the same role.'],
  ['Thoát kiểm thử','Exit test'],
  ['Kiểm thử giao diện + quyền server:','Test UI + server permissions:'],
  ['TRỰC TUYẾN','ONLINE'],
  ['TỰ LÀM MỚI','AUTO REFRESH'],
  ['MẤT KẾT NỐI','OFFLINE'],
  ['Danh mục SKU vừa cập nhật','SKU catalog updated'],
  ['Có cập nhật báo hàng mới','A shortage update is available'],
  ['Danh sách nhân sự vừa cập nhật','Staff list updated'],
  ['Cấu hình vừa cập nhật','Settings updated'],
  ['Tổng quan vận hành kho','Warehouse operations overview'],
  ['Tổng quan hôm nay','Today overview'],
  ['Tình hình báo thiếu, xử lý và kết quả kho trong 24 giờ.','Shortage requests, handling status, and warehouse results over the last 24 hours.'],
  ['Trạng thái vận hành hiện tại, sự kiện cần xử lý và kết quả trong 24 giờ.','Current operating status, requests requiring action, and results over the last 24 hours.'],
  ['Đang tải dữ liệu vận hành…','Loading operating data…'],
  ['Đang tổng hợp dữ liệu vận hành…','Compiling operating data…'],
  ['Cập nhật lúc','Updated at'],
  ['Cập nhật','Updated'],
  ['Trực tuyến','Online'],
  ['Tự làm mới','Auto refresh'],
  ['Đang kết nối','Connecting'],
  ['cập nhật báo hàng','shortage updates'],
  ['Google Sheet:','Google Sheet:'],
  ['đã đồng bộ','synced'],
  ['chờ','pending'],
  ['Nhân sự:','Staff:'],
  ['chưa đồng bộ','not synced'],
  ['Phản hồi server:','Server response:'],
  ['cần người nhận xử lý','waiting for a handler'],
  ['đang có người phụ trách','assigned to a handler'],
  ['Lượt báo 24 giờ','Reports · 24 hours'],
  ['Lượt báo thiếu 24 giờ','Shortage reports · 24 hours'],
  ['Đã xử lý 24 giờ','Completed · 24 hours'],
  ['có hàng','available'],
  ['bỏ qua','skipped'],
  ['cần ưu tiên','needs priority'],
  ['Nhân sự hoạt động','Active staff'],
  ['tài khoản','accounts'],
  ['SKU đang dùng','Active SKUs'],
  ['danh mục hiện hành','current catalog'],
  ['Dung lượng dữ liệu','Data storage'],
  ['gói miễn phí','free tier'],
  ['Đang diễn ra','In progress'],
  ['Không có yêu cầu báo thiếu đang chờ xử lý.','No shortage requests are waiting for handling.'],
  ['Không có đợt báo thiếu đang chờ xử lý.','No shortage requests are waiting for handling.'],
  ['Nhịp báo thiếu 24 giờ','24-hour shortage pattern'],
  ['Lượt báo theo giờ, cột đậm là giờ hiện tại','Reports by hour; the highlighted bar is the current hour'],
  ['Hiệu suất xử lý','Handling performance'],
  ['24 giờ gần nhất và thời gian xử lý 30 ngày','Last 24 hours and 30-day handling times'],
  ['Đồng bộ & dung lượng','Sync & storage'],
  ['Thông tin nền đang ảnh hưởng vận hành','Background services affecting operations'],
  ['Dung lượng Neon','Neon storage'],
  ['Đồng bộ nhân sự','Staff sync'],
  ['Google Sheet chờ xuất','Google Sheet export queue'],
  ['Thiết bị FCM hoạt động','Active FCM devices'],
  ['Tổng hợp báo thiếu, tốc độ xử lý, kết quả châm hàng và các SKU phát sinh nhiều.','Summary of shortages, handling speed, replenishment results, and frequently reported SKUs.'],
  ['Lượt báo thiếu · 30 ngày','Shortage reports · 30 days'],
  ['Lượt báo thiếu · 24 giờ','Shortage reports · 24 hours'],
  ['Đã có hàng · 24 giờ','Available · 24 hours'],
  ['đã tìm thấy / đã châm hàng','found / replenished'],
  ['Đã bỏ qua · 24 giờ','Skipped · 24 hours'],
  ['được phép tiếp tục công việc','allowed to continue work'],
  ['Đang cần xử lý','Needs action'],
  ['Chưa có dữ liệu.','No data available.'],
  ['Đã xử lý xong','Completed'],
  ['Đã có hàng / đã châm hàng','Available / replenished'],
  ['Đã cho phép bỏ qua','Skip allowed'],
  ['Tự cho phép bỏ qua do quá thời gian','Automatically skipped after timeout'],
  ['Chi tiết các đợt báo thiếu','Shortage request details'],
  ['Tối đa 500 đợt gần nhất','Up to 500 most recent requests'],
  ['Tối đa 500 yêu cầu gần nhất','Up to 500 most recent requests'],
  ['Người xử lý','Handler'],
  ['Phụ trách:','Assigned:'],
  ['Thao tác:','Handled by:'],
  ['Đồng bộ tự động','Auto sync'],
  ['Xử lý báo hàng','Shortage handling'],
  ['Đang xử lý là số hiện tại; lịch sử Có hàng/Bỏ qua/Thu hồi tính trong hôm nay.','In progress is the current count; Available/Skipped/Withdrawn history is for today.'],
  ['Đang xử lý = hiện tại · Có hàng/Bỏ qua/Thu hồi = hôm nay (giờ kho Việt Nam).','In progress = current · Available/Skipped/Withdrawn = today (warehouse local time).'],
  ['Picker thu hồi SKU','Picker withdrawals'],
  ['Đang cập nhật…','Updating…'],
  ['Đang báo lại có hàng…','Reporting item found…'],
  ['Xác nhận hiện đã có hàng?','Confirm that the item is now available?'],
  ['Xác nhận hiện đã tìm thấy hàng và báo lại cho người lấy hàng?','Confirm the item has been found and notify the picker?'],
  ['Xác nhận SKU','Confirm SKU'],
  ['đã có hàng/châm bù?','is available/replenished?'],
  ['Xác nhận không tìm thấy SKU','Confirm SKU was not found'],
  ['XÁC NHẬN LẦN 2','SECOND CONFIRMATION'],
  ['Xác nhận lần cuối:','Final confirmation:'],
  ['Lý do điều phối lại:','Reason for reassignment:'],
  ['Cần nhập lý do điều phối.','A reassignment reason is required.'],
  ['Lựa chọn không hợp lệ.','Invalid selection.'],
  ['Không có Người báo hàng đang hoạt động để điều phối.','No active shortage handler is available for reassignment.'],
  ['Nhập số thứ tự người nhận:','Enter the assignee number:'],
  ['Điều phối SKU','Reassign SKU'],
  ['Tiếp nhận báo thiếu','Accept shortage request'],
  ['Thời gian từ lúc người lấy hàng báo thiếu đến khi người xử lý nhận yêu cầu, kèm khoảng nhắc lại nếu chưa có người nhận.','Time from the picker reporting a shortage until a handler accepts it, plus the reminder interval while unassigned.'],
  ['Xử lý sau khi tiếp nhận','Handling after acceptance'],
  ['Thời gian theo dõi sau khi người xử lý đã nhận yêu cầu và đang tìm hoặc châm bổ sung hàng.','Target handling time after a handler accepts the request and searches for or replenishes stock.'],
  ['Tự động cho phép bỏ qua','Automatic skip permission'],
  ['Nếu bật, hệ thống tự cho phép bỏ qua SKU khi yêu cầu đã chờ quá thời gian quy định. Nếu tắt, chỉ người có quyền mới được cho phép bỏ qua.','When enabled, the system automatically allows skipping an SKU after the configured timeout. When disabled, only authorized users can allow a skip.'],
  ['Cảnh báo cho người lấy hàng','Picker alerts'],
  ['Khi có hàng hoặc được phép bỏ qua, cảnh báo sẽ nhắc lại tới khi người lấy hàng xác nhận.','When stock is available or a skip is allowed, the alert repeats until the picker acknowledges it.'],
  ['Mặc định 5 phút cho trường hợp SKU đã được cho phép bỏ qua nhưng sau đó tìm thấy hàng.','Default 5 minutes when an SKU was previously skipped and is later found.'],
  ['Áp dụng đồng bộ','Apply everywhere'],
  ['Thay đổi được phát realtime sang Web/App đang hoạt động.','Changes are sent in realtime to active Web/App clients.'],
  ['Lưu thời gian nghiệp vụ','Save operating times'],
  ['Đang lưu thời gian nghiệp vụ…','Saving operating times…'],
  ['Đã lưu thời gian nghiệp vụ và đồng bộ cấu hình.','Operating times saved and settings synchronized.'],
  ['Nhân sự & tài khoản','Staff & accounts'],
  ['Google Sheet là nguồn chính; tài khoản tạo thêm được quản lý riêng và không ghi ngược vào nguồn.','Google Sheet is the primary source; manually created accounts are managed separately and are not written back to the source.'],
  ['Danh sách tài khoản','Account list'],
  ['Tạo thêm','Manual'],
  ['Theo nguồn','Source managed'],
  ['Hoạt động','Active'],
  ['Đã xóa / ngừng','Deleted / inactive'],
  ['Thao tác','Actions'],
  ['Sửa','Edit'],
  ['Xóa','Delete'],
  ['Tìm','Search'],
  ['Tạo tài khoản','Create account'],
  ['Lưu thay đổi','Save changes'],
  ['Tài khoản hoạt động','Account active'],
  ['Mật khẩu mới ','New password '],
  ['Để trống nếu giữ nguyên','Leave blank to keep the current password'],
  ['Hạ tầng & chi phí','Infrastructure & cost'],
  ['Sức khỏe dịch vụ, dung lượng và hàng rào giữ mục tiêu vận hành 0 USD.','Service health, storage, and safeguards for the $0 operating target.'],
  ['CHI PHÍ DỰ KIẾN','EXPECTED COST'],
  ['Có chỉ số cần theo dõi','Some metrics require attention'],
  ['Đang trong mục tiêu','Within target'],
  ['Cập nhật báo hàng:','Shortage updates:'],
  ['TỰ LÀM MỚI/ĐANG KẾT NỐI','AUTO REFRESH/CONNECTING'],
  ['Dung lượng dữ liệu Neon','Neon data storage'],
  ['Log chẩn đoán đã ghi nhận','Registered diagnostic logs'],
  ['bản ghi','records'],
  ['Nhật ký web','Web logs'],
  ['lưu trực tiếp Google Drive','stored directly in Google Drive'],
  ['tự dọn sau','automatically removed after'],
  ['ngày','days'],
  ['Lịch sử nghiệp vụ','Business audit'],
  ['Chưa có lịch sử.','No audit history yet.'],
  ['Đang tải log…','Downloading log…'],
  ['Đang tải log web…','Downloading web log…'],
  ['Máy chủ không trả dữ liệu log.','The server returned no log data.'],
  ['Google Drive không trả dữ liệu log web.','Google Drive returned no web log data.'],
  ['Thiết bị & thông báo','Devices & notifications'],
  ['Báo cáo vận hành kho','Warehouse operations report'],
  ['Xuất Excel','Export Excel'],
  ['Đang tạo file Excel…','Creating Excel file…'],
  ['Không xuất được Excel:','Unable to export Excel:'],
  ['Báo thiếu','Shortage report'],
  ['Báo thiếu hàng','Report shortage'],
  ['Báo lúc','Reported at'],
  ['Thu hồi lúc','Withdrawn at'],
  ['THU HỒI BÁO THIẾU','WITHDRAW SHORTAGE REPORT'],
  ['Thu hồi báo thiếu SKU','Withdraw shortage report for SKU'],
  ['Chỉ có thể thu hồi trong 30 giây kể từ lúc báo.','A shortage report can only be withdrawn within 30 seconds.'],
  ['CẢNH BÁO BẮT BUỘC XÁC NHẬN','ACKNOWLEDGEMENT REQUIRED'],
  ['Trạng thái server','Server status'],
  ['ĐÃ HIỂU','ACKNOWLEDGE'],
  ['ĐÃ CÓ HÀNG','ITEM AVAILABLE'],
  ['ĐƯỢC PHÉP BỎ QUA','SKIP ALLOWED'],
  ['Vui lòng quay lại lấy hàng.','Please return to pick the item.'],
  ['Vui lòng quay lại vị trí lấy hàng và tiếp tục thao tác.','Please return to the picking location and continue.'],
  ['Bạn được phép bỏ qua SKU này và tiếp tục công việc.','You may skip this SKU and continue your work.'],
  ['trước đó đã được phép bỏ qua nhưng hiện đã tìm thấy hàng.','was previously allowed to be skipped but has now been found.'],
  ['Phiên đăng nhập không tồn tại.','No active login session.'],
  ['Phiên đăng nhập đã hết hạn.','The login session has expired.'],
  ['Phiên đăng nhập cần xác thực lại.','Please sign in again to verify the session.'],
  ['Không thể làm mới phiên đăng nhập.','Unable to refresh the login session.'],
  ['Tài khoản chưa có hồ sơ nhân sự.','This account has no staff profile.'],
  ['Sai mã nhân viên hoặc mật khẩu','Incorrect employee ID or password'],
  ['Phiên đăng nhập đã quá cũ. Vui lòng đăng xuất, đăng nhập lại rồi đổi mật khẩu.','The login session is too old. Sign out, sign in again, then change the password.'],
  ['Lỗi máy chủ','Server error'],
  ['quá thời gian phản hồi. Vui lòng thử lại.','timed out. Please try again.'],
  ['Làm mới phiên đăng nhập','Refresh login session'],
  ['Tải hồ sơ đăng nhập','Load login profile'],
  ['Xác thực đăng nhập','Authenticate login'],
  
]);

const REGEX = [
  [/\b(\d+) phút\b/g, '$1 min'],
  [/\b(\d+) giờ\b/g, '$1 h'],
  [/\b(\d+) lượt\b/g, '$1 reports'],
  [/\b(\d+) người\b/g, '$1 people'],
  [/\b(\d+) yêu cầu\b/g, '$1 requests'],
];

let language = (() => { try { return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'vi'; } catch { return 'vi'; } })();
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
  wrap.innerHTML = '<span>Ngôn ngữ</span><select aria-label="Ngôn ngữ giao diện"><option value="vi">Tiếng Việt Nam</option><option value="en">Tiếng Anh</option></select>';
  wrap.querySelector('select').value = language;
  wrap.querySelector('select').addEventListener('change', (event) => setLanguage(event.target.value));
  document.body.appendChild(wrap);
  if (language === 'en') translateTree(wrap);
}

export function setLanguage(next) {
  language = next === 'en' ? 'en' : 'vi';
  try { localStorage.setItem(STORAGE_KEY, language); } catch {}
  document.documentElement.lang = language === 'en' ? 'en' : 'vi';
  translateTree(document.body);
  ensureSwitcher();
  const select = document.querySelector('.bh-language-switcher select');
  if (select) select.value = language;
  window.dispatchEvent(new CustomEvent('bh:languagechange', { detail: { language } }));
}

let nativeAlert = globalThis.alert?.bind(globalThis);
let nativeConfirm = globalThis.confirm?.bind(globalThis);
let nativePrompt = globalThis.prompt?.bind(globalThis);
let dialogsWrapped = false;
const VIETNAMESE_MARKS = /[ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯàáâãèéêìíòóôõùúăđĩũơưẠ-ỹ]/;
const missingSeen = new Set();

function auditMissing(root = document.body) {
  if (language !== 'en' || !root) return;
  const seen = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (n.parentElement?.closest('.bh-language-switcher,script,style')) continue;
    const text = String(n.nodeValue || '').trim();
    if (text && VIETNAMESE_MARKS.test(text) && !seen.has(text) && !missingSeen.has(text) && missingSeen.size < 100) {
      seen.add(text);
      missingSeen.add(text);
      console.warn('i18n_missing', text.slice(0,240));
    }
  }
}

function wrapDialogs() {
  if (dialogsWrapped) return;
  dialogsWrapped = true;
  if (nativeAlert) globalThis.alert = (message) => nativeAlert(translateText(message));
  if (nativeConfirm) globalThis.confirm = (message) => nativeConfirm(translateText(message));
  if (nativePrompt) globalThis.prompt = (message, value) => nativePrompt(translateText(message), value);
}

globalThis.__BH_I18N__ = { t, translateText, getLanguage, getLocale, setLanguage };

export function installI18n() {
  document.documentElement.lang = language === 'en' ? 'en' : 'vi';
  wrapDialogs();
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
    if (language === 'en') queueMicrotask(() => auditMissing(document.body));
  });
  observer.observe(document.documentElement, { subtree:true, childList:true, characterData:true });
  if (language === 'en') setTimeout(() => auditMissing(document.body), 0);
}
