-- ════ マイグレーション㉙：定期点検の実施記録 ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 点検の予定日は「引渡日＋3か月／1年／3年／5年／10年／15年／20年」で自動計算するため、
-- ここに保存するのは「実施した記録」だけ。引渡日を直せば予定日も自動で直る。

create table if not exists public.inspection_records (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  kind text not null,                 -- '3か月' '1年' '3年' '5年' '10年' '15年' '20年'
  done_date date not null,            -- 実施日
  note text default '',
  user_name text default '',          -- 登録した人
  created_at timestamptz default now(),
  unique (project_id, kind)           -- 同じ点検は1件だけ
);

create index if not exists inspection_records_project_idx on public.inspection_records(project_id);

-- 社内（staff＋carpenter）は参照・記録できる。削除は管理者のみ
alter table public.inspection_records enable row level security;

drop policy if exists inspection_records_select on public.inspection_records;
create policy inspection_records_select on public.inspection_records for select using (app_is_employee());
drop policy if exists inspection_records_insert on public.inspection_records;
create policy inspection_records_insert on public.inspection_records for insert with check (app_is_employee());
drop policy if exists inspection_records_update on public.inspection_records;
create policy inspection_records_update on public.inspection_records for update using (app_is_employee());
drop policy if exists inspection_records_delete on public.inspection_records;
create policy inspection_records_delete on public.inspection_records for delete using (app_user_role() = 'staff');

-- 複数端末への即時反映
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inspection_records'
  ) then
    alter publication supabase_realtime add table public.inspection_records;
  end if;
end $$;
