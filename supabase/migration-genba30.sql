-- ════ マイグレーション㉚：定期点検の「案内完了」と通知 ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です。マイグレーション㉙の後に実行してください）
--
-- 毎年3月1日に「今年度の点検予定」を管理者へ通知し、
-- お客様への案内が済む（案内完了）まで毎週金曜に催促する。

-- 案内だけ先に記録できるよう、実施日は空でもよくする
alter table public.inspection_records alter column done_date drop not null;
alter table public.inspection_records add column if not exists guided_date date;

comment on column public.inspection_records.guided_date is 'お客様へ点検の案内をした日（案内完了）。入るまで毎週催促する';
comment on column public.inspection_records.done_date is '点検を実施した日。案内だけの段階では空';

-- ── 通知（毎日9時JSTに inspection-remind を呼び、3月1日と毎週金曜だけ送る） ──
-- 先に Edge Function をデプロイしてください：
--   supabase functions deploy inspection-remind --no-verify-jwt
select cron.unschedule('inspection-remind-daily') where exists (
  select 1 from cron.job where jobname = 'inspection-remind-daily'
);
select cron.schedule(
  'inspection-remind-daily',
  '0 0 * * *',
  $$
  select net.http_post(
    url     := 'https://uotzxrwtzlpdnpfbaqpi.supabase.co/functions/v1/inspection-remind',
    headers := '{"Content-Type": "application/json", "x-remind-secret": "0bf6fb2a4cdbb06f967ac194fb2f169de0d6ec0b483c7919"}'::jsonb,
    body    := '{}'::jsonb
  )
  $$
);
