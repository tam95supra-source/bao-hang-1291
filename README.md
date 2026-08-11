# Báo hàng 1291

Ứng dụng Android nội bộ hỗ trợ Picker báo SKU hết hàng và nhóm Invent nhận, tìm, châm hàng, phản hồi hoặc cho phép skip theo SLA cấu hình.

## Phạm vi V1

- Android 9–15, tối ưu Newland NLS‑MT90 và điện thoại phổ thông.
- Một site, một nhóm Invent; người đầu tiên nhận ticket sẽ phụ trách.
- Một sự cố đang mở cho mỗi SKU; nhiều lượt báo Picker không reset SLA.
- Overlay phủ 35–40% màn hình, không phụ thuộc thanh thông báo.
- `ĐÃ CÓ HÀNG` và `ĐƯỢC SKIP` bắt buộc Picker xác nhận.
- Danh mục SKU nhập XLSX hằng ngày, cộng dồn theo SKU.
- Danh mục nhân sự nhập XLSX, mật khẩu ở từng dòng cho user mới.
- Supabase là nguồn dữ liệu chính; Google Sheet chỉ là báo cáo/đối soát.
- Firebase Cloud Messaging gửi push; GitHub Actions build APK.

## Build nhanh

GitHub Actions là pipeline build chuẩn vì dự án không yêu cầu máy người vận hành cài Android Studio.

1. Workflow `Android CI` chạy unit test và build APK debug trên standard `ubuntu-latest`.
2. Supabase URL và publishable client key được cấu hình trực tiếp trong Android source vì đây là thông tin public-client; quyền dữ liệu vẫn do Auth/RLS/API kiểm soát.
3. Firebase client config được bổ sung sau khi tạo Firebase Android app đúng package `vn.pickpack1291.baohang`.
4. Khóa backend, service account và khóa ký APK không được commit vào source; chúng chỉ được cấu hình qua secret store ở bước production.
5. Signed release/OTA chỉ được bật sau khi keystore và các secret production đã được bootstrap an toàn.

Mã nguồn không chứa dữ liệu SKU/nhân sự thật, mật khẩu, service account, backend secret hay keystore. APK phát hành kiểm tra SHA-256 trước khi mở trình cài đặt.

Xem [Kiến trúc](docs/ARCHITECTURE.md), [Nghiệp vụ](docs/BUSINESS_RULES.md) và [Triển khai](docs/DEPLOYMENT.md).
