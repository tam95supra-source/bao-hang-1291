# Google Apps Script worker — Báo hàng 1291

Worker production sử dụng Neon + Firebase + Google services.

- Neon giữ dữ liệu nghiệp vụ và worker outbox.
- Firebase Auth/FCM/Firestore phục vụ identity, push và realtime delta.
- Apps Script ghi Google Sheet, đồng bộ nhân sự, Drive diagnostic log và chạy worker tick.
- Secret nằm trong Script Properties, không nằm trong source.
- Giữ nguyên Web App deployment hiện hành để URL worker không đổi.

## Source production

- `DEPLOY_NEON.gs`: worker chính.
- `STAFF_EVENT_SYNC_V3.gs`: đồng bộ nhân sự theo sự kiện, chạy trong **cùng Apps Script project** với worker.
- Nguồn nhân sự thực tế là spreadsheet `DỮ LIỆU THEO NGÀY`, ID `1E7ZWz-4eMcBliQxDYBVoogIoeSYyiaXGwj0I6mbMm78`, tab `DANH SÁCH NHÂN SỰ`.
- Apps Script không cần nằm trong spreadsheet nguồn. `setupStaffEventSyncV3()` tạo installable `onEdit` + `onChange` trực tiếp lên spreadsheet nguồn bằng ID.
- Không polling nhân sự định kỳ. Thay đổi A/B/D/E/F được xử lý theo delta; đổi MNV, xóa/chen hàng và thay đổi cấu trúc dùng full reconcile có khóa và safety floor.
- Trigger V3 gọi worker realtime **sau khi thả script lock** để tránh tự khóa và trì hoãn publish.

Canonical bundle: `DEPLOY_NEON.gs` + `STAFF_EVENT_SYNC_V3.gs`.
