-- ════ マイグレーション⑥：休日出勤に振替休日を追加 ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）

-- 休日出勤の代わりに取得する振替休日（任意）
alter table public.holiday_requests add column if not exists substitute_date date;
