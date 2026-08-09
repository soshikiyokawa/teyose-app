-- ════ マイグレーション㊺：発注先が「引き継ぎ元へ返す」 ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 発注先は担当者を変えられないので、自分の分が終わっても手元に残ったままだった。
-- 「自分に引き継いだ人へ返す」ときだけできるようにする。
--
-- 返せる相手は1人に決まっていて、選ばせない：
--   ・自分あての引き継ぎのうち、いちばん新しいものの「渡した人」
--   ・引き継ぎがまだ無ければ、そのタスクを作った人
-- ほかの人に回すことはできない（引き継ぎ先を自由に選べるのは社員だけ）。
--
-- 返すと自分は担当から外れる＝そのタスクが自分から見えなくなるので、
-- ふつうの更新では「見えない行は書けない」という決まりに引っかかる。
-- そこで返す操作だけは task_return という決まった手順で行う。
-- 中で「本当に自分あてか」「返す相手は誰か」を確かめてから書き換えるので、
-- 呼び出す側が相手や中身を自由に指定することはできない。

-- ── 返す相手を決める（アプリ側の taskReturnTarget と同じ決まり） ──
create or replace function public.task_return_target(p_handoffs jsonb, p_created_by text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select h.value->>'from'
       from jsonb_array_elements(coalesce(p_handoffs, '[]'::jsonb)) with ordinality as h(value, ord)
      where app_is_task_assignee(coalesce(h.value->'to', '[]'::jsonb))   -- 自分あての引き継ぎ
        and coalesce(h.value->>'from', '') <> ''
      order by h.ord desc
      limit 1),
    nullif(p_created_by, ''),
    ''
  )
$$;

comment on function public.task_return_target(jsonb, text) is
  '発注先が「返す」相手。自分に引き継いだ人（いちばん新しいもの）、無ければタスクを作った人';

-- ── 返す（発注先が呼ぶ。相手も中身もこの中で決める） ──
create or replace function public.task_return(p_id bigint, p_note text default '', p_checklist jsonb default null)
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

  -- いま自分が担当になっているタスクだけ返せる
  if not (app_is_task_assignee(t.assignees) or app_is_employee()) then
    raise exception '自分あてのタスクではありません';
  end if;

  tgt := public.task_return_target(t.handoffs, t.created_by);
  if tgt = '' then raise exception '返す相手が分かりません'; end if;

  -- チェックリストは渡されたものを使う（触っていなければ今のまま）
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
           'kind', 'return'
         ))
   where id = p_id;
end $$;

comment on function public.task_return(bigint, text, jsonb) is
  '発注先がタスクを引き継ぎ元へ返す。返す相手はこの中で決めるので、呼ぶ側は指定できない';

revoke all on function public.task_return(bigint, text, jsonb) from public;
grant execute on function public.task_return(bigint, text, jsonb) to authenticated;

-- ── ふつうの更新では、担当者と引き継ぎ履歴は変えられないままにする ──
-- 上の task_return が書き込む形（担当者を返す相手だけにして、履歴を1件足す）
-- のときだけ通す。それ以外は元の値に戻す。
create or replace function public.tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tgt   text;
  n     int;
  keep  jsonb;   -- 新しい履歴のうち、前からある部分
  added jsonb;   -- 足された1件
begin
  new.updated_at := now();
  if app_is_employee() then return new; end if;

  -- 社員以外は、表題・メモ・案件・期限・作成者は変えられない
  new.title      := old.title;
  new.detail     := old.detail;
  new.project_id := old.project_id;
  new.due_date   := old.due_date;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  -- 「引き継ぎ元へ返す」の形かどうかを確かめる
  tgt := public.task_return_target(old.handoffs, old.created_by);
  n   := jsonb_array_length(coalesce(old.handoffs, '[]'::jsonb));
  keep := (
    select coalesce(jsonb_agg(t.e order by t.ord), '[]'::jsonb)
    from jsonb_array_elements(coalesce(new.handoffs, '[]'::jsonb)) with ordinality as t(e, ord)
    where t.ord <= n
  );
  added := coalesce(new.handoffs, '[]'::jsonb) -> n;

  if app_is_task_assignee(old.assignees)                                    -- いま自分が担当
     and tgt <> ''                                                          -- 返す相手がいる
     and jsonb_array_length(coalesce(new.handoffs, '[]'::jsonb)) = n + 1    -- 履歴は1件だけ増える
     and keep = coalesce(old.handoffs, '[]'::jsonb)                         -- 前の履歴はそのまま
     and added -> 'to' = to_jsonb(array[tgt])                               -- 渡し先は返す相手だけ
     and new.assignees = to_jsonb(array[tgt])                               -- 担当者も返す相手だけ
  then
    return new;   -- 返す操作として認める
  end if;

  new.assignees := old.assignees;
  new.handoffs  := old.handoffs;
  return new;
end $$;

-- migration-genba43.sql と同じ内容に戻す（㊺の途中で緩めていたため）
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update using (app_is_employee() or app_is_task_assignee(assignees))
  with check (app_is_employee() or app_is_task_assignee(assignees));
