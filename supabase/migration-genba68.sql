-- ════ グループチャット（何人かでのやりとり） ════
--
-- 個別チャット（1対1、migration-genba62.sql）の複数人版。
-- 誰でもグループを作れて、メンバーを選ぶ。表示は「社内・個別」タブにまとめる。
-- 見られるのはメンバーだけ（管理者でも、メンバーでなければ見られない）。
--
-- member_names はメンバーの表示名の控え。発注先の人は社員以外の名簿を引けない
-- （chat_directory）ので、グループの画面でメンバーの名前を出すために持っておく。

create table if not exists public.chat_groups (
  id           bigint generated always as identity primary key,
  name         text not null check (length(btrim(name)) between 1 and 40),
  member_ids   uuid[] not null default '{}',
  member_names text[] not null default '{}',
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.chat_groups is 'グループチャット。見られるのは member_ids に入っている人だけ';
comment on column public.chat_groups.member_names is 'メンバーの表示名の控え（画面に出す用）';

create index if not exists chat_groups_members_idx on public.chat_groups using gin (member_ids);

alter table public.chat_messages
  add column if not exists group_id bigint references public.chat_groups(id) on delete cascade;
comment on column public.chat_messages.group_id is 'グループチャットのID。NULLならグループチャットではない';
create index if not exists chat_messages_group_idx on public.chat_messages(group_id) where group_id is not null;

-- 自分がそのグループのメンバーか
create or replace function public.app_is_group_member(p_group_id bigint)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_groups g
    where g.id = p_group_id and auth.uid() = any(g.member_ids)
  )
$$;

-- ── グループそのものの見られる範囲 ──
alter table public.chat_groups enable row level security;

drop policy if exists chat_groups_select on public.chat_groups;
create policy chat_groups_select on public.chat_groups
  for select using (auth.uid() = any(member_ids));

-- 作る人は自分をメンバーに入れて作る
drop policy if exists chat_groups_insert on public.chat_groups;
create policy chat_groups_insert on public.chat_groups
  for insert with check (created_by = auth.uid() and auth.uid() = any(member_ids));

-- メンバーなら名前やメンバーを直せる。
-- ただし自分を外す（退出）は、更新したあと自分から見えなくなるため Postgres が止める。
-- 退出は下の leave_chat_group() を使う
drop policy if exists chat_groups_update on public.chat_groups;
create policy chat_groups_update on public.chat_groups
  for update using (auth.uid() = any(member_ids)) with check (true);

-- 消せるのは作った人だけ（中のメッセージも一緒に消える）
drop policy if exists chat_groups_delete on public.chat_groups;
create policy chat_groups_delete on public.chat_groups
  for delete using (created_by = auth.uid());

-- ── メッセージの見られる範囲にグループを足す ──
-- 引数が増えるので、新しい関数を作ってポリシーを付け替え、古い関数を消す
create or replace function public.app_can_see_chat(
  p_project_id bigint, p_is_internal boolean, p_supplier_id bigint,
  p_direct_a uuid, p_direct_b uuid, p_group_id bigint
) returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when p_group_id is not null then app_is_group_member(p_group_id)
    when p_direct_a is not null then auth.uid() in (p_direct_a, p_direct_b)
    when p_project_id is not null then (app_user_role() = 'staff' or app_is_project_member(p_project_id))
    when p_is_internal then app_is_employee()
    else (app_user_role() in ('staff','carpenter') or p_supplier_id = app_supplier_id())
  end
$$;

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
  for select using (app_can_see_chat(project_id, is_internal, supplier_id, direct_a, direct_b, group_id));

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert with check (app_can_see_chat(project_id, is_internal, supplier_id, direct_a, direct_b, group_id));

drop policy if exists chat_messages_update on public.chat_messages;
create policy chat_messages_update on public.chat_messages
  for update using (app_can_see_chat(project_id, is_internal, supplier_id, direct_a, direct_b, group_id));

drop policy if exists chat_messages_delete on public.chat_messages;
create policy chat_messages_delete on public.chat_messages
  for delete using (app_can_see_chat(project_id, is_internal, supplier_id, direct_a, direct_b, group_id));

drop function if exists public.app_can_see_chat(bigint, boolean, bigint, uuid, uuid);

-- グループが作られた・メンバーが変わったことを、ほかの人の画面にもすぐ出す
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_groups'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_groups';
  end if;
end $$;

-- ── 退出 ──
-- 自分をメンバーから外す。外したあとは自分から見えなくなるので、
-- 通常の更新では止められる。本人の分だけを外す手続きとして用意する
create or replace function public.leave_chat_group(p_group_id bigint)
returns void
language plpgsql security definer
set search_path = public
as $$
declare i int;
begin
  select array_position(member_ids, auth.uid()) into i from public.chat_groups where id = p_group_id;
  if i is null then return; end if;   -- メンバーでなければ何もしない
  update public.chat_groups
     set member_ids   = member_ids[1:i-1]   || member_ids[i+1:],
         member_names = member_names[1:i-1] || member_names[i+1:],
         updated_at   = now()
   where id = p_group_id;
end
$$;
grant execute on function public.leave_chat_group(bigint) to authenticated;
