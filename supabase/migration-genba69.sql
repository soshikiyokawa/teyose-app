-- ════ お客様（施主）アカウントと、案件ごとのお客様チャット ════
--
-- お客様は「チャットだけ」の役割。案件・見積・発注・日報などは一切見えない
-- （新しい役割は、既存の決まりでは何にも当てはまらないため、既定で何も見えない）。
--
-- 案件ごとに「お客様チャット」を1つ持つ。社内の案件チャット（project_id）とは別物で、
-- お客様に社内のやりとりは見えない。
--   ・お客様  … その案件の client_user_id の人
--   ・きよかわ … 案件情報で選んだ client_chat_member_ids の社員だけ（業者は入れない）
--
-- 既読：お客様が読むと、きよかわ側に既読が出る。
--       きよかわ側の既読は chat_reads に入るが、お客様は自分の行しか見られない
--       （chat_reads のポリシー）ので、お客様には既読が出ない。

-- ── 役割にお客様を足す ──
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('staff','carpenter','supplier','client'));

-- ── 案件にお客様の情報を持たせる ──
alter table public.projects add column if not exists client_user_id uuid references auth.users(id) on delete set null;
alter table public.projects add column if not exists client_email text not null default '';
alter table public.projects add column if not exists client_chat_member_ids   uuid[] not null default '{}';
alter table public.projects add column if not exists client_chat_member_names text[] not null default '{}';

comment on column public.projects.client_user_id is 'お客様チャットに入るお客様のアカウント。NULLならまだ登録していない';
comment on column public.projects.client_email is 'お客様のメールアドレス（チャット案内メールの宛先）';
comment on column public.projects.client_chat_member_ids is 'お客様チャットに入るきよかわ側の社員';
comment on column public.projects.client_chat_member_names is 'その表示名の控え（お客様の画面に出す用）';

create index if not exists projects_client_user_idx on public.projects(client_user_id) where client_user_id is not null;

-- ── お客様チャットのメッセージ ──
alter table public.chat_messages
  add column if not exists client_project_id bigint references public.projects(id) on delete cascade;
comment on column public.chat_messages.client_project_id is 'お客様チャットの案件ID。NULLならお客様チャットではない';
create index if not exists chat_messages_client_idx on public.chat_messages(client_project_id) where client_project_id is not null;

-- 自分がその案件のお客様チャットに入っているか（お客様本人か、選ばれた社員か）
create or replace function public.app_can_see_client_chat(p_project_id bigint)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and (auth.uid() = p.client_user_id or auth.uid() = any(p.client_chat_member_ids))
  )
$$;

-- ── メッセージの見られる範囲にお客様チャットを足す ──
create or replace function public.app_can_see_chat(
  p_project_id bigint, p_is_internal boolean, p_supplier_id bigint,
  p_direct_a uuid, p_direct_b uuid, p_group_id bigint, p_client_project_id bigint
) returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when p_client_project_id is not null then app_can_see_client_chat(p_client_project_id)
    when p_group_id is not null then app_is_group_member(p_group_id)
    when p_direct_a is not null then auth.uid() in (p_direct_a, p_direct_b)
    when p_project_id is not null then (app_user_role() = 'staff' or app_is_project_member(p_project_id))
    when p_is_internal then app_is_employee()
    else (app_user_role() in ('staff','carpenter') or p_supplier_id = app_supplier_id())
  end
$$;

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
  for select using (app_can_see_chat(project_id, is_internal, supplier_id, direct_a, direct_b, group_id, client_project_id));

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert with check (app_can_see_chat(project_id, is_internal, supplier_id, direct_a, direct_b, group_id, client_project_id));

drop policy if exists chat_messages_update on public.chat_messages;
create policy chat_messages_update on public.chat_messages
  for update using (app_can_see_chat(project_id, is_internal, supplier_id, direct_a, direct_b, group_id, client_project_id));

drop policy if exists chat_messages_delete on public.chat_messages;
create policy chat_messages_delete on public.chat_messages
  for delete using (app_can_see_chat(project_id, is_internal, supplier_id, direct_a, direct_b, group_id, client_project_id));

drop function if exists public.app_can_see_chat(bigint, boolean, bigint, uuid, uuid, bigint);

-- ── お客様が自分のチャットの一覧を引くための手続き ──
-- お客様は案件（projects）そのものを見られないので、必要な分だけをここから返す
create or replace function public.app_my_client_chats()
returns table(project_id bigint, project_name text, member_names text[])
language sql stable security definer
set search_path = public
as $$
  select p.id, p.name, p.client_chat_member_names
  from public.projects p
  where p.client_user_id = auth.uid()
  order by p.id
$$;
grant execute on function public.app_my_client_chats() to authenticated;

-- 業者はお客様チャットに入れない（member_ids に入れられても、社員でなければ弾く）
-- ＝ app_can_see_client_chat は「案件に登録された人」だけを通すので、
--    案件情報の画面で業者を候補に出さないことで運用上も入らない。
