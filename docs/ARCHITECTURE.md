# Kiến trúc production — Báo hàng 1291

## Thành phần

1. Android APK: Kotlin/XML, local cache/outbox, FCM, WorkManager và overlay service.
2. Neon: PostgreSQL nghiệp vụ, RLS/RPC và Data API; authority duy nhất cho dữ liệu vận hành.
3. Firebase: Auth, Firestore realtime control-plane, FCM HTTP v1 và Hosting Web.
4. Google Apps Script: worker nền, ghi Google Sheet, staff sync và Drive diagnostic log.
5. GitHub Actions: test/build/sign/release APK, deploy Web và quality/security guard.

## Luồng báo SKU

1. App lấy Firebase ID token và gửi mutation tới Neon Data API/RPC với `client_request_id` duy nhất.
2. Neon xử lý ticket/lượt báo trong transaction và ghi audit/outbox.
3. Apps Script worker đọc worker RPC trên Neon, phát FCM/Firestore và ghi Google Sheet.
4. Web theo dõi Firestore realtime; Android nhận FCM realtime delta rồi đối chiếu trạng thái với Neon.
5. Neon là authority; FCM/Firestore chỉ là tín hiệu delta.

## Bảo mật public source

- Client không có database password/service credential.
- Firebase JWT + Neon RLS/RPC quyết định quyền truy cập.
- Server secret chỉ nằm trong secret store/Apps Script Script Properties.
- Firebase Auth quản lý credential người dùng; Google Sheet không lưu mật khẩu.
