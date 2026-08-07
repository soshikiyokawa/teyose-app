-- ════ マイグレーション㊶：通知履歴 ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- これまでプッシュ通知は送るだけで、どこにも残っていなかった。
-- スマホの通知を消してしまうと内容を確かめる手立てが無かったので、
-- 送った通知を1件ずつ残して、アプリの「通知」から後から読めるようにする。
--
--   ・1行 ＝ 受け取った人1人ぶんの通知（同じ内容でも宛先の人数だけ行ができる）
--   ・自分あての通知だけが見える
--   ・書き込むのは通知を送るEdge Function（サービスロール）だけ
--   ・古いものは90日で消す（cronで毎日）

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  body text not null default '',
  tab text,                              -- タップしたときに開く画面（例 'genba/nippo'）
  source text default '',                -- どの機能からの通知か（chat / nippo-remind など）
  read_at timestamptz,                   -- 本人が開いた日時。nullなら未読
  created_at timestamptz default now()
);

create index if not exists notifications_user_idx
  on public.notifications(user_id, created_at desc);

comment on table public.notifications is 'プッシュ通知の履歴。1行＝宛先1人ぶん。アプリの「通知」で後から読める';

alter table public.notifications enable row level security;

-- 見られるのは自分あてのものだけ
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select using (user_id = auth.uid());

-- 既読にできるのは本人だけ（既読以外は変えられないよう、宛先は自分のまま固定）
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 自分あてのものは自分で消せる
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete using (user_id = auth.uid());

-- insertのポリシーは作らない＝アプリからは書き込めない。
-- 通知を送るEdge Functionはサービスロールで動くのでRLSを通らずに書き込める。

-- 他の端末・他のタブにもすぐ届くようにする（すでに入っていれば何もしない）
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ── 古い通知の掃除（90日より前を毎日1回消す） ──
create or replace function public.purge_old_notifications()
returns void language sql security definer set search_path = public as $$
  delete from public.notifications where created_at < now() - interval '90 days';
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule('purge-old-notifications')
      where exists (select 1 from cron.job where jobname='purge-old-notifications');
    perform cron.schedule('purge-old-notifications', '17 19 * * *',
      $cron$select public.purge_old_notifications()$cron$);
  end if;
end $$;
