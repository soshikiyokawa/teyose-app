-- ════ マイグレーション㊸：タスク管理 ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 「やること」を1件ずつ残して、担当者・期限・案件を付けて管理する。
--   ・担当者は表示名の配列。案件の参加メンバーと同じ考え方で、発注先は
--     会社名を入れておけばその会社のアカウント全員が自分あてとして見られる
--   ・案件に紐づかない社内のタスク（project_id が null）も作れる
--   ・チェックリスト（サブタスク）は checklist に入れる
--
-- 見える範囲
--   ・きよかわ社員（管理者・一般社員）… 全件
--   ・発注先                        … 自分あてに割り当てられたものだけ
--
-- 直せる範囲
--   ・きよかわ社員 … 何でも
--   ・発注先       … 自分あてのタスクの「済/未済」とチェックリストだけ
--                    （表題・担当者・期限・案件は変えられない。トリガーで止める）
--   ・消せるのは管理者だけ
--
-- 先に Edge Function をデプロイしてください：
--   supabase functions deploy task-remind

create table if not exists public.tasks (
  id bigint generated always as identity primary key,
  title text not null,
  detail text default '',
  project_id bigint references public.projects(id) on delete set null,  -- null＝案件に紐づかない社内タスク
  assignees jsonb not null default '[]'::jsonb,   -- 担当者の表示名（発注先は会社名でもよい）
  due_date date,                                  -- 期限（null＝期限なし）
  status text not null default 'open',            -- open＝未済 / done＝済
  checklist jsonb not null default '[]'::jsonb,   -- [{id, text, done}]
  created_by text default '',
  done_at timestamptz,
  done_by text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists tasks_due_idx on public.tasks(status, due_date);
create index if not exists tasks_project_idx on public.tasks(project_id);

comment on table public.tasks is 'タスク（やること）。担当者は表示名の配列。発注先は自分あてのぶんだけ見える';

-- 自分あてのタスクかどうか。案件の参加メンバーと同じ考え方で、
-- 表示名でも、所属している発注先の会社名でも一致させる
create or replace function public.app_is_task_assignee(a jsonb) returns boolean
language sql stable security definer as $$
  select coalesce(
    (a ? (select display_name from public.profiles where id = auth.uid()))
    or coalesce((
      select a ? s.name from public.suppliers s
      where s.id = (select supplier_id from public.profiles where id = auth.uid())
    ), false)
  , false)
$$;

alter table public.tasks enable row level security;

-- 社員は全件、発注先は自分あてのぶんだけ
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select using (app_is_employee() or app_is_task_assignee(assignees));

-- 作れるのは社員だけ
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert with check (app_is_employee());

-- 直せるのは社員と、自分あてのタスクの担当者（発注先が直せる範囲はトリガーで絞る）
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update using (app_is_employee() or app_is_task_assignee(assignees))
  with check (app_is_employee() or app_is_task_assignee(assignees));

-- 消せるのは管理者だけ
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete using (app_user_role() = 'staff');

-- 発注先は「済/未済」とチェックリストだけ直せるようにする。
-- 表題・担当者・期限・案件を書き換えられないように、ここで元の値に戻す
create or replace function public.tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if not app_is_employee() then
    new.title      := old.title;
    new.detail     := old.detail;
    new.project_id := old.project_id;
    new.assignees  := old.assignees;
    new.due_date   := old.due_date;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

drop trigger if exists tasks_guard_trg on public.tasks;
create trigger tasks_guard_trg before update on public.tasks
  for each row execute function public.tasks_guard();

-- 他の端末にもすぐ反映されるようにする（すでに入っていれば何もしない）
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
end $$;

-- ── 期限のリマインド（毎朝7時JST＝22時UTC） ──
-- 期限が「明日」のタスクと「今日」のタスクを、担当者ごとにまとめて通知する
select cron.unschedule('task-remind-daily') where exists (
  select 1 from cron.job where jobname = 'task-remind-daily'
);
select cron.schedule(
  'task-remind-daily',
  '0 22 * * *',
  $$
  select net.http_post(
    url     := 'https://uotzxrwtzlpdnpfbaqpi.supabase.co/functions/v1/task-remind',
    headers := '{"Content-Type": "application/json", "x-remind-secret": "0bf6fb2a4cdbb06f967ac194fb2f169de0d6ec0b483c7919"}'::jsonb,
    body    := '{}'::jsonb
  )
  $$
);
