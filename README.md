# Báo hàng 1291

Ứng dụng Android nội bộ hỗ trợ Picker báo SKU hết hàng và nhóm Invent nhận, tìm, châm hàng, phản hồi hoặc cho phép skip theo SLA cấu hình.

## Kiến trúc production

- **Neon PostgreSQL + Data API**: nguồn dữ liệu nghiệp vụ duy nhất.
- **Firebase Auth**: đăng nhập/identity; Firebase JWT được Neon RLS/RPC kiểm tra.
- **Firestore + FCM HTTP v1**: realtime delta và thông báo thiết bị.
- **Google Apps Script**: worker nền, Google Sheet, staff sync và Drive diagnostic log.
- **Firebase Hosting**: Web Admin tại `bao-hang-1291.web.app`.
- **GitHub Actions**: CI/CD, production signing và OTA.

Android production package: `vn.pickpack1291.baohang`.

Repo public: không commit dữ liệu vận hành, password, service-account private key, database credential hoặc signing key/keystore.

Xem [Kiến trúc](docs/ARCHITECTURE.md), [Nghiệp vụ](docs/BUSINESS_RULES.md) và [Triển khai](docs/DEPLOYMENT.md).
