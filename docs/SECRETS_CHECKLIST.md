# Secrets checklist

Không gửi secret qua chat và không commit vào repository. Điền trực tiếp trong GitHub **Settings → Secrets and variables → Actions**.

## Android client

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- `FIREBASE_APP_ID`, `FIREBASE_SENDER_ID`, `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`
- `UPDATE_MANIFEST_URL`

Anon key và Firebase client config được đóng gói trong APK theo thiết kế; quyền thật vẫn do RLS/API server kiểm soát.

## Backend/deploy

- `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`
- `FIREBASE_SERVICE_ACCOUNT`: toàn bộ JSON service account, chỉ lưu GitHub/Supabase secret
- `BOOTSTRAP_SECRET`, `CRON_SECRET`: hai chuỗi ngẫu nhiên khác nhau, tối thiểu 32 byte
- `GOOGLE_SHEET_WEBHOOK_URL`, `GOOGLE_SHEET_WEBHOOK_SECRET`

## Ký APK

- `KEYSTORE_BASE64`
- `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`

Keystore production chỉ tạo một lần và phải có bản sao lưu ngoại tuyến. Mất keystore sẽ không thể cài bản cập nhật đè lên APK cũ.
