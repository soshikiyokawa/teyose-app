-- ════ マイグレーション㊻：引き継ぎに資料を添える ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 引き継ぐとき・返すときに、図面や写真などの資料を添えられるようにする。
-- ファイルは非公開の task-files バケットに置き、
-- 「タスクID/日時.拡張子」という場所で保管する。
-- 引き継ぎの記録（handoffs の1件）に files として名前と場所を持たせる。
--
-- 見られるのは、そのタスクを見られる人だけ（社員全員と、自分あての発注先）。
-- 開くときは1時間だけ有効なリンクを作る。

-- そのタスクを見られるか（保管場所のフォルダ名＝タスクIDで判定するために使う）
create or replace function public.app_can_see_task(p_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.tasks t
    where t.id = p_id and (app_is_employee() or app_is_task_assignee(t.assignees))
  )
$$;

comment on function public.app_can_see_task(bigint) is
  'そのタスクを見られるか。引き継ぎに添えた資料の出し分けに使う';

insert into storage.buckets (id, name, public)
values ('task-files', 'task-files', false)
on conflict (id) do nothing;

-- 置けるのは、そのタスクを見られる人（＝担当者と社員）
drop policy if exists task_files_insert on storage.objects;
create policy task_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'task-files'
    and app_can_see_task(((storage.foldername(name))[1])::bigint)
  );

-- 見られるのも同じ人
drop policy if exists task_files_select on storage.objects;
create policy task_files_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'task-files'
    and app_can_see_task(((storage.foldername(name))[1])::bigint)
  );

-- 引き継ぎの記録に添えた資料なので、消せるのは管理者だけ
drop policy if exists task_files_delete on storage.objects;
create policy task_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'task-files' and app_user_role() = 'staff');

-- ── 返すときにも資料を添えられるようにする（p_files を追加） ──
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

  if not (app_is_task_assignee(t.assignees) or app_is_employee()) then
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

comment on function public.task_return(bigint, text, jsonb, jsonb) is
  '発注先がタスクを引き継ぎ元へ返す。返す相手はこの中で決めるので、呼ぶ側は指定できない';

-- 引数が増えたので、前の形（3つ）は消しておく
drop function if exists public.task_return(bigint, text, jsonb);

revoke all on function public.task_return(bigint, text, jsonb, jsonb) from public;
grant execute on function public.task_return(bigint, text, jsonb, jsonb) to authenticated;
