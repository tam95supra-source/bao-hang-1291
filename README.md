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

1. Fork/clone repository.
2. Cấu hình GitHub Secrets cho Supabase, Firebase và khóa ký APK.
3. Chạy workflow `Android CI` để lấy APK debug.
4. Chạy `Deploy Supabase backend`, bootstrap Admin đầu tiên và import hai file XLSX.
5. Chạy `Build signed APK release` để phát hành bản production.

Mã nguồn không chứa dữ liệu SKU/nhân sự thật, mật khẩu, service account hay keystore. APK phát hành kiểm tra SHA-256 trước khi mở trình cài đặt.

Xem [Kiến trúc](docs/ARCHITECTURE.md), [Nghiệp vụ](docs/BUSINESS_RULES.md) và [Triển khai](docs/DEPLOYMENT.md).
