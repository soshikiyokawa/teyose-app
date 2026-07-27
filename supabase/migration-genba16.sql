-- ════ マイグレーション⑯：日報の不備チェック通知（月次・週次） ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- ・毎月20日10時（JST）→ nippo-check?mode=monthly（管理者へ確認依頼）
-- ・毎週金曜10時（JST）→ nippo-check?mode=weekly（記入もれの本人へ通知）
-- pg_cronはUTC動作：JST10時＝UTC01時。20日10時JST＝毎月20日01時UTC／金曜10時JST＝金曜01時UTC。
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'nippo-check-monthly',
  '0 1 20 * *',
  $$
  select net.http_post(
    url     := 'https://uotzxrwtzlpdnpfbaqpi.supabase.co/functions/v1/nippo-check?mode=monthly',
    headers := '{"Content-Type": "application/json", "x-remind-secret": "0bf6fb2a4cdbb06f967ac194fb2f169de0d6ec0b483c7919"}'::jsonb,
    body    := '{}'::jsonb
  )
  $$
);

select cron.schedule(
  'nippo-check-weekly',
  '0 1 * * 5',
  $$
  select net.http_post(
    url     := 'https://uotzxrwtzlpdnpfbaqpi.supabase.co/functions/v1/nippo-check?mode=weekly',
    headers := '{"Content-Type": "application/json", "x-remind-secret": "0bf6fb2a4cdbb06f967ac194fb2f169de0d6ec0b483c7919"}'::jsonb,
    body    := '{}'::jsonb
  )
  $$
);
