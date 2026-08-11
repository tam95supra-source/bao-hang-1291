-- Tài khoản đầu tiên được tạo qua scripts/bootstrap_admin.sh sau khi đặt BOOTSTRAP_SECRET.
-- Không đưa mã nhân viên, mật khẩu hoặc khóa dịch vụ thật vào git.

insert into public.app_config(
  singleton, acknowledge_minutes, reminder_minutes, skip_minutes, replenish_minutes, retention_days
) values (true, 15, 5, 30, 15, 60)
on conflict (singleton) do update set
  acknowledge_minutes=excluded.acknowledge_minutes,
  reminder_minutes=excluded.reminder_minutes,
  skip_minutes=excluded.skip_minutes,
  replenish_minutes=excluded.replenish_minutes,
  retention_days=excluded.retention_days;
