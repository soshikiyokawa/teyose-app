-- ════ マイグレーション㊼：工事区分ごとの定型タスクと、工程表との連動 ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 「新築ならこれをやる」という決まったタスクを登録しておき、案件にまとめて取り込む。
-- 取り込んだタスクの期限は、工程表の節目（着工日・上棟日など）や工程の日付から
-- 「◯日前」「◯日後」で決める。工程表を直すと期限も付いて動く。
--
--   基準の決め方（anchor_kind）
--     milestone … 工程表の節目（着工日・上棟日・引渡日など）の日付
--     schedule  … 工程表の工程名で探して、その開始日または完了日
--     none      … 基準なし（期限は空のまま。手で入れる）
--   そこから offset_days 日ずらしたものが期限になる（-7＝7日前、0＝当日、3＝3日後）

create table if not exists public.task_templates (
  id bigint generated always as identity primary key,
  work_type text not null,                 -- 工事区分（新築・リフォームなど）
  title text not null,
  detail text default '',
  checklist jsonb not null default '[]'::jsonb,
  assignees jsonb not null default '[]'::jsonb,   -- 既定の担当者（空なら取り込むときに決める）
  anchor_kind text not null default 'none',       -- milestone / schedule / none
  anchor_name text default '',                    -- 節目の名前、または工程名
  anchor_point text default 'start',              -- 工程のとき start＝開始日 / end＝完了日
  offset_days int not null default 0,
  sort_order int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists task_templates_type_idx on public.task_templates(work_type, sort_order);

comment on table public.task_templates is
  '工事区分ごとの定型タスク。案件に取り込むと、工程表の日付から期限が決まる';

alter table public.task_templates enable row level security;

-- 社員は見られる。作る・直す・消せるのは管理者だけ
drop policy if exists task_templates_select on public.task_templates;
create policy task_templates_select on public.task_templates
  for select using (app_is_employee());

drop policy if exists task_templates_write on public.task_templates;
create policy task_templates_write on public.task_templates
  for all using (app_user_role() = 'staff') with check (app_user_role() = 'staff');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='task_templates'
  ) then
    alter publication supabase_realtime add table public.task_templates;
  end if;
end $$;

-- ── タスク側：どの定型から来たか、期限を工程表に合わせるかを持たせる ──
alter table public.tasks add column if not exists template_id  bigint references public.task_templates(id) on delete set null;
alter table public.tasks add column if not exists anchor_kind  text default 'none';
alter table public.tasks add column if not exists anchor_name  text default '';
alter table public.tasks add column if not exists anchor_point text default 'start';
alter table public.tasks add column if not exists offset_days  int default 0;
alter table public.tasks add column if not exists auto_due     boolean not null default false;

comment on column public.tasks.auto_due is
  '期限を工程表に合わせて動かすか。onなら工程表を保存したときに期限を計算し直す';

-- 発注先はこれらも変えられないようにする（担当者・期限と同じ扱い）
create or replace function public.tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tgt   text;
  n     int;
  keep  jsonb;
  added jsonb;
begin
  new.updated_at := now();
  if app_is_employee() then return new; end if;

  -- 社員以外は、表題・メモ・案件・期限・作成者・工程表との結び付きは変えられない
  new.title        := old.title;
  new.detail       := old.detail;
  new.project_id   := old.project_id;
  new.due_date     := old.due_date;
  new.created_by   := old.created_by;
  new.created_at   := old.created_at;
  new.template_id  := old.template_id;
  new.anchor_kind  := old.anchor_kind;
  new.anchor_name  := old.anchor_name;
  new.anchor_point := old.anchor_point;
  new.offset_days  := old.offset_days;
  new.auto_due     := old.auto_due;

  -- 「引き継ぎ元へ返す」の形かどうかを確かめる
  tgt := public.task_return_target(old.handoffs, old.created_by);
  n   := jsonb_array_length(coalesce(old.handoffs, '[]'::jsonb));
  keep := (
    select coalesce(jsonb_agg(t.e order by t.ord), '[]'::jsonb)
    from jsonb_array_elements(coalesce(new.handoffs, '[]'::jsonb)) with ordinality as t(e, ord)
    where t.ord <= n
  );
  added := coalesce(new.handoffs, '[]'::jsonb) -> n;

  if app_is_task_assignee(old.assignees)
     and tgt <> ''
     and jsonb_array_length(coalesce(new.handoffs, '[]'::jsonb)) = n + 1
     and keep = coalesce(old.handoffs, '[]'::jsonb)
     and added -> 'to' = to_jsonb(array[tgt])
     and new.assignees = to_jsonb(array[tgt])
  then
    return new;
  end if;

  new.assignees := old.assignees;
  new.handoffs  := old.handoffs;
  return new;
end $$;
