# Secrets checklist

Không gửi secret qua chat/log và không commit secret vào repository public. Secret deploy/runtime server chỉ lưu trong secret store hợp lệ (GitHub Actions Secrets hoặc Apps Script Script Properties).

## Android client — cấu hình public

- `NEON_DATA_API`
- `FIREBASE_WEB_API_KEY`
- `UPDATE_MANIFEST_URL`
- Firebase client identifiers cần thiết cho APK.

Các giá trị client public không cấp quyền database. Quyền thật do Firebase Auth + Neon JWT/RLS/RPC kiểm soát.

## Backend/deploy — secret

- `FIREBASE_SERVICE_ACCOUNT`: JSON service account, chỉ lưu trong GitHub Actions Secrets.
- Apps Script Script Properties cho credential/worker secret bắt buộc.
- `GOOGLE_SHEET_WEBHOOK_URL` / `APPS_SCRIPT_WORKER_URL` theo workflow hiện hành.
- Secret bootstrap/worker nếu workflow hiện hành yêu cầu.

## Supabase

**HISTORICAL / SUPERSEDED.** Supabase đã bị loại khỏi runtime BÁO HÀNG 1291. Không tạo, kết nối hoặc cấu hình lại Supabase cho production hiện tại. Tài liệu migration cũ chỉ dùng để truy vết lịch sử.

## Ký APK

Production signing dùng permanent encrypted signing bundle hiện có trong repo cùng cơ chế unwrap bằng secret runtime; không commit keystore/plain password/private key.

Fingerprint certificate public được pin tại `signing/production-cert-sha256.txt`. Không thay signer khi chưa có release procedure riêng.
