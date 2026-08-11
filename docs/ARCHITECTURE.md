# Kiến trúc

## Thành phần

1. Android APK: Kotlin/XML, SQLite, FCM, WorkManager và overlay service.
2. Supabase: Auth, Postgres, RLS, Edge Function API, `pg_cron` và `pg_net`.
3. Firebase: FCM HTTP v1.
4. Google Apps Script: ghi báo cáo theo lô lên Google Sheet.
5. GitHub Actions: build/test/sign/release APK và deploy backend; workflow SLA chỉ là dự phòng thủ công.

## Luồng báo SKU

1. App gửi `client_request_id` duy nhất; khi offline sẽ giữ nguyên ID trong outbox.
2. Backend upsert ticket hoạt động theo SKU trong transaction.
3. Backend thêm lượt báo Picker.
4. Backend gửi FCM tới toàn bộ Invent đang hoạt động.
5. Invent đầu tiên claim ticket bằng RPC atomic.
6. Mọi thay đổi sinh audit log và hàng đợi Google Sheet.
7. Backend gửi FCM data message ưu tiên cao; app tự tạo notification và overlay.

## Chống trùng và sai thứ tự

- `client_request_id` unique chống gửi lại sau lỗi mạng/timeout.
- Ticket active có unique partial index theo SKU.
- Thời gian quyết định dùng server time.
- Push chỉ là tín hiệu; database là nguồn sự thật.

## Độ trễ và giới hạn Android

- PDA Android 9–11 là thiết bị Picker mục tiêu chính cho overlay.
- FCM dùng data message ưu tiên cao; WorkManager bù đồng bộ nền.
- Android có thể trì hoãn tiến trình nền nếu firmware ép tiết kiệm pin. Khi triển khai phải cấp overlay, thông báo và tắt tối ưu pin cho app.
- Nếu overlay bị thu hồi quyền, thông báo mức ưu tiên cao vẫn là kênh dự phòng.

## Bảo mật public source

- Không commit dữ liệu vận hành, service role, Firebase service account, mật khẩu hoặc keystore.
- Client chỉ có Supabase anon key; RLS bắt buộc.
- Role lấy từ profile server-side.
- Admin mutation qua Edge Function, không cho client tự sửa role.
- Mật khẩu do Supabase Auth quản lý; file import chỉ chuyển mật khẩu khởi tạo qua HTTPS và không ghi vào bảng/Sheet.
