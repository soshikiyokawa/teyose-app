-- ════ 個別チャット（1対1のやりとり） ════
--
-- 管理者・社員・発注先の誰でも、相手を1人選んで直接やりとりできるようにする。
-- 表示は「社内・個別」タブにまとめる。
--
-- 相手の組は2人ぶんのIDで持つ。並びで迷わないよう、小さいほうを direct_a に入れる。
-- 見られるのはその2人だけ（管理者でも他人どうしのやりとりは見られない）。

alter table public.chat_messages add column if not exists direct_a uuid references auth.users(id) on delete cascade;
alter table public.chat_messages add column if not exists direct_b uuid references auth.users(id) on delete cascade;

comment on column public.chat_messages.direct_a is '個別チャットの相手の組（小さいほうのID）。NULLなら個別チャットではない';
comment on column public.chat_messages.direct_b is '個別チャットの相手の組（大きいほうのID）';

create index if not exists chat_messages_direct_idx on public.chat_messages(direct_a, direct_b)
  where direct_a is not null;

-- 組は必ず「小さいほう・大きいほう」の順で、同じ人どうしにはしない
alter table public.chat_messages drop constraint if exists chat_messages_direct_ck;
alter table public.chat_messages add constraint chat_messages_direct_ck check (
  (direct_a is null and direct_b is null)
  or (direct_a is not null and direct_b is not null and direct_a < direct_b)
);

-- ── 見られる範囲 ──
-- 個別チャットは、その2人だけ。ほかは今までどおり。
create or replace function public.app_can_see_chat(
  p_project_id bigint, p_is_internal boolean, p_supplier_id bigint,
  p_direct_a uuid, p_direct_b uuid
) returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when p_direct_a is not null then auth.uid() in (p_direct_a, p_direct_b)
    when p_project_id is not null then (app_user_role() = 'staff' or app_is_project_member(p_project_id))
    when p_is_internal then app_is_employee()
    else (app_user_role() in ('staff','carpenter') or p_supplier_id = app_supplier_id())
  end
$$;

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
  for select using (app_can_see_chat(project_id, is_internal, supplier_id, direct_a, direct_b));

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert with check (app_can_see_chat(project_id, is_internal, supplier_id, direct_a, direct_b));

drop policy if exists chat_messages_update on public.chat_messages;
create policy chat_messages_update on public.chat_messages
  for update using (app_can_see_chat(project_id, is_internal, supplier_id, direct_a, direct_b));

drop policy if exists chat_messages_delete on public.chat_messages;
create policy chat_messages_delete on public.chat_messages
  for delete using (app_can_see_chat(project_id, is_internal, supplier_id, direct_a, direct_b));
