# Triển khai

## Quyền trên thiết bị

- Cho phép thông báo.
- Cho phép hiển thị trên ứng dụng khác.
- Cho phép cài ứng dụng từ nguồn này để tự cập nhật.
- Tắt tối ưu pin cho ứng dụng nếu firmware PDA giới hạn FCM.

## GitHub Secrets

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_DB_PASSWORD`
- `FIREBASE_APP_ID`, `FIREBASE_SENDER_ID`, `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`
- `FIREBASE_SERVICE_ACCOUNT`
- `GOOGLE_SHEET_WEBHOOK_URL`, `GOOGLE_SHEET_WEBHOOK_SECRET`
- `BOOTSTRAP_SECRET`, `CRON_SECRET`
- `KEYSTORE_BASE64`
- `RELEASE_STORE_PASSWORD`
- `RELEASE_KEY_ALIAS`
- `RELEASE_KEY_PASSWORD`
- `UPDATE_MANIFEST_URL` = `https://github.com/OWNER/REPO/releases/latest/download/release-manifest.json`

## Thứ tự triển khai

1. Tạo Supabase Free project và Firebase project, không bật billing.
2. Tạo Android app Firebase với package `vn.pickpack1291.baohang`.
3. Tạo Google Sheet/Apps Script theo `google-apps-script/README.md`.
4. Điền GitHub Secrets và chạy workflow `Deploy Supabase backend`.
5. Gọi `api/bootstrap-admin` một lần với `BOOTSTRAP_SECRET`; endpoint tự khóa khi đã có profile.
6. Đăng nhập Admin, import file SKU và file nhân sự mẫu.
7. Chạy workflow release; cài APK và hoàn tất quyền trên từng thiết bị.

## Vận hành

- Supabase `pg_cron` gọi SLA 5 phút/lần và cleanup hằng ngày; workflow deploy tự cấu hình Vault/job. Mốc SLA nên là bội số của 5 phút.
- Google Sheet nhận event theo lô tối đa 500 dòng; nếu lỗi, queue giữ lại và lần sau gửi tiếp.
- Hàng ngày chỉ upsert `SKU` + `Tên sản phẩm`; không xóa SKU vắng mặt trong file tồn.
- Dữ liệu đã đóng quá 60 ngày được `purge_old_data` dọn tự động hằng ngày.

Không bật billing. Nếu dịch vụ yêu cầu gói trả phí, dừng triển khai và đánh giá quota trước.
