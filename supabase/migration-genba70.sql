-- ════ お客様チャットを、1案件に複数人（ご主人・奥様など）にする ════
--
-- これまでは案件に1人だけ（projects.client_user_id / client_email）だった。
-- ご夫婦それぞれに入っていただけるよう、案件ごとにお客様を何人でも持てるようにする。
-- 誰が書いたかは、メッセージの sender_name（そのお客様の表示名）で分かる。

create table if not exists public.project_clients (
  id         bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,   -- ご案内メールを送るまではNULL
  name       text not null default '',                            -- お名前（画面と発言者名に使う）
  email      text not null,
  invited_at timestamptz,                                         -- ご案内メールを送った日時
  created_at timestamptz not null default now()
);

comment on table public.project_clients is '案件ごとのお客様（お客様チャットに入る人）。1案件に複数人';
comment on column public.project_clients.user_id is 'お客様のアカウント。ご案内メールを送って登録されると入る';

create unique index if not exists project_clients_email_idx on public.project_clients(project_id, lower(email));
create index if not exists project_clients_user_idx on public.project_clients(user_id) where user_id is not null;
create index if not exists project_clients_project_idx on public.project_clients(project_id);

-- これまでの1人ぶんを移す
insert into public.project_clients (project_id, user_id, name, email)
select p.id, p.client_user_id, coalesce(nullif(p.client_name,''), '') , p.client_email
from public.projects p
where coalesce(p.client_email,'') <> ''
  and not exists (select 1 from public.project_clients c
                  where c.project_id = p.id and lower(c.email) = lower(p.client_email));

-- ── 見られる範囲 ──
alter table public.project_clients enable row level security;

-- きよかわの社員は全部見られる・直せる。お客様は自分の行だけ見られる
drop policy if exists project_clients_select on public.project_clients;
create policy project_clients_select on public.project_clients
  for select using (app_is_employee() or user_id = auth.uid());

drop policy if exists project_clients_write on public.project_clients;
create policy project_clients_write on public.project_clients
  for all using (app_is_employee()) with check (app_is_employee());

-- ── お客様チャットに入れる人の判定を、この表で行う ──
create or replace function public.app_can_see_client_chat(p_project_id bigint)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project_clients c
    where c.project_id = p_project_id and c.user_id = auth.uid()
  ) or exists (
    select 1 from public.projects p
    where p.id = p_project_id and auth.uid() = any(p.client_chat_member_ids)
  )
$$;

-- ── お客様が自分のチャット一覧を引く ──
create or replace function public.app_my_client_chats()
returns table(project_id bigint, project_name text, member_names text[])
language sql stable security definer
set search_path = public
as $$
  select p.id, p.name, p.client_chat_member_names
  from public.projects p
  join public.project_clients c on c.project_id = p.id
  where c.user_id = auth.uid()
  order by p.id
$$;
grant execute on function public.app_my_client_chats() to authenticated;

-- 旧・1人ぶんの列はもう使わない（データは残す）
comment on column public.projects.client_user_id is '使用しない（project_clients に移した）';
comment on column public.projects.client_email is '使用しない（project_clients に移した）';

-- お客様が増えた・登録された、を相手の画面にもすぐ出す
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_clients'
  ) then
    execute 'alter publication supabase_realtime add table public.project_clients';
  end if;
end $$;
