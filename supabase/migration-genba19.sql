-- ════ マイグレーション⑲：案件ごとのチャット ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 案件（projects）に参加メンバー（表示名の配列）を持たせ、
-- chat_messages に project_id を追加して案件チャットを実現する。
-- 閲覧できるのは参加メンバー＋管理者(staff)。

alter table public.projects add column if not exists members jsonb not null default '[]'::jsonb;
alter table public.chat_messages add column if not exists project_id bigint references public.projects(id) on delete cascade;

-- 自分が参加メンバーかどうか（表示名で判定）
create or replace function public.app_is_project_member(p_id bigint) returns boolean
language sql stable security definer as $$
  select coalesce((
    select p.members ? (select display_name from public.profiles where id = auth.uid())
    from public.projects p where p.id = p_id
  ), false)
$$;

-- 業者（supplier）も、自分が参加メンバーの案件だけは参照できるようにする
-- （案件チャットのスレッド名表示に必要。編集は従来どおり不可）
drop policy if exists projects_member_select on public.projects;
create policy projects_member_select on public.projects
  for select using (app_is_project_member(id));

-- チャットのRLSを案件チャット対応に更新
--   案件チャット（project_id あり）＝参加メンバー または staff
--   社内チャット（is_internal）    ＝社員（staff＋carpenter）
--   発注先チャット                 ＝staff／carpenter／自社の発注先
drop policy if exists chat_messages_select on public.chat_messages;
drop policy if exists chat_messages_insert on public.chat_messages;
drop policy if exists chat_messages_update on public.chat_messages;
drop policy if exists chat_messages_delete on public.chat_messages;
-- v163で追加したcarpenter全許可ポリシーは、案件チャットの制限が効かなくなるため削除
-- （carpenterの権限は下の新ポリシーに統合済み）
drop policy if exists chat_messages_carpenter_select on public.chat_messages;
drop policy if exists chat_messages_carpenter_insert on public.chat_messages;
drop policy if exists chat_messages_carpenter_update on public.chat_messages;
drop policy if exists chat_messages_carpenter_delete on public.chat_messages;

create policy chat_messages_select on public.chat_messages for select using (
  case
    when project_id is not null then (app_user_role() = 'staff' or app_is_project_member(project_id))
    when is_internal then app_is_employee()
    else (app_user_role() in ('staff','carpenter') or supplier_id = app_supplier_id())
  end
);
create policy chat_messages_insert on public.chat_messages for insert with check (
  case
    when project_id is not null then (app_user_role() = 'staff' or app_is_project_member(project_id))
    when is_internal then app_is_employee()
    else (app_user_role() in ('staff','carpenter') or supplier_id = app_supplier_id())
  end
);
create policy chat_messages_update on public.chat_messages for update using (
  case
    when project_id is not null then (app_user_role() = 'staff' or app_is_project_member(project_id))
    when is_internal then app_is_employee()
    else (app_user_role() in ('staff','carpenter') or supplier_id = app_supplier_id())
  end
);
create policy chat_messages_delete on public.chat_messages for delete using (
  case
    when project_id is not null then (app_user_role() = 'staff' or app_is_project_member(project_id))
    when is_internal then app_is_employee()
    else (app_user_role() in ('staff','carpenter') or supplier_id = app_supplier_id())
  end
);
