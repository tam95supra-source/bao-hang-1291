# Google Apps Script worker — Báo hàng 1291

Worker production sử dụng Neon + Firebase + Google services.

- Neon giữ dữ liệu nghiệp vụ và worker outbox.
- Firebase Auth/FCM/Firestore phục vụ identity, push và realtime delta.
- Apps Script ghi Google Sheet, đồng bộ nhân sự, Drive diagnostic log và chạy worker tick.
- Secret nằm trong Script Properties, không nằm trong source.
- Giữ nguyên Web App deployment hiện hành để URL worker không đổi.

Source canonical: `DEPLOY_NEON.gs`.
