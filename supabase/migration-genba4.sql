-- ════ マイグレーション④：残業の承認者を申請時に1人指定する方式に変更 ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）

-- 申請時に選んだ承認者の表示名。通知・リマインドはこの1人にだけ送られる
alter table public.daily_reports add column if not exists ot_approver_name text default '';
