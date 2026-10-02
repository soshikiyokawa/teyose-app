-- ════ タスクは、作った人と担当者だけが見られるようにする ════
--
-- これまでは「社員は全件／発注先は自分あてのぶんだけ」だった。
-- 社員どうしでも、他の人のタスクは見えないようにする。
--
-- 見られるのは次の2通りだけ。
--   ・担当者（表示名、または所属している発注先の会社名で一致）
--   ・作った人
--
-- ついでに2つ直す。
--  ① お客様のアカウントがタスクに混ざらないようにする。
--     担当者は表示名の文字列で見ているので、社員と同じ名前のお客様アカウントがあると
--     そのタスクが見えてしまう（migration-genba75 と同じ形の漏れ）。
--     タスクを使うのは社員と発注先だけなので、お客様は入口で外す。
--  ② 「作った人」を名前ではなくアカウントのIDで持つ。
--     同じ表示名の人が2人いると混ざるため（migration-genba77 と同じ考え方）。
--
-- 先に Edge Function の入れ直しは不要。画面側（js/tasks.js）と合わせて使う。

-- ── ① 作った人をアカウントのIDで持つ ──
alter table public.tasks add column if not exists created_by_id uuid references auth.users(id) on delete set null;
comment on column public.tasks.created_by_id is 'タスクを作った人のアカウント。作った人だけに見せるのに使う（created_by は表示名で、これまでの分の手がかり）';

-- これまでの分は名前から引き当てる（同じ名前が2人いる場合は入れない）。
-- 下で作る「作った人を固定する」トリガーが先にあると入らないので、一度外してから当てる
drop trigger if exists tasks_keep_creator_trg on public.tasks;

update public.tasks t
   set created_by_id = p.id
  from public.profiles p
 where t.created_by_id is null
   and coalesce(t.created_by,'') <> ''
   and p.display_name = t.created_by
   and p.role in ('staff','carpenter')
   and (select count(*) from public.profiles q
         where q.display_name = t.created_by and q.role in ('staff','carpenter')) = 1;

create index if not exists tasks_created_by_idx on public.tasks(created_by_id);

-- ── 作った人かどうか ──
--
-- IDが入っていればIDで見る。入っていない古い分だけ、表示名で見る。
-- 名前で見るのは社員のときだけにして、発注先やお客様が名前合わせで入れないようにする。
create or replace function public.app_is_task_creator(p_created_by_id uuid, p_created_by text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(case
    when p_created_by_id is not null then p_created_by_id = auth.uid()
    when coalesce(p_created_by,'') = '' then false
    else app_is_employee()
         and p_created_by = (select display_name from public.profiles where id = auth.uid())
  end, false)
$$;
comment on function public.app_is_task_creator(uuid, text) is
  'そのタスクを作った本人か。IDが入っていればIDで、古い分だけ表示名で見る';

-- ── ② お客様を外す ──
--
-- 担当者は表示名の文字列で合わせているので、ここで役割も見ておく。
-- タスクを使うのは社員と発注先だけ。
create or replace function public.app_can_use_tasks()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select role in ('staff','carpenter','supplier') from public.profiles where id = auth.uid()),
    false)
$$;
comment on function public.app_can_use_tasks() is
  'タスクを使う人か（社員と発注先のみ）。お客様のアカウントを名前合わせで入れないため';

-- ── 見られるのは、担当者と作った人だけ ──
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select using (
    app_can_use_tasks()
    and (app_is_task_assignee(assignees) or app_is_task_creator(created_by_id, created_by))
  );

-- 作れるのは社員だけ（これまでどおり）。
-- 作った人を書き換えて他人のタスクに化けさせられないよう、ここで自分のIDに限る
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert with check (
    app_is_employee()
    and (created_by_id is null or created_by_id = auth.uid())
  );

-- 直せるのも、担当者と作った人だけ。
-- 発注先が直せる範囲（済／未済とチェックリストだけ）は tasks_guard で絞っている。
--
-- with check を using と同じにしてはいけない。
-- 引き継ぎで自分を担当から外すと、直したあとの行が「自分あてでない」形になり、
-- 自分で出したタスクでない限り引き継げなくなるため（直せるかどうかは using で足りる）
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update using (
    app_can_use_tasks()
    and (app_is_task_assignee(assignees) or app_is_task_creator(created_by_id, created_by))
  )
  with check (app_can_use_tasks());

-- 消せるのは管理者だけ。ただし見られるタスクに限る
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete using (
    app_user_role() = 'staff'
    and (app_is_task_assignee(assignees) or app_is_task_creator(created_by_id, created_by))
  );

-- ── 作った人の付け替えを止める ──
--
-- tasks_guard は発注先向けの絞りなので、社員が created_by_id を書き換えるのは止まらない。
-- 作った人は後から変わらないものなので、更新では必ず元の値に戻す。
create or replace function public.tasks_keep_creator() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by_id := old.created_by_id;
  new.created_by    := old.created_by;
  return new;
end $$;

drop trigger if exists tasks_keep_creator_trg on public.tasks;
create trigger tasks_keep_creator_trg before update on public.tasks
  for each row execute function public.tasks_keep_creator();

-- ── 引き継ぎ元へ返すとき（task_return）も、見られる人だけにする ──
--
-- security definer で中からタスクを読むので、RLSでは止まらない。ここで同じ条件にする
create or replace function public.task_return(
  p_id bigint, p_note text default '', p_checklist jsonb default null, p_files jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  t     public.tasks;
  tgt   text;
  me    text;
  cl    jsonb;
  n_done int;
  n_all  int;
begin
  select * into t from public.tasks where id = p_id;
  if not found then raise exception 'タスクが見つかりません'; end if;

  if not (app_can_use_tasks()
          and (app_is_task_assignee(t.assignees)
               or app_is_task_creator(t.created_by_id, t.created_by))) then
    raise exception '自分あてのタスクではありません';
  end if;

  tgt := public.task_return_target(t.handoffs, t.created_by);
  if tgt = '' then raise exception '返す相手が分かりません'; end if;

  cl := coalesce(p_checklist, t.checklist, '[]'::jsonb);
  select count(*) filter (where (e->>'done')::boolean is true), count(*)
    into n_done, n_all
    from jsonb_array_elements(cl) e;

  me := coalesce((select display_name from public.profiles where id = auth.uid()), '');

  update public.tasks
     set assignees = to_jsonb(array[tgt]),
         checklist = cl,
         handoffs  = coalesce(handoffs, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
           'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'from', me,
           'to',   jsonb_build_array(tgt),
           'note', coalesce(p_note, ''),
           'done', n_done,
           'total', n_all,
           'kind', 'return',
           'files', coalesce(p_files, '[]'::jsonb)
         ))
   where id = p_id;
end $$;

comment on table public.tasks is
  'タスク（やること）。担当者は表示名の配列。見られるのは担当者と作った人だけ';

-- ── 当てたあとの確認 ──
--
-- 「誰からも見えないタスク」が残っていないかを出す。
-- 担当者がいなくて、作った人も分からない（名前が空、もしくは同じ名前が2人いた）分が該当する。
-- 0件なら問題なし。出てきたら、担当者を入れ直すか、消してください
select
  (select count(*) from public.tasks) as "タスク全体",
  (select count(*) from public.tasks where created_by_id is not null) as "作った人が分かる",
  (select count(*) from public.tasks
     where created_by_id is null
       and coalesce(jsonb_array_length(assignees),0) = 0)              as "誰からも見えない";

-- 誰からも見えないものがあれば、その中身
select id, title, created_by, due_date, status, created_at
  from public.tasks
 where created_by_id is null
   and coalesce(jsonb_array_length(assignees),0) = 0
 order by id;
