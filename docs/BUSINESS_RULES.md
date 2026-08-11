# Nghiệp vụ đã chốt

## Vai trò

- `PICKER`: báo SKU, xem lịch sử của chính mình, nhận overlay trạng thái.
- `INVENT_USER`: nhận/claim ticket và cập nhật tiến trình.
- `INVENT_ADMIN`: toàn quyền Invent, import danh mục, cấu hình SLA, user và version.

## Ticket và lượt báo

- Mỗi SKU chỉ có tối đa một ticket đang hoạt động.
- Mỗi lần Picker báo luôn sinh một `report` riêng.
- SLA tính từ `first_reported_at` của ticket, không reset khi Picker khác báo.
- Ticket đã `AVAILABLE` mà bị báo lại trong 30 phút sẽ mở lại thành `OPEN`, tăng `reopen_count` và ping toàn nhóm.

## Trạng thái

`OPEN → CLAIMED → SEARCHING → REPLENISHING → AVAILABLE`

Nhánh `OPEN/CLAIMED/SEARCHING/REPLENISHING → SKIP_ALLOWED` khi Invent chọn không thấy hàng hoặc SLA toàn cục hết hạn.

`SKIP_ALLOWED` là trạng thái được ghi cố định để đối soát báo cáo skip của WMS.

## Overlay

- Trạng thái thông thường: chạm vùng trống để đóng.
- `AVAILABLE`, `SKIP_ALLOWED`: chỉ đóng sau nút `ĐÃ HIỂU`.
- Backend ghi `sent_at` và `acknowledged_at` theo user đích.

## Dữ liệu

- SKU import theo `SKU` + `Tên sản phẩm`, gộp dòng trùng.
- Import SKU là upsert/cộng dồn; SKU vắng mặt không bị xóa.
- User import theo mã nhân viên; user vắng mặt không bị xóa.
- Mật khẩu chỉ dùng khi tạo user mới, không lưu trong báo cáo/Google Sheet.
- Dữ liệu vận hành giữ 60 ngày rồi cleanup.
