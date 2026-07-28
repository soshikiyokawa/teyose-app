-- ════ マイグレーション⑰：工程表のマイルストーン ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 工程表に節目の日付（確認済証発行日・着工日・配筋検査日…引渡日）を保存する。
-- 形式：{"着工日":"2026-08-01","上棟日":"2026-09-10", ...}

alter table public.schedules add column if not exists milestones jsonb not null default '{}'::jsonb;
