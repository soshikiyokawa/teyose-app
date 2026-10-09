-- ════ マイグレーション97：タスクの引き継ぎができなくなっていたのを直す ════
-- Supabaseダッシュボード → SQL Editor に全文貼り付けて実行してください。
-- （再実行しても安全です）
--
-- migration-genba79.sql で、タスクを「作った人と担当者だけが見られる」ようにした。
-- そのとき、自分が作ったタスクでないと引き継げなくなっていた。
--
--   引き継ぐと、担当者が自分から引き継ぎ先に入れ替わる。
--   書き換えたあとの行は「自分には見えない行」になるが、
--   データベースは、書き換えたあとの行も自分に見える行であることを求める
--   （更新の with check をゆるめても、見るほうの決まりが掛かる）。
--   そのため「new row violates row-level security policy」で止まっていた。
--
-- 発注先が「返す」とき（task_return）と同じように、引き継ぎも手続きを通す。
-- 手続きの中で「自分のタスクか」を確かめてから書くので、他人のタスクは引き継げない。
-- 「だれから」「いつ」「どこまで済んだか」は、画面から送られた値ではなく、ここで付ける。

create or replace function public.task_handoff(
  p_id        bigint,
  p_to        jsonb,                     -- 引き継ぎ先の名前。["山田", "田中"]
  p_keep_me   boolean default false,     -- 自分も担当に残るか
  p_due       date    default null,      -- 期限（空なら期限なし）
  p_note      text    default '',
  p_checklist jsonb   default null,
  p_files     jsonb   default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t      public.tasks;
  me     text;
  cl     jsonb;
  nxt    jsonb;
  n_done int;
  n_all  int;
begin
  if not app_is_employee() then
    raise exception '引き継げるのは、きよかわの社員だけです';
  end if;

  select * into t from public.tasks where id = p_id for update;
  if not found then raise exception 'タスクが見つかりません'; end if;

  if not (app_is_task_assignee(t.assignees)
          or app_is_task_creator(t.created_by_id, t.created_by)) then
    raise exception '自分のタスクではありません';
  end if;

  if jsonb_typeof(p_to) is distinct from 'array' or jsonb_array_length(p_to) = 0 then
    raise exception '引き継ぎ先を選んでください';
  end if;

  me := coalesce((select display_name from public.profiles where id = auth.uid()), '');

  cl := coalesce(p_checklist, t.checklist, '[]'::jsonb);
  if jsonb_typeof(cl) is distinct from 'array' then cl := '[]'::jsonb; end if;
  select count(*) filter (where (e->>'done')::boolean is true), count(*)
    into n_done, n_all
    from jsonb_array_elements(cl) e;

  -- 新しい担当者：（残るなら自分）＋引き継ぎ先。同じ名前は1つにまとめ、並びは保つ
  select coalesce(jsonb_agg(y.v order by y.ord), '[]'::jsonb) into nxt
    from (
      select x.v, min(x.ord) as ord
        from (
          select to_jsonb(me) as v, 0::bigint as ord
           where coalesce(p_keep_me, false) and me <> ''
             and coalesce(t.assignees, '[]'::jsonb) ? me
          union all
          select e.value, e.ordinality
            from jsonb_array_elements(p_to) with ordinality as e(value, ordinality)
           where jsonb_typeof(e.value) = 'string'
        ) x
       group by x.v
    ) y;

  if jsonb_array_length(nxt) = 0 then
    raise exception '引き継ぎ先を選んでください';
  end if;

  update public.tasks
     set assignees = nxt,
         due_date  = p_due,
         checklist = cl,
         handoffs  = coalesce(handoffs, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
           'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'from', me,
           'to',   p_to,
           'note', coalesce(p_note, ''),
           'done', n_done,
           'total', n_all,
           'files', coalesce(p_files, '[]'::jsonb)
         ))
   where id = p_id;
end
$$;

comment on function public.task_handoff(bigint, jsonb, boolean, date, text, jsonb, jsonb) is
  'タスクを別の人に引き継ぐ。自分が担当か、自分が作ったタスクだけ。引き継ぐと自分から見えなくなる行になるので、ふつうの更新では書けない';

revoke all on function public.task_handoff(bigint, jsonb, boolean, date, text, jsonb, jsonb) from public, anon;
grant execute on function public.task_handoff(bigint, jsonb, boolean, date, text, jsonb, jsonb) to authenticated;

-- 画面から新しい手続きがすぐ呼べるように、決まりを読み直させる
notify pgrst, 'reload schema';

-- ── 確かめる ──
select '引き継ぎの手続き（task_handoff）' as "項目",
       case when to_regprocedure('public.task_handoff(bigint, jsonb, boolean, date, text, jsonb, jsonb)') is not null
            then 'ある' else '無い' end as "結果";
