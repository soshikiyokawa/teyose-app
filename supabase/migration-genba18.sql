-- ════ マイグレーション⑱：案件に契約済み駐車場を追加 ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 契約済み駐車場の住所・地図ピン。区画図などの資料は drawings テーブルに
-- kind='parking' として保存する（工事の図面とは別枠で表示）。

alter table public.projects add column if not exists parking_address text default '';
alter table public.projects add column if not exists parking_lat double precision;
alter table public.projects add column if not exists parking_lng double precision;

-- 図面テーブルに種別を追加（'drawing'＝工事図面／'parking'＝駐車場の区画図など）
alter table public.drawings add column if not exists kind text not null default 'drawing';
