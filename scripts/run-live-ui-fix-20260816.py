from pathlib import Path

path = Path(__file__).with_name('apply-live-ui-fix-20260816.py')
source = path.read_text(encoding='utf-8')
opening = '    """    fun searchSkus(query: String, limit: Int = 20): List<SkuItem> {\n'
closing = '    fun skuCount""",\n)\n\n# 6) Reduce Realtime authorization noise on Android'
if source.count(opening) != 1 or source.count(closing) != 1:
    raise RuntimeError('Could not repair guarded patch delimiters exactly once')
source = source.replace(opening, "    '''    fun searchSkus(query: String, limit: Int = 20): List<SkuItem> {\n", 1)
source = source.replace(closing, "    fun skuCount''',\n)\n\n# 6) Reduce Realtime authorization noise on Android", 1)
code = compile(source, str(path), 'exec')
namespace = {'__file__': str(path), '__name__': '__main__'}
exec(code, namespace, namespace)

root = Path(__file__).resolve().parents[1]
ops_path = root / 'web-admin/src/ops-console.js'
ops = ops_path.read_text(encoding='utf-8')
replacements = {
    "'Realtime' : document.body.dataset.ticketRealtime === 'fallback' ? 'Dự phòng' : 'Đang nối'": "'Trực tuyến' : document.body.dataset.ticketRealtime === 'fallback' ? 'Tự làm mới' : 'Đang kết nối'",
    '<b>${escapeHtml(realtime)}</b> ticket': '<b>${escapeHtml(realtime)}</b> cập nhật báo hàng',
    '${reports.last_24h?.issues || 0} ticket': '${reports.last_24h?.issues || 0} đợt báo thiếu',
    "metric('Database',": "metric('Dung lượng dữ liệu',",
    "${(db / dbLimit * 100).toFixed(1)}% free tier": "${(db / dbLimit * 100).toFixed(1)}% gói miễn phí",
    '${activeIssues.length} ticket đang mở hoặc đang xử lý': '${activeIssues.length} đợt đang chờ hoặc đang xử lý',
    'Không có ticket đang chờ xử lý.': 'Không có đợt báo thiếu đang chờ xử lý.',
    'Trung vị nhận xử lý': 'Một nửa đợt được nhận trong',
    'Trung vị hoàn tất': 'Một nửa đợt xử lý xong trong',
    'P95 hoàn tất': '95% xử lý xong trong',
    'Ticket tái phát': 'Đợt báo lại trong 30 phút',
    "progress('Database Supabase'": "progress('Dung lượng Supabase'",
    'nhận ticket': 'nhận đợt báo thiếu',
    'ticket đã được nhận': 'đợt báo thiếu đã được nhận',
    'không tự SKIP': 'không tự cho phép bỏ qua',
    'Xác nhận của Picker': 'Xác nhận của Người lấy hàng',
    'Picker phải xác nhận cảnh báo': 'Người lấy hàng phải xác nhận cảnh báo',
    'Ticket realtime:': 'Cập nhật báo hàng:',
    "? 'ONLINE' : 'DỰ PHÒNG/ĐANG NỐI'": "? 'TRỰC TUYẾN' : 'TỰ LÀM MỚI/ĐANG KẾT NỐI'",
    '<span>Project</span>': '<span>Mã dự án</span>',
    '<span>Region</span>': '<span>Khu vực máy chủ</span>',
    '<span>Ticket tổng</span>': '<span>Tổng đợt báo thiếu</span>',
    '<span>Ticket đang hoạt động</span>': '<span>Đợt đang xử lý</span>',
    "progress('Database',": "progress('Dung lượng dữ liệu',",
    'Hạn mức bảo vệ theo Free tier hiện hành': 'Hạn mức bảo vệ của gói miễn phí hiện hành',
    "metric('Realtime messages',": "metric('Lượt cập nhật thời gian thực',",
    'Cảnh báo SKIP cũ sẽ hết hiệu lực ngay.': 'Cảnh báo cho phép bỏ qua trước đó sẽ hết hiệu lực ngay.',
    'Picker đã báo SKU này nhận cảnh báo bắt buộc: <b>KHÔNG SKIP — ĐÃ CÓ HÀNG</b>.': 'Người lấy hàng đã báo SKU này nhận cảnh báo bắt buộc: <b>KHÔNG BỎ QUA — ĐÃ CÓ HÀNG</b>.',
    'Ticket tăng phiên trạng thái và ghi audit riêng; không tạo ticket mới và không xóa lịch sử SKIP.': 'Đợt báo tăng phiên trạng thái và ghi nhật ký riêng; không tạo đợt mới và không xóa lịch sử cho phép bỏ qua.',
}
for old, new in replacements.items():
    if old in ops:
        ops = ops.replace(old, new)
ops_path.write_text(ops, encoding='utf-8')

required = [
    'Một nửa đợt được nhận trong',
    'Một nửa đợt xử lý xong trong',
    '95% xử lý xong trong',
    'Đợt báo lại trong 30 phút',
    'KHÔNG BỎ QUA — ĐÃ CÓ HÀNG',
    'Cập nhật báo hàng:',
]
for value in required:
    if value not in ops:
        raise RuntimeError(f'ops-console wording postcondition missing: {value}')
print('WORDING_AUDIT_PATCH=PASS')
