-- ════ マイグレーション⑨：日報未提出リマインド（19時・20時） ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）

-- 毎日19時・20時（JST）に nippo-remind Edge Function を呼び出す。
-- 当日の日報が未提出の大工へ通知（全日有給・振替休日の人は除外。日曜は休日出勤の人のみ）。
-- pg_cronはUTC動作のため、JST19時＝UTC10時／JST20時＝UTC11時で登録する。
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'nippo-remind-19',
  '0 10 * * *',
  $$
  select net.http_post(
    url     := 'https://uotzxrwtzlpdnpfbaqpi.supabase.co/functions/v1/nippo-remind',
    headers := '{"Content-Type": "application/json", "x-remind-secret": "0bf6fb2a4cdbb06f967ac194fb2f169de0d6ec0b483c7919"}'::jsonb,
    body    := '{}'::jsonb
  )
  $$
);

select cron.schedule(
  'nippo-remind-20',
  '0 11 * * *',
  $$
  select net.http_post(
    url     := 'https://uotzxrwtzlpdnpfbaqpi.supabase.co/functions/v1/nippo-remind',
    headers := '{"Content-Type": "application/json", "x-remind-secret": "0bf6fb2a4cdbb06f967ac194fb2f169de0d6ec0b483c7919"}'::jsonb,
    body    := '{}'::jsonb
  )
  $$
);
