-- ════ 夜間の通知を預かって、翌朝まとめて届ける ════
--
-- これまで21時〜翌7時の通知は、その場で捨てられていた。
-- タスクの引き継ぎのように「相手に手を動かしてもらう連絡」が
-- 黙って消えるのは困るので、いったん預かって翌朝7時に届ける。
--
-- 預かるのは send-push（通知の入口）。届けるのは flush-notifications（毎朝7時）。
-- どちらもサーバー側だけが触るので、画面からは読み書きできないようにしておく。

create table if not exists public.pending_notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  body text not null default '',
  tab text,
  kind text not null default '',        -- どの種類の通知か（履歴に残すときに使う）
  created_at timestamptz not null default now(),   -- 本来届くはずだった時刻
  sent_at timestamptz                              -- 実際に届けた時刻。空＝まだ
);

create index if not exists pending_notifications_wait_idx
  on public.pending_notifications(sent_at) where sent_at is null;

comment on table public.pending_notifications is
  '夜間（21時〜翌7時）に発生した通知の預かり。翌朝7時に flush-notifications が届ける';

alter table public.pending_notifications enable row level security;
-- 画面からは触らない。サービスロール（Edge Function）だけが読み書きする

-- ── 毎朝7時（JST）に、預かった通知を届ける ──
-- 先に Edge Function をデプロイしておくこと：
--   npx supabase functions deploy flush-notifications

select cron.unschedule('flush-notifications-daily') where exists (
  select 1 from cron.job where jobname = 'flush-notifications-daily'
);
select cron.schedule(
  'flush-notifications-daily',
  '0 22 * * *',                                  -- UTC 22:00 ＝ JST 翌7:00
  $$
  select net.http_post(
    url     := 'https://uotzxrwtzlpdnpfbaqpi.supabase.co/functions/v1/flush-notifications',
    headers := '{"Content-Type": "application/json", "x-remind-secret": "0bf6fb2a4cdbb06f967ac194fb2f169de0d6ec0b483c7919"}'::jsonb,
    body    := '{}'::jsonb
  )
  $$
);
