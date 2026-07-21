-- ════ マイグレーション⑪：案件（現場）に着工/完工予定日・地図ピンを追加 ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
-- 見積書なしで案件情報（工事場所・着工/完工予定日・地図ピン）を案件に保存できるようにする。

alter table public.projects add column if not exists start_date date;
alter table public.projects add column if not exists end_date date;
alter table public.projects add column if not exists map_lat double precision;
alter table public.projects add column if not exists map_lng double precision;
