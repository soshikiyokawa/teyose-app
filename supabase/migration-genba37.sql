-- ════ マイグレーション㊲：未入金のお知らせ ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 入金予定日を過ぎているのに入金が予定額に届いていない案件を、
-- 毎週月曜9時（JST）に管理者へ通知する。
-- 入金の予定と実績は見積の payments に入っているので、新しい表は作らない。
--
-- 先に Edge Function をデプロイしてください：
--   supabase functions deploy payment-remind --no-verify-jwt

select cron.unschedule('payment-remind-weekly') where exists (
  select 1 from cron.job where jobname = 'payment-remind-weekly'
);
select cron.schedule(
  'payment-remind-weekly',
  '0 0 * * 1',
  $$
  select net.http_post(
    url     := 'https://uotzxrwtzlpdnpfbaqpi.supabase.co/functions/v1/payment-remind',
    headers := '{"Content-Type": "application/json", "x-remind-secret": "0bf6fb2a4cdbb06f967ac194fb2f169de0d6ec0b483c7919"}'::jsonb,
    body    := '{}'::jsonb
  )
  $$
);
