-- ════ マイグレーション⑧：日報に作業種別を追加（新築のみ：木工事／上棟／墨付け刻み） ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）

alter table public.daily_reports add column if not exists work_kind text default '';
