const STORAGE_KEY = 'bao-hang-1291-language';

const EN = new Map([
  ["File log Web và thiết bị được lưu trực tiếp trong thư mục Google Drive của Báo hàng 1291. Hệ thống không lưu bản sao hoặc chỉ mục log mới trên Neon/service. Log tự động chỉ tạo khi có lỗi đáng chú ý và được gộp theo chu kỳ để tránh tạo quá nhiều file.","Web and device diagnostic files are stored directly in the Báo hàng 1291 Google Drive folder. The system stores no duplicate files or new log index on Neon/service. Automatic logs are created only for significant errors and are batched to avoid creating excessive files."],
  ["Được phép bỏ qua · 24 giờ","Skip allowed · 24 hours"],
  ["Copyright 2026 - SUPRA DC HƯNG YÊN - tamnv2 - Chuyên viên Pick Pack 1291","Copyright 2026 - SUPRA DC HUNG YEN - tamnv2 - Pick Pack Specialist 1291"],
  ["· API cũng bị hạ quyền tương ứng.","· API permissions are reduced accordingly."],
  ["Hiệu suất 24 giờ","24-hour performance"],
  ["Đợt báo thiếu:","Shortage requests:"],
  ["· Đã xử lý:","· Completed:"],
  ["Có hàng/châm bù:","Available/replenished:"],
  ["· Cho phép bỏ qua:","· Skip allowed:"],
  ["50% yêu cầu được tiếp nhận trong:","50% of requests accepted within:"],
  ["· 50% yêu cầu được xử lý xong trong:","· 50% of requests completed within:"],
  ["Nhân sự nguồn","Staff source"],
  ["Kiểm soát gói miễn phí","Free-tier controls"],
  ["Dung lượng dữ liệu:","Data storage:"],
  ["Không tự bật Billing hoặc dịch vụ trả phí.","Billing and paid services are never enabled automatically."],
  ["BÁO HÀNG","SHORTAGE HANDLING"],
  ["Không có SKU ở nhóm này.","No SKUs in this group."],
  ["BÁO LẠI TRONG 30 PHÚT","REPORTED AGAIN WITHIN 30 MINUTES"],
  ["NHẬN XỬ LÝ","ACCEPT"],
  ["CÓ HÀNG","ITEM AVAILABLE"],
  ["ĐIỀU PHỐI LẠI","REASSIGN"],
  ["LẤY HÀNG","PICKING"],
  ["Nhập hoặc quét mã SKU","Enter or scan an SKU"],
  ["Chưa chọn SKU","No SKU selected"],
  ["BÁO THIẾU","REPORT SHORTAGE"],
  ["Báo gần đây của tôi","My recent shortage reports"],
  ["Chưa có báo thiếu.","No shortage reports yet."],
  ["Lượt báo 30 ngày","Reports · 30 days"],
  ["Đợt báo thiếu 30 ngày","Shortage requests · 30 days"],
  ["Đang mở","Open"],
  ["24 giờ gần nhất","Last 24 hours"],
  ["Lượt báo:","Reports:"],
  ["· Đợt báo thiếu:","· Shortage requests:"],
  ["· Hoàn tất:","· Completed:"],
  ["Chất lượng xử lý","Handling quality"],
  ["50% yêu cầu được xử lý xong trong:","50% of requests completed within:"],
  ["· 95% yêu cầu được xử lý xong trong:","· 95% of requests completed within:"],
  ["Báo lại trong 30 phút:","Repeated within 30 minutes:"],
  ["· Tự cho phép bỏ qua 30 ngày:","· Auto skip permissions · 30 days:"],
  ["SKU phát sinh nhiều nhất","Most frequently reported SKUs"],
  ["DANH MỤC","CATALOG"],
  ["Danh mục này chỉ lưu","This catalog stores only"],
  ["mã SKU và tên hàng","SKU codes and item names"],
  ["; không lưu tồn kho, vị trí bin hoặc số lượng chờ xuất.","; inventory quantities, bin locations, and pending outbound quantities are not stored."],
  ["CẬP NHẬT TỪ FILE TỒN BIN","UPDATE FROM BIN INVENTORY FILE"],
  ["Tìm SKU hoặc tên hàng","Search by SKU or item name"],
  ["TÌM","SEARCH"],
  ["Nhập từ khóa để tra cứu.","Enter a keyword to search."],
  ["ĐỒNG BỘ NGUỒN NGAY","SYNC SOURCE NOW"],
  ["Nguồn DỮ LIỆU THEO NGÀY / DANH SÁCH NHÂN SỰ","Source: DAILY DATA / STAFF LIST"],
  ["Site 1291 / Kho HY1. Chuyên viên, Trưởng nhóm, Trưởng kho → Admin Event; còn lại → Picker. 6281280 được bảo vệ tuyệt đối. Nhân sự mất khỏi nguồn chỉ ngừng hoạt động, lịch sử vẫn giữ.","Site 1291 / HY1 warehouse. Specialists, Team Leaders, and Warehouse Managers → Shortage administrator; all others → Picker. Account 6281280 is protected. Staff removed from the source are deactivated while history is retained."],
  ["Vị trí","Position"],
  ["Quyền","Role"],
  ["Nguồn","Source"],
  ["Trạng thái","Status"],
  ["Tạo thêm tài khoản ngoài danh sách nguồn","Create an account outside the source list"],
  ["Nhà thầu","Contractor"],
  ["Mật khẩu riêng (không bắt buộc)","Custom password (optional)"],
  ["TẠO TÀI KHOẢN","CREATE ACCOUNT"],
  ["Đang tải…","Loading…"],
  ["Các file log thiết bị gần đây dùng để chẩn đoán lỗi. Trạng thái FCM accepted chỉ xác nhận Firebase đã nhận yêu cầu gửi; chỉ coi thiết bị đã nhận thông báo khi có client_received/ACK.","Recent device log files are used for diagnostics. FCM accepted only confirms that Firebase accepted the send request; delivery is confirmed only after client_received/ACK."],
  ["Phiên bản app","App version"],
  ["Thời gian","Time"],
  ["Chưa có log thiết bị gần đây.","No recent device logs."],
  ["SKU hoạt động","Active SKUs"],
  ["Thiết bị FCM","FCM devices"],
  ["Ngưỡng kiểm soát 0 đồng","$0 usage limits"],
  ["Storage: 1 GB · Egress: 5 GB/tháng · MAU: 50.000/tháng · Edge Functions: 500.000 lượt/tháng · Realtime: 2.000.000 message/tháng · 200 kết nối đồng thời · tối đa 2 project active.","Storage: 1 GB · Egress: 5 GB/month · MAU: 50,000/month · Edge Functions: 500,000 calls/month · Realtime: 2,000,000 messages/month · 200 concurrent connections · maximum 2 active projects."],
  ["Thông tin dùng để cảnh báo vận hành; hệ thống không tự bật Billing.","These values are operational safeguards; Billing is never enabled automatically."],
  ["Dữ liệu kỹ thuật","Technical data"],
  ["Log chẩn đoán: Google Drive (không lưu trên service)","Diagnostic logs: Google Drive (not stored on the service)"],
  ["Nút “Tạo file log đầy đủ” gom thông tin chẩn đoán của phiên Web hiện tại thành một file, lưu lên Google Drive và đồng thời tải file về máy.","“Create full log file” collects diagnostics for the current Web session into one file, stores it on Google Drive, and downloads it to this device."],
  ["THỜI GIAN","TIMING"],
  ["Cấu hình hệ thống","System settings"],
  ["Lưu lịch sử nghiệp vụ (ngày)","Operational history retention (days)"],
  ["Giữ ticket/audit theo chu kỳ, không phụ thuộc trạng thái nhân sự.","Retain shortage and audit history for the configured period, regardless of staff status."],
  ["Tự động đồng bộ DANH MỤC NHÂN SỰ","Automatically sync STAFF LIST"],
  ["Chu kỳ đồng bộ nhân sự (phút)","Staff sync interval (minutes)"],
  ["Khuyến nghị 60 phút để giảm network/quota.","60 minutes is recommended to reduce network and quota usage."],
  ["LƯU CẤU HÌNH","SAVE SETTINGS"],
  ["Mã nhân viên không hợp lệ.","Invalid employee ID."],
  ["Báo cáo vận hành","Operations report"],
  ["Báo 24 giờ","Reports · 24 hours"],
  ["CHƯA CÓ","NONE YET"],
  ["ĐANG XỬ LÝ","IN PROGRESS"],
  ["ĐÃ XỬ LÝ GẦN ĐÂY","RECENTLY COMPLETED"],
  ["PICKER THU HỒI SKU","PICKER WITHDRAWALS"],
  ["Được phép SKIP","Skip allowed"],
  ["Đang nhận xử lý…","Accepting request…"],
  ["Đang cập nhật trạng thái…","Updating status…"],
  ["Lựa chọn người nhận không hợp lệ.","Invalid assignee selection."],
  ["Lý do điều phối lại (bắt buộc):","Reassignment reason (required):"],
  ["Đang điều phối lại…","Reassigning…"],
  ["Đang thu hồi báo thiếu…","Withdrawing shortage report…"],
  ["Đang xác nhận…","Confirming…"],
  ["Chọn file XLSX trước.","Select an XLSX file first."],
  ["File vượt giới hạn 20 MB.","The file exceeds the 20 MB limit."],
  ["Đang đọc mã SKU và tên hàng…","Reading SKU codes and item names…"],
  ["File không có worksheet.","The file contains no worksheet."],
  ["mã sku","sku code"],
  ["tên sku","sku name"],
  ["tên sản phẩm","item name"],
  ["tên hàng","item name"],
  ["File phải có cột SKU và Tên SKU/Tên hàng.","The file must contain SKU and SKU Name/Item Name columns."],
  ["Chưa đồng bộ.","Not synced yet."],
  ["Ngừng","Inactive"],
  ["Admin Event chỉ được tạo thêm Picker.","A Shortage administrator can create Picker accounts only."],
  ["Admin hệ thống được tạo Admin Event, Người báo hàng hoặc Picker.","A System administrator can create Shortage administrator, Shortage handler, or Picker accounts."],
  ["Không tạo được tài khoản","Unable to create account"],
  ["Đã tạo tài khoản.","Account created."],
  ["Đang đồng bộ DANH SÁCH NHÂN SỰ…","Syncing STAFF LIST…"],
  ["Họ tên:","Full name:"],
  ["Quyền không hợp lệ.","Invalid role."],
  ["OK = tài khoản HOẠT ĐỘNG. Cancel = KHÓA tài khoản.","OK = ACTIVE account. Cancel = DISABLE account."],
  ["Mật khẩu mới (để trống nếu giữ nguyên):","New password (leave blank to keep the current password):"],
  ["Đang cập nhật nhân sự…","Updating staff…"],
  ["Tự động · khi có lỗi","Automatic · on errors"],
  ["Đã lưu cấu hình hệ thống.","System settings saved."],
  ["DỮ LIỆU THEO NGÀY · DANH SÁCH NHÂN SỰ","DAILY DATA · STAFF LIST"],
  ["Đang tải nhân sự…","Loading staff…"],
  ["DỮ LIỆU THEO NGÀY:","DAILY DATA:"],
  ["Đồng bộ nguồn:","Source sync:"],
  ["Thay đổi trong hệ thống:","System changes:"],
  ["· Tạo thêm:","· Manual:"],
  ["Nguồn danh sách nhân sự","Staff-list source"],
  ["Chỉ thay nguồn sau khi hệ thống xác nhận Google Sheet có đúng cấu trúc 8 cột đang sử dụng. Lịch sử báo thiếu đã phát sinh vẫn được giữ nguyên.","The source can be changed only after the system validates the current 8-column Google Sheet structure. Existing shortage history is preserved."],
  ["ĐANG KIỂM TRA","CHECKING"],
  ["Tên tab","Sheet tab name"],
  ["Kiểm tra & thay nguồn","Validate & change source"],
  ["Chỉ tài khoản tạo thủ công mới được sửa hoặc xóa tại đây. Tài khoản lấy từ Google Sheet được quản lý theo dữ liệu nguồn.","Only manually created accounts can be edited or deleted here. Google Sheet accounts are managed by the source data."],
  ["Tạo tài khoản thủ công","Create manual account"],
  ["Nhập mã nhân viên, họ tên, quyền và mật khẩu. Tài khoản này không phụ thuộc danh sách Google Sheet.","Enter employee ID, full name, role, and password. This account is independent of the Google Sheet staff list."],
  ["Bảo vệ","Protected"],
  ["Không có tài khoản phù hợp.","No matching accounts."],
  ["Tài khoản sẽ ngừng đăng nhập và không thể tạo thao tác nghiệp vụ mới. Toàn bộ lịch sử báo thiếu và lịch sử thao tác đã có vẫn được giữ.","The account will no longer be able to sign in or create new operational actions. Existing shortage and audit history is preserved."],
  ["Đang tải cấu hình…","Loading settings…"],
  ["Đang kiểm tra dịch vụ…","Checking services…"],
  ["PostgreSQL nghiệp vụ + Data API; Firebase JWT được kiểm tra tại RLS/RPC","Operational PostgreSQL + Data API; Firebase JWT is validated by RLS/RPC"],
  ["Mã dự án","Project ID"],
  ["Nhánh chính","Primary branch"],
  ["Khu vực","Region"],
  ["Tổng đợt báo thiếu","Total shortage requests"],
  ["Đợt đang xử lý","Requests in progress"],
  ["Các giới hạn bảo vệ đang áp dụng trên hệ thống. Chỉ hiển thị mức sử dụng khi có số liệu đo thực tế.","Current system safeguards. Usage is shown only when measured telemetry is available."],
  ["Các chỉ số sử dụng được đọc từ Neon Production. Hạn mức nào không có số liệu đo trực tiếp sẽ không hiển thị thành mức “đã dùng”.","Usage metrics are read from Neon Production. Limits without direct telemetry are not shown as consumed."],
  ["FCM token hoạt động","Active FCM tokens"],
  ["Không tự bật","Never enabled automatically"],
  ["Chặn nếu Cloud Billing được bật","Blocked if Cloud Billing is enabled"],
  ["GitHub & phát hành","GitHub & releases"],
  ["Public source, CI/CD và OTA","Public source, CI/CD, and OTA"],
  ["Không dùng","Not used"],
  ["Chỉ chạy khi có yêu cầu Beta/Stable","Runs only for requested Beta/Stable releases"],
  ["Giới hạn bảo vệ mục tiêu $0","$0 operating safeguards"],
  ["Hệ thống ưu tiên giảm tải hoặc dừng tác vụ không thiết yếu trước khi có nguy cơ phát sinh chi phí.","The system reduces load or stops non-essential tasks before there is a risk of paid usage."],
  ["Production là backend nghiệp vụ. Database và compute được giữ trong giới hạn Free, không có cơ chế tự nâng gói.","Production is the operational backend. Database and compute stay within the Free limits and cannot auto-upgrade."],
  ["CI kiểm tra billingEnabled=false trước mỗi lần deploy Firebase Hosting.","CI verifies billingEnabled=false before every Firebase Hosting deployment."],
  ["Repo public dùng runner tiêu chuẩn; không dùng runner trả phí.","The public repository uses standard runners and no paid runners."],
  ["Worker nền xử lý SLA, FCM/Firestore, xuất Google Sheet và đồng bộ nhân sự. File log chẩn đoán được lưu trực tiếp trên Google Drive.","The background worker handles SLA, FCM/Firestore, Google Sheet export, and staff synchronization. Diagnostic log files are stored directly on Google Drive."],
  ["Dung lượng DB","Database storage"],
  ["SKU này trước đó đã được cho phép bỏ qua. Khi xác nhận đã tìm thấy hàng, trạng thái sẽ chuyển sang “Đã có hàng” và quyền bỏ qua trước đó hết hiệu lực.","This SKU was previously allowed to be skipped. After confirming the item is found, its status changes to “Available” and the previous skip permission is revoked."],
  ["Người lấy hàng đã báo SKU này sẽ nhận cảnh báo bắt buộc:","The picker who reported this SKU will receive a mandatory alert:"],
  ["ĐÃ CÓ HÀNG — QUAY LẠI LẤY HÀNG","ITEM AVAILABLE — RETURN TO PICK"],
  ["Người báo hàng và tài khoản quản trị nhận cập nhật trạng thái mới.","Shortage handlers and administrators receive the updated status."],
  ["Yêu cầu hiện tại được cập nhật trạng thái và ghi thêm lịch sử; không tạo yêu cầu mới và không xóa lịch sử cũ.","The current request is updated and a new history entry is added; no new request is created and previous history is retained."],
  ["Ghi chú","Note"],
  ["Xác nhận","Confirm"],
  ["Chưa có","None"],
  ["Trạng thái vận hành hiện tại.","Current operating status."],
  ["theo sự kiện","event-driven"],
  ["DỰ PHÒNG 60 PHÚT","60-MINUTE FALLBACK"],
  ["ĐANG DÙNG","IN USE"],
  ["CHƯA SẴN SÀNG","NOT READY"],
  ["Nguồn hiện tại vẫn hoạt động; chưa thể thay nguồn ở thời điểm này.","The current source remains active; it cannot be changed at this time."],
  ["Thay nguồn nhân sự sang Google Sheet/tab này?\\n\\nNhân sự không còn trong nguồn mới sẽ bị khóa và xóa hẳn nếu chưa từng phát sinh lịch sử. Lịch sử báo hàng cũ vẫn được giữ.","Change the staff source to this Google Sheet/tab?\\n\\nStaff missing from the new source will be disabled and permanently removed only if they have no history. Existing shortage history is preserved."],
  ["Đang kiểm tra cấu trúc và đồng bộ nguồn nhân sự…","Validating structure and synchronizing the staff source…"],
  ["Đang tạo tài khoản…","Creating account…"],
  ["Đã tạo tài khoản và phát đồng bộ realtime.","Account created and realtime synchronization sent."],
  ["Đã cập nhật tài khoản.","Account updated."],
  ["Xóa tài khoản tạo thêm","Delete manual account"],
  ["Xóa tài khoản","Delete account"],
  ["Đã xóa tài khoản; lịch sử được giữ nguyên.","Account deleted; history is preserved."],
  ["Các mốc thời gian được chia theo từng bước của quy trình xử lý báo thiếu.","Timing is grouped by each step of the shortage-handling workflow."],
  ["BẬT","ON"],
  ["Realtime nghiệp vụ","Operational realtime"],
  ["Xác nhận đã tìm thấy hàng","Confirm item found"],
  ["Đang cập nhật trạng thái và gửi cảnh báo…","Updating status and sending alerts…"],
  ["Không có yêu cầu báo thiếu đang xử lý.","No shortage requests are in progress."],
  ["Đồng bộ dữ liệu nguồn","Source data sync"],
  ["Đang tải yêu cầu báo thiếu…","Loading shortage requests…"],
  ["Người lấy hàng thu hồi","Picker withdrawals"],
  ["Đang tổng hợp báo cáo vận hành…","Compiling operations report…"],
  ["30 ngày","30 days"],
  ["Lượt báo thiếu","Shortage reports"],
  ["đang cần xử lý","need action"],
  ["$0 · Billing không tự bật","$0 · Billing never auto-enables"],
  ["Đã ghi nhận thu hồi yêu cầu báo thiếu.","Shortage withdrawal recorded."],
  ["Đã tìm thấy hàng sau khi cho phép bỏ qua","Item found after skip was allowed"],
  ["Phân loại theo trạng thái xử lý hiện tại.","Grouped by current handling status."],
  ["đang xử lý","in progress"],
  ["Tổng hợp các yêu cầu báo thiếu và kết quả xử lý.","Summary of shortage requests and handling results."],
  ["Báo hàng 1291","Báo hàng 1291"],
  ["Tổng hợp","Summary"],
  ["BÁO CÁO VẬN HÀNH KHO 1291","WAREHOUSE OPERATIONS REPORT 1291"],
  ["XỬ LÝ BÁO THIẾU","SHORTAGE HANDLING"],
  ["Đã tìm thấy hàng sau khi đã cho phép bỏ qua","Item found after skip was allowed"],
  ['VẬN HÀNH','OPERATIONS'],
  ['QUẢN LÝ','MANAGEMENT'],
  ['HẠ TẦNG','INFRASTRUCTURE'],
  ['THIẾT LẬP','SETTINGS'],
  ['Phiên bản ứng dụng','App versions'],
  ['Nhật ký hệ thống','System logs'],
  ['Quản trị hệ thống','System administrator'],
  ['Quản trị báo thiếu','Shortage administrator'],
  ['CHẨN ĐOÁN','DIAGNOSTICS'],
  ['Log Web','Web logs'],
  ['Lịch sử thao tác','Operational history'],
  ['Lưu trữ log chẩn đoán','Diagnostic log storage'],
  ['File log Web và thiết bị được lưu trực tiếp trong thư mục Google Drive của Báo hàng 1291, không lưu file hoặc metadata log mới trên service. Log tự động chỉ tạo khi có lỗi đáng chú ý và được gộp theo chu kỳ để tránh spam.','Web and device diagnostic files are stored directly in the Báo hàng 1291 Google Drive folder. New diagnostic files or metadata are not stored on the service. Automatic logs are created only for significant errors and are batched to avoid spam.'],
  ['Nút “Tạo file log đầy đủ” tạo một ảnh chụp chẩn đoán của phiên Web hiện tại, lưu lên Google Drive và tải file về máy.','“Create full log file” captures diagnostics for the current Web session, stores the file on Google Drive, and downloads it to this device.'],
  ['TẠO FILE LOG ĐẦY ĐỦ','CREATE FULL LOG FILE'],
  ['Đang tạo file log đầy đủ…','Creating full log file…'],
  ['Đã tạo file log đầy đủ:','Full log file created:'],
  ['Tạo thủ công','Manual'],
  ['Tự động khi có lỗi','Automatic on errors'],
  ['Chưa có file log Web.','No Web log files yet.'],
  ['Chưa có file log thiết bị.','No device log files yet.'],
  ['Chưa có lịch sử thao tác.','No operational history yet.'],
  ['Không đọc được log Web từ Google Drive.','Unable to read Web logs from Google Drive.'],
  ['Không đọc được log thiết bị từ Google Drive.','Unable to read device logs from Google Drive.'],
  ['Google Drive không trả dữ liệu log thiết bị.','Google Drive returned no device log data.'],
  ['Không rõ phiên bản','Unknown version'],
  ['Phản hồi dịch vụ không đúng định dạng. Vui lòng thử lại sau.','The service returned an invalid response. Please try again later.'],
  ['Dịch vụ Google trả phản hồi không đúng định dạng. Vui lòng thử lại sau.','Google returned an invalid response. Please try again later.'],
  ['Dịch vụ Google trả phản hồi không đúng định dạng. Không lưu nội dung lỗi HTML vào log.','Google returned an invalid response. HTML error content was not written to the log.'],
  ['Chưa cấu hình nơi lưu log Google Drive.','Google Drive log storage is not configured.'],
  ['Đang mất mạng nên chưa thể tạo file log.','You are offline, so the log file cannot be created yet.'],
  ['Cần đăng nhập trước khi tạo file log.','Sign in before creating a log file.'],
  ['Không thể lưu file log lên Google Drive.','Unable to save the log file to Google Drive.'],
  ['PHÁT HÀNH','RELEASE'],
  ['Cập nhật ứng dụng','App updates'],
  ['Bản Stable và Beta được tách kênh. Trước khi phát hành, hệ thống kiểm tra chữ ký và SHA của file APK.','Stable and Beta use separate release channels. Before publishing, the system verifies the APK signature and SHA.'],
  ['Web không chứa khóa ký ứng dụng. Chỉ bản đã qua kiểm tra phát hành mới được công bố.','The Web app contains no app-signing key. Only builds that pass release verification are published.'],
  ['Phiên bản đang sử dụng','Versions in use'],
  ['Dùng mục Thiết bị & thông báo và Nhật ký hệ thống để đối chiếu phiên bản app đang chạy thực tế. File build chỉ được coi là đã triển khai khi có bằng chứng runtime.','Use Devices & notifications and System logs to verify the app versions actually running. A build is considered deployed only when runtime evidence confirms it.'],
  ['Trạng thái dịch vụ, dung lượng và các giới hạn bảo vệ mục tiêu vận hành 0 USD.','Service status, storage usage, and safeguards for the $0 operating target.'],
  ['Cập nhật báo thiếu:','Shortage updates:'],
  ['Nhà cung cấp','Provider'],
  ['Log chẩn đoán','Diagnostic logs'],
  ['Google Drive · không lưu trên service','Google Drive · not stored on the service'],
  ['Giới hạn Neon Free & Data API','Neon Free & Data API limits'],
  ['Giới hạn dung lượng DB','Database storage limit'],
  ['Giới hạn compute','Compute limit'],
  ['Dự án','Project'],
  ['Chính sách Billing','Billing policy'],
  ['Chặn deploy','Deploy guard'],
  ['Chính sách runner','Runner policy'],
  ['Runner trả phí','Paid runner'],
  ['Phát hành','Release'],
  ['Sự kiện thông báo','Notification events'],
  ['Dữ liệu chờ ghi Google Sheet','Pending Google Sheet writes'],
  ['Phiên dữ liệu SKU','SKU data revision'],
  ['Log chẩn đoán: Google Drive','Diagnostic logs: Google Drive'],
  ['Tự động cho phép bỏ qua sau (phút)','Automatically allow skip after (minutes)'],
  ['BÁO HÀNG 1291','BÁO HÀNG 1291'],
  ['Web nghiệp vụ','Operations portal'],
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
  ['Nhật ký & kiểm tra','System logs'],
  ['Nhật ký','Logs'],
  ['Cấu hình','Settings'],
  ['Phiên bản','App versions'],
  ['Thời gian nghiệp vụ','Workflow timing'],
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
  ['Chờ nhận','Awaiting handler'],
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
  ['50% yêu cầu được tiếp nhận trong','50% of requests were accepted within'],
  ['50% yêu cầu được xử lý xong trong','50% of requests were completed within'],
  ['95% yêu cầu được tiếp nhận trong','95% of requests were accepted within'],
  ['95% yêu cầu được xử lý xong trong','95% of requests were completed within'],
  ['Yêu cầu báo lại trong 30 phút','Requests repeated within 30 minutes'],
  ['Yêu cầu đang cần xử lý','Requests needing action'],
  ['Quá thời gian tiếp nhận','Acceptance overdue'],
  ['Hiệu quả xử lý','Handling performance'],
  ['Kết quả 24 giờ gần nhất','Last 24 hours'],
  ['Chất lượng xử lý 30 ngày','30-day handling quality'],
  ['SKU phát sinh báo thiếu nhiều nhất','Most frequently reported SKUs'],
  ['Chi tiết các yêu cầu báo thiếu','Shortage request details'],
  ['Thời gian báo','Reported at'],
  ['Tên hàng','Product name'],
  ['Kết quả','Result'],
  ['Thời gian nhận','Acceptance time'],
  ['Thời gian xử lý','Handling time'],
  ['Báo lại trong 30 phút','Repeated within 30 minutes'],
  ['Có','Yes'],
  ['Không','No'],
  ['phút','min'],
  ['giờ','hours'],
  ['vừa xong','just now'],
  ['Thời gian tiếp nhận (phút)','Acceptance target (minutes)'],
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
  ['Tự động bỏ qua sau (phút)','Automatically allow skip after (minutes)'],
  ['Có thể tắt hoàn toàn.','Can be disabled completely.'],
  ['LƯU THỜI GIAN NGHIỆP VỤ','SAVE OPERATING TIMES'],
  ['Đã lưu thời gian nghiệp vụ.','Operating times saved.'],
  ['Nhật ký web','Web logs'],
  ['Log thiết bị','Device logs'],
  ['Lịch sử nghiệp vụ','Operational history'],
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
  ['Admin Event','Shortage administrator'],
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
  ['Tự cho phép bỏ qua do quá thời gian','Skip automatically allowed after timeout'],
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

const PHRASE_EN = new Map([
  ["Cập nhật ","Updated "],
  ["dự phòng mỗi ","fallback every "],
  ["Đã thay nguồn · ","Source changed · "],
  [" nhân sự · "," staff · "],
  [" có hàng"," available"],
  [" bỏ qua"," skip allowed"],
  ["Xác nhận lần cuối: cho phép bỏ qua SKU","Final confirmation: allow skip for SKU"],
  ["Cho phép bỏ qua SKU","Allow skip for SKU"],
  ["trước đó đã được bỏ qua. Xác nhận hiện đã có hàng?","was previously allowed to be skipped. Confirm the item is now available?"],
  ["đã có hàng?","is available?"],
  ["Không xuất được Excel:","Unable to export Excel:"],
  ["Không có SKU trong nhóm này.","No SKUs in this group."],
  ["Báo lại trong 30 phút","Repeated within 30 minutes"],
  ["cần ưu tiên","needs priority"],
  ["danh mục hiện hành","current catalog"],
  ["Chưa có dữ liệu","No data"],
  ["Đã đồng bộ","Synced"],
  ["Đã tạo file log đầy đủ:","Full log file created:"],
  ["tự dọn sau","auto-deleted after"],
  ["Dòng ","Row "],
  ["thiếu mã SKU hoặc tên hàng","is missing an SKU code or item name"],
  ["có nhiều tên hàng khác nhau","has conflicting item names"],
  ["Đã cập nhật ","Updated "],
  [" · phiên "," · revision "],
  ["Đồng bộ ","Sync "],
  ["tạo ","created "],
  ["cập nhật ","updated "],
  ["ngừng ","deactivated "],
  ["lỗi ","failed "],
  [" nhân sự hợp lệ"," eligible staff"],
  [" nhân sự"," staff"],
  [" chờ"," pending"],
  [" PHÚT"," MIN"],
  ["Đã chuyển sang ĐÃ CÓ HÀNG","changed to ITEM AVAILABLE"],
  ["Tự dọn sau","Auto-deleted after"],
  [" yêu cầu"," requests"],
  [" đợt báo thiếu"," shortage requests"],
  [" lượt báo thiếu"," shortage reports"],
  ['Báo thiếu SKU','Report shortage for SKU'],
  ['Thu hồi báo thiếu SKU','Withdraw shortage report for SKU'],
  ['Điều phối SKU','Reassign SKU'],
  ['Xác nhận SKU','Confirm SKU'],
  ['Lý do điều phối lại','Reassignment reason'],
  ['Nhập số thứ tự người nhận','Enter the assignee number'],
  ['Đã ghi nhận báo thiếu SKU','Shortage report recorded for SKU'],
  ['Đã thu hồi SKU','Shortage report withdrawn for SKU'],
  ['Đã chuyển sang ĐÃ CÓ HÀNG','changed to ITEM AVAILABLE'],
  ['Báo lúc','Reported at'],
  ['Thu hồi lúc','Withdrawn at'],
  ['Cập nhật lúc','Updated at'],
  ['Phụ trách:','Assigned:'],
  ['Thao tác:','Handled by:'],
  ['Người xử lý:','Handler:'],
  ['Nhà thầu:','Contractor:'],
  ['Lần gần nhất:','Last run:'],
  ['Google Sheet:','Google Sheet:'],
  ['Nhân sự:','Staff:'],
  ['Phản hồi server:','Server response:'],
  ['Cập nhật báo thiếu:','Shortage updates:'],
  ['Đang xử lý','In progress'],
  ['Đã có hàng','Available'],
  ['Đã bỏ qua','Skipped'],
  ['Đã thu hồi','Withdrawn'],
  ['Được phép bỏ qua','Skip allowed'],
  ['Đã tìm thấy hàng','Item found'],
  ['gói miễn phí','free tier'],
  ['mục đang chờ','pending items'],
  ['tài khoản','accounts'],
  ['đợt báo thiếu','shortage requests'],
  ['lượt báo thiếu','shortage reports'],
  ['lượt báo','reports'],
  ['nhân sự','staff'],
  ['người','people'],
  ['yêu cầu','requests'],
]);

const REGEX = [
  [/\b(\d+) đợt\b/g, '$1 requests'],
  [/\b(\d+) phút\b/g, '$1 min'],
  [/\b(\d+) giờ\b/g, '$1 h'],
  [/\b(\d+) lượt\b/g, '$1 reports'],
  [/\b(\d+) người\b/g, '$1 people'],
  [/\b(\d+) yêu cầu\b/g, '$1 requests'],
  [/\b(\d+) đợt báo thiếu\b/g, '$1 shortage requests'],
  [/\b(\d+) lượt báo thiếu\b/g, '$1 shortage reports'],
  [/\b(\d+) tài khoản\b/g, '$1 accounts'],
  [/\b(\d+) mục đang chờ\b/g, '$1 pending items'],
];

let language = (() => { try { return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'vi'; } catch { return 'vi'; } })();
const textOriginal = new WeakMap();
const attrOriginal = new WeakMap();
const selfChanged = new WeakSet();
let observer;

export function getLanguage() { return language; }
export function getLocale() { return language === 'en' ? 'en-US' : 'vi-VN'; }

export function translateText(value) {
  const source = String(value ?? '');
  if (language !== 'en' || !source.trim()) return source;
  const leading = source.match(/^\s*/)?.[0] || '';
  const trailing = source.match(/\s*$/)?.[0] || '';
  const core = source.trim();
  if (EN.has(core)) return leading + EN.get(core) + trailing;
  let out = core;
  const phrases = [...PHRASE_EN.entries()].sort((a,b) => b[0].length - a[0].length);
  for (const [vi,en] of phrases) out = out.split(vi).join(en);
  for (const [re,repl] of REGEX) out = out.replace(re,repl);
  return leading + out + trailing;
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

function updateSwitcherLabels() {
  const wrap = document.querySelector('.bh-language-switcher');
  if (!wrap) return;
  const english = language === 'en';
  const label = wrap.querySelector('span');
  const select = wrap.querySelector('select');
  if (label) label.textContent = english ? 'Language' : 'Ngôn ngữ';
  if (select) {
    select.setAttribute('aria-label', english ? 'Interface language' : 'Ngôn ngữ giao diện');
    const vi = select.querySelector('option[value="vi"]');
    const en = select.querySelector('option[value="en"]');
    if (vi) vi.textContent = english ? 'Vietnamese' : 'Tiếng Việt Nam';
    if (en) en.textContent = english ? 'English' : 'Tiếng Anh';
    select.value = language;
  }
}

function ensureSwitcher() {
  if (!document.body) return;
  let wrap = document.querySelector('.bh-language-switcher');
  if (!wrap) {
    wrap = document.createElement('label');
    wrap.className = 'bh-language-switcher';
    wrap.innerHTML = '<span></span><select><option value="vi"></option><option value="en"></option></select>';
    wrap.querySelector('select').addEventListener('change', (event) => setLanguage(event.target.value));
    document.body.appendChild(wrap);
  }
  updateSwitcherLabels();
}

export function setLanguage(next) {
  language = next === 'en' ? 'en' : 'vi';
  missingSeen.clear();
  try { localStorage.setItem(STORAGE_KEY, language); } catch {}
  document.documentElement.lang = language === 'en' ? 'en' : 'vi';
  translateTree(document.body);
  ensureSwitcher();
  updateSwitcherLabels();
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
      // Keep missing translations available to the manual diagnostic snapshot without spamming console/log files.
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

globalThis.__BH_I18N__ = { t, translateText, getLanguage, getLocale, setLanguage, getMissingTranslations: () => [...missingSeen] };

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
