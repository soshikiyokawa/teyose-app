-- ════ マイグレーション：現場管理（写真・図面・日報・有給）＋大工ロール ════
-- 既存環境用。Supabaseダッシュボード → SQL Editor に全文貼り付けて実行してください。
-- （新規構築の場合はschema.sqlに同じ内容が含まれているため実行不要）

-- ── 1. profilesのロールに carpenter（社員大工）を追加 ──
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('staff','carpenter','supplier'));

-- ── 2. 社内（staff＋carpenter）判定ヘルパー ──
create or replace function public.app_is_employee() returns boolean
language sql stable security definer as $$
  select coalesce((select role in ('staff','carpenter') from public.profiles where id = auth.uid()), false)
$$;

-- ── 3. 案件マスタの閲覧を大工にも開放（編集はstaffのまま） ──
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select using (app_is_employee());

-- ── 4. 現場写真 ──
create table if not exists public.site_photos (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  url text not null,
  caption text default '',
  shot_date date not null default ((now() at time zone 'Asia/Tokyo')::date),
  uploaded_by uuid references auth.users(id) on delete set null,
  uploader_name text default '',
  created_at timestamptz default now()
);

-- ── 5. 図面 ──
create table if not exists public.drawings (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  file_url text not null,
  file_name text not null,
  file_mime text default '',
  note text default '',
  uploaded_by uuid references auth.users(id) on delete set null,
  uploader_name text default '',
  created_at timestamptz default now()
);

-- ── 6. 日報 ──
create table if not exists public.daily_reports (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text default '',
  work_date date not null,
  project_id bigint references public.projects(id) on delete set null,
  project_name text default '',
  content text default '',
  start_time text default '08:00',
  end_time text default '17:00',
  break_minutes integer not null default 60,
  work_minutes integer not null default 0,
  overtime_minutes integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── 7. 有給申請 ──
create table if not exists public.leave_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text default '',
  start_date date not null,
  end_date date not null,
  leave_type text not null default '全日', -- 全日／午前半休／午後半休
  days numeric not null default 1,
  reason text default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewer_name text default '',
  review_note text default '',
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

-- ── 8. RLS ──
alter table public.site_photos enable row level security;
alter table public.drawings enable row level security;
alter table public.daily_reports enable row level security;
alter table public.leave_requests enable row level security;

drop policy if exists site_photos_select on public.site_photos;
drop policy if exists site_photos_insert on public.site_photos;
drop policy if exists site_photos_update on public.site_photos;
drop policy if exists site_photos_delete on public.site_photos;
create policy site_photos_select on public.site_photos
  for select using (app_is_employee());
create policy site_photos_insert on public.site_photos
  for insert with check (app_is_employee() and uploaded_by = auth.uid());
create policy site_photos_update on public.site_photos
  for update using (app_user_role() = 'staff' or uploaded_by = auth.uid());
create policy site_photos_delete on public.site_photos
  for delete using (app_user_role() = 'staff' or uploaded_by = auth.uid());

drop policy if exists drawings_select on public.drawings;
drop policy if exists drawings_insert on public.drawings;
drop policy if exists drawings_update on public.drawings;
drop policy if exists drawings_delete on public.drawings;
create policy drawings_select on public.drawings
  for select using (app_is_employee());
create policy drawings_insert on public.drawings
  for insert with check (app_is_employee() and uploaded_by = auth.uid());
create policy drawings_update on public.drawings
  for update using (app_user_role() = 'staff' or uploaded_by = auth.uid());
create policy drawings_delete on public.drawings
  for delete using (app_user_role() = 'staff' or uploaded_by = auth.uid());

drop policy if exists daily_reports_select on public.daily_reports;
drop policy if exists daily_reports_insert on public.daily_reports;
drop policy if exists daily_reports_update on public.daily_reports;
drop policy if exists daily_reports_delete on public.daily_reports;
create policy daily_reports_select on public.daily_reports
  for select using (app_user_role() = 'staff' or user_id = auth.uid());
create policy daily_reports_insert on public.daily_reports
  for insert with check (app_is_employee() and user_id = auth.uid());
create policy daily_reports_update on public.daily_reports
  for update using (app_user_role() = 'staff' or user_id = auth.uid());
create policy daily_reports_delete on public.daily_reports
  for delete using (app_user_role() = 'staff' or user_id = auth.uid());

drop policy if exists leave_requests_select on public.leave_requests;
drop policy if exists leave_requests_insert on public.leave_requests;
drop policy if exists leave_requests_update on public.leave_requests;
drop policy if exists leave_requests_delete on public.leave_requests;
create policy leave_requests_select on public.leave_requests
  for select using (app_user_role() = 'staff' or user_id = auth.uid());
create policy leave_requests_insert on public.leave_requests
  for insert with check (app_is_employee() and user_id = auth.uid());
create policy leave_requests_update on public.leave_requests
  for update using (app_user_role() = 'staff' or (user_id = auth.uid() and status = 'pending'));
create policy leave_requests_delete on public.leave_requests
  for delete using (app_user_role() = 'staff' or (user_id = auth.uid() and status = 'pending'));

-- ── 9. ストレージ（現場写真・図面） ──
insert into storage.buckets (id, name, public)
values ('site-files', 'site-files', true)
on conflict (id) do nothing;

drop policy if exists "site_files_insert" on storage.objects;
create policy "site_files_insert" on storage.objects
for insert to authenticated
with check (bucket_id = 'site-files' and app_is_employee());

drop policy if exists "site_files_select" on storage.objects;
create policy "site_files_select" on storage.objects
for select to authenticated
using (bucket_id = 'site-files' and app_is_employee());

drop policy if exists "site_files_delete" on storage.objects;
create policy "site_files_delete" on storage.objects
for delete to authenticated
using (bucket_id = 'site-files' and app_is_employee());

-- ── 10. Realtime（複数端末への即時反映） ──
-- 登録済みのテーブルはスキップする（再実行してもエラーにならない）
do $$
declare t text;
begin
  foreach t in array array['site_photos','drawings','daily_reports','leave_requests'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
