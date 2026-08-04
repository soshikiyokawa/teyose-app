-- ════ マイグレーション㉟：エクレアのカタログ索引を取りやめる ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です。そもそも作っていなければ何も起きません）
--
-- 「カタログの取り込み」と「品番を自動で探す」をやめたので、そのための
-- テーブルと毎日の実行予約を片づける。品番は品目マスタに手で入れる運用に戻す。
-- 単価の取得（ekrea-price・毎月1日）はこれまでどおり動く。

select cron.unschedule('ekrea-catalog-daily') where exists (
  select 1 from cron.job where jobname = 'ekrea-catalog-daily'
);

drop table if exists public.ekrea_catalog;
drop table if exists public.ekrea_pages;
