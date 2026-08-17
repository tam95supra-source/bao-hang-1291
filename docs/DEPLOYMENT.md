# Triển khai production

## Scope cố định

- Repo: `tam95supra-source/bao-hang-1291`
- Neon project: `tiny-boat-19315489`
- Neon production branch: `br-broad-resonance-aznwrpea`
- Firebase project: `bao-hang-1291`
- Android package: `vn.pickpack1291.baohang`
- Hosting: `bao-hang-1291.web.app`

## Vận hành

- Apps Script worker gọi Neon worker RPC để xử lý SLA, notification, realtime, Sheet queue, cleanup và staff sync.
- Google Sheet là báo cáo/đối soát; Neon quyết định trạng thái nghiệp vụ.
- Firestore/FCM chỉ truyền delta.
- Không bật billing; dừng trước khi có nguy cơ phát sinh phí.

## Secret

Firebase service account, Apps Script webhook secret, database credential và Android signing material không được commit vào repo/public artifact.
