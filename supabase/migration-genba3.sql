-- ════ マイグレーション③：残業の承認フロー＋リマインド通知 ════
-- Supabaseダッシュボード → SQL Editor に全文貼り付けて実行してください。
-- （再実行しても安全です）

-- ── 1. 日報に残業承認のステータスを追加 ──
-- none = 残業なし / pending = 申請中 / approved = 承認 / rejected = 却下
alter table public.daily_reports add column if not exists ot_status text not null default 'none';
alter table public.daily_reports drop constraint if exists daily_reports_ot_status_check;
alter table public.daily_reports add constraint daily_reports_ot_status_check
  check (ot_status in ('none','pending','approved','rejected'));
alter table public.daily_reports add column if not exists ot_reviewer_name text default '';
alter table public.daily_reports add column if not exists ot_review_note text default '';
alter table public.daily_reports add column if not exists ot_reviewed_at timestamptz;

-- ── 2. 日報デフォルトの変更（終了18:00・休憩120分） ──
alter table public.daily_reports alter column end_time set default '18:00';
alter table public.daily_reports alter column break_minutes set default 120;

-- ── 3. 残業の承認者判定ヘルパー ──
-- 承認者を変更する場合はここと、js/genba/genba-nippo.js の OT_APPROVERS、
-- supabase/functions/ot-remind/index.ts の APPROVERS を合わせて変更すること
create or replace function public.app_is_ot_approver() returns boolean
language sql stable security definer as $$
  select coalesce(
    (select display_name in ('清川創史','清川太視','清川説志','清川伸二','原口晴郎')
       from public.profiles where id = auth.uid()),
    false)
$$;

-- ── 4. RLS：承認者は全員の日報を閲覧・承認（更新）できる ──
drop policy if exists daily_reports_select on public.daily_reports;
create policy daily_reports_select on public.daily_reports
  for select using (app_user_role() = 'staff' or user_id = auth.uid() or app_is_ot_approver());
drop policy if exists daily_reports_update on public.daily_reports;
create policy daily_reports_update on public.daily_reports
  for update using (app_user_role() = 'staff' or user_id = auth.uid() or app_is_ot_approver());

-- ── 5. リマインド（1時間ごと。21時〜翌7時はEdge Function側でスキップ） ──
-- pg_cron が毎時0分に ot-remind Edge Function を呼び出す。
-- 承認待ちが0件なら何も送らない＝承認完了で自動的にリマインド停止。
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'ot-remind-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://uotzxrwtzlpdnpfbaqpi.supabase.co/functions/v1/ot-remind',
    headers := '{"Content-Type": "application/json", "x-remind-secret": "0bf6fb2a4cdbb06f967ac194fb2f169de0d6ec0b483c7919"}'::jsonb,
    body    := '{}'::jsonb
  )
  $$
);
