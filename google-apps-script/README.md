# Google Sheet báo cáo

Google Sheet chỉ là bản báo cáo; Supabase là nguồn dữ liệu vận hành để tránh lỗi đồng thời.

1. Tạo một Google Sheet trống và mở **Extensions → Apps Script**.
2. Dán `Code.gs`, chạy `setupBaoHang1291()` một lần và cấp quyền.
3. Trong **Project Settings → Script properties**, tạo `WEBHOOK_SECRET` bằng chuỗi ngẫu nhiên dài.
4. **Deploy → New deployment → Web app**; Execute as **Me**, access **Anyone**.
5. Lưu URL triển khai và secret vào Supabase secrets `GOOGLE_SHEET_WEBHOOK_URL` và `GOOGLE_SHEET_WEBHOOK_SECRET`.

Không đưa URL/secret vào mã nguồn công khai. Cột mật khẩu không bao giờ được gửi sang Sheet.
