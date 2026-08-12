# Báo hàng 1291 — nghiệp vụ canonical

Cập nhật theo target được phê duyệt ngày **12/08/2026**. Source/database live vẫn là nguồn sự thật khi kiểm tra runtime; tài liệu này là contract nghiệp vụ để không hồi sinh logic legacy.

## Vai trò

Giữ nguyên enum database, chỉ chuẩn hóa nhãn hiển thị:

- `PICKER` — **Picker / Người lấy hàng**: quét/tìm SKU, báo thiếu, xem báo của mình, ACK kết quả. Không claim/skip/châm bù/cấu hình.
- `INVENT` — **Người báo hàng**: nhận issue và xử lý issue của mình. Không quản trị user/config/reassign.
- `ADMIN_INVENT` — **Admin Event**: quản trị vận hành, reassign, báo cáo, SKU, log, quản lý `INVENT/PICKER`, SLA vận hành. Không quản lý `ADMIN/ADMIN_INVENT`, retention/security/release/credential.
- `ADMIN` — **Admin hệ thống**: toàn quyền hệ thống nhưng không bypass audit và vẫn bảo vệ ADMIN duy nhất.

Tên legacy `INVENT_USER / INVENT_ADMIN` chỉ được chấp nhận ở lớp đọc/import tương thích cũ; không dùng làm enum mới.

## Ticket và lượt báo

- Mỗi SKU có tối đa **một issue đang hoạt động**.
- Mỗi lần Picker báo tạo một `issue_report` riêng và tăng `report_count`.
- Gửi lại cùng `client_request_id` không tạo lượt báo mới.
- Báo thêm vào issue đang hoạt động **không reset** `first_reported_at`/SLA.
- Báo sau khi episode cũ đã resolved tạo **issue mới** và `previous_issue_id` trỏ episode cũ; không reopen/mutate row cũ.
- Nếu issue mới phát sinh trong vòng 30 phút sau episode cũ resolved, UI có thể gắn nhãn `Tái phát ≤30 phút`.
- Mọi mutation có thể replay phải idempotent; exclusive mutation phải được server/transaction quyết định.

## State machine canonical

Người vận hành chỉ cần hiểu:

`OPEN → CLAIMED → AVAILABLE`

hoặc:

`OPEN/CLAIMED → SKIP_ALLOWED`

và `SKIP_ALLOWED → AVAILABLE` nếu sau đó tìm thấy/châm bù.

`CLOSED` chỉ dùng cho archive/quản trị/audit.

`SEARCHING / REPLENISHING` còn trong enum để đọc dữ liệu cũ nhưng không là bước bắt buộc trong UI mới.

### Claim

- Claim thắng/thua được quyết định trong một transaction.
- Claim thành công phải đồng thời chuyển `OPEN → CLAIMED`, ghi `claimed_by`, `claimed_at`, tăng `issue_version`.
- Không role nào được claim đè im lặng issue đang thuộc người khác.
- `ADMIN_INVENT / ADMIN` muốn đổi người xử lý phải dùng `REASSIGN`, chọn người nhận mới, nhập lý do, ghi audit người cũ/người mới/lý do/thời gian và gửi thông báo liên quan.

### SKIP

- **Không auto-SKIP.**
- Hết SLA chỉ nhắc/escalate.
- `INVENT` chỉ cho SKIP issue của mình; `ADMIN_INVENT / ADMIN` có thể xử lý trực tiếp theo quyền server.
- UI SKIP dùng xác nhận hai bước vì ảnh hưởng Picker/WMS.

## Notification, Realtime và ACK

- Database là authority. FCM/Realtime chỉ báo delta; client phải đối chiếu `issue_version/status` trước khi coi notification là trạng thái hiện hành.
- Foreground ưu tiên private Realtime Broadcast; polling chỉ fallback.
- Background/urgent dùng FCM high priority có TTL/collapse phù hợp.
- FCM server accept không đồng nghĩa thiết bị đã nhận; theo dõi riêng `fcm_accepted_at`, `client_received_at`, `displayed_at`, `acknowledged_at`.
- `AVAILABLE / SKIP_ALLOWED` critical phải ACK theo đúng target user + notification event + issue version.
- Token FCM `UNREGISTERED/NotRegistered` phải bị deactivate.

## Offline Android

- Chỉ Picker được tạo mutation offline durable cho `report-shortage` và ACK cần replay.
- UI offline phải ghi rõ **ĐÃ LƯU TRÊN MÁY • CHỜ ĐỒNG BỘ**; không nói đã gửi server.
- Outbox `PENDING/ERROR/BLOCKED/CONFLICT` không bị xóa theo tuổi.
- Replay dùng cùng request ID.
- Claim/update/reassign không được phép offline.
- Không dùng Foreground Service thường trực và không heartbeat nền.
- WorkManager là **unique one-shot** khi có outbox/network; catalog sync theo freshness, không full-sync chu kỳ 15 phút.

## Inventory / Tồn Bin

Đường mục tiêu:

`Website/Cron → Supabase Edge Function → Supra API → staging → atomic finalize → inventory_current`

Không phụ thuộc EXE/Excel/laptop chạy nền cho đường thường ngày. XLSX chỉ là recovery fallback có kiểm soát và phải dùng cùng staging/finalize contract.

### Snapshot

- Snapshot mới chỉ trở thành hiện hành sau finalize nguyên tử: validate required field/count/hash/duplicate/numeric → tạo immutable snapshot → projection `inventory_current` → audit/broadcast → commit.
- Bất kỳ lỗi nào đều giữ snapshot hiện hành cũ; tuyệt đối không đổi lỗi/stale/unknown thành tồn `0`.
- `available_qty = max(bin_qty - pending_out_qty, 0)` theo row; projection pickable chỉ tính storage type `Pickable / Có thể lấy hàng`.
- Freshness mặc định: `FRESH ≤10 phút`, `AGING >10–30 phút`, `STALE >30 phút`.
- Picker chỉ thấy trạng thái + thời gian snapshot; `INVENT / ADMIN_INVENT / ADMIN` mới thấy số tồn chi tiết.
- Snapshot tồn không được dùng để chặn Picker báo thiếu; nếu snapshot còn tồn mà Picker báo thiếu thì đó là physical mismatch cần điều tra.

### Đồng bộ Supra

- Chỉ server giữ/mã hóa credential; browser/APK/repo/log/Google Sheet/FCM không chứa raw credential.
- Chỉ Admin cập nhật credential; Admin Event chỉ thấy status và chạy/retry job.
- Chỉ một active job/site/source; duplicate `client_request_id` không tạo job khác.
- Worker phải checkpoint/lease/resume; không publish partial.
- Cùng hash với snapshot hiện hành → `NO_CHANGE`.
- Auth/schema error không retry mù.
- **Không kích hoạt production JSON sync trước read-only POC** xác minh field contract, pagination, parity với export và network egress. Khi chưa verified, endpoint phải fail-closed.

## Website

- Mutation chỉ online; không dùng browser storage làm durable outbox trên thiết bị dùng chung.
- Tách tab/action theo role; server vẫn từ chối API vượt quyền dù client gọi thủ công.
- Private Realtime Broadcast khi tab visible; dừng khi tab hidden; polling 30 giây chỉ fallback.
- ExcelJS lazy-load riêng ở import.
- Không để service-role key, signing key, Supra credential hay stack trace nhạy cảm vào static bundle.

## Google Sheet

- Google Sheet là báo cáo/đối soát, không nằm trên đường quyết định realtime.
- Database giữ snapshot tồn đầy đủ; Sheet chỉ cần event/ticket, metadata snapshot và summary/anomaly cần thiết.
- Lỗi Sheet không rollback ticket/snapshot đã commit; queue giữ pending để retry.

## Retention và audit

- Không hard-delete nghiệp vụ tùy tiện.
- ADMIN duy nhất không thể bị hạ quyền/vô hiệu hóa qua import/update thông thường.
- Audit phải giữ actor/action/from/to/reason/version đủ để truy vết.
- Retention được cấu hình server; log credential/secret/private key bị cấm tuyệt đối.
