from pathlib import Path

path = Path('supabase/functions/api/index.ts')
src = path.read_text(encoding='utf-8')

old = '    OPEN: `Báo thiếu • SKU ${issue.sku}`,\n'
new = '    OPEN: `CÓ SKU CẦN XỬ LÝ • SKU ${issue.sku}`,\n'
if src.count(old) != 1:
    raise SystemExit(f'OPEN title anchor count={src.count(old)}')
src = src.replace(old, new, 1)

old = '''      const issue = data.issue;
      const message = data.already_reported ? `SKU ${issue.sku} vừa có thêm lượt báo; tổng ${issue.report_count} lượt.` : `Picker ${context.profile.full_name} báo thiếu SKU ${issue.sku}.`;
      if (!data.duplicate_request) await notifyUsers(await inventUserIds(), issue, "OPEN", message);
      return context.effectiveRole === "PICKER" ? { ...data, issue: pickerIssue(issue) } : data;
'''
new = '''      const issue = data.issue;
      if (!data.duplicate_request && !data.already_reported) {
        const message = `Picker ${context.profile.full_name} vừa báo thiếu SKU ${issue.sku}. Chọn NHẬN XỬ LÝ nếu bạn tiếp nhận SKU này.`;
        await notifyUsers(await inventUserIds(), issue, "OPEN", message);
      }
      return context.effectiveRole === "PICKER" ? { ...data, issue: pickerIssue(issue) } : data;
'''
if src.count(old) != 1:
    raise SystemExit(f'report-shortage notify anchor count={src.count(old)}')
src = src.replace(old, new, 1)

if '!data.duplicate_request && !data.already_reported' not in src:
    raise SystemExit('first-only guard missing')
path.write_text(src, encoding='utf-8')
print('FIRST_OPEN_API_PATCH=PASS')
