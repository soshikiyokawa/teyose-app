-- ════ マイグレーション②：現場写真・図面のフォルダ整理＋図面の閲覧記録 ════
-- Supabaseダッシュボード → SQL Editor に全文貼り付けて実行してください。
-- （再実行しても安全です）

-- ── 1. フォルダ（写真用・図面用共通。parent_idで階層化） ──
create table if not exists public.site_folders (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('photo','drawing')),
  parent_id bigint references public.site_folders(id) on delete cascade,
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

-- ── 2. 写真・図面にフォルダを紐づけ（フォルダ削除時は未分類に戻る） ──
alter table public.site_photos add column if not exists folder_id bigint references public.site_folders(id) on delete set null;
alter table public.drawings add column if not exists folder_id bigint references public.site_folders(id) on delete set null;

-- ── 3. 図面の閲覧記録（1人1図面1行。開くたびに日時を更新） ──
create table if not exists public.drawing_views (
  id bigint generated always as identity primary key,
  drawing_id bigint not null references public.drawings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text default '',
  viewed_at timestamptz default now(),
  unique (drawing_id, user_id)
);

-- ── 4. RLS ──
alter table public.site_folders enable row level security;
alter table public.drawing_views enable row level security;

drop policy if exists site_folders_select on public.site_folders;
drop policy if exists site_folders_insert on public.site_folders;
drop policy if exists site_folders_update on public.site_folders;
drop policy if exists site_folders_delete on public.site_folders;
create policy site_folders_select on public.site_folders
  for select using (app_is_employee());
create policy site_folders_insert on public.site_folders
  for insert with check (app_is_employee() and created_by = auth.uid());
create policy site_folders_update on public.site_folders
  for update using (app_user_role() = 'staff' or created_by = auth.uid());
create policy site_folders_delete on public.site_folders
  for delete using (app_user_role() = 'staff' or created_by = auth.uid());

drop policy if exists drawing_views_select on public.drawing_views;
drop policy if exists drawing_views_insert on public.drawing_views;
drop policy if exists drawing_views_update on public.drawing_views;
create policy drawing_views_select on public.drawing_views
  for select using (app_is_employee());
create policy drawing_views_insert on public.drawing_views
  for insert with check (app_is_employee() and user_id = auth.uid());
create policy drawing_views_update on public.drawing_views
  for update using (user_id = auth.uid());

-- ── 5. Realtime（登録済みのテーブルはスキップ） ──
do $$
declare t text;
begin
  foreach t in array array['site_folders','drawing_views'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
