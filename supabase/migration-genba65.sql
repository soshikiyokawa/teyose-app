-- ════ 日報に写真を付けられるようにする（任意） ════
--
-- 現場写真（site_photos）は「案件の記録」として残すもの。
-- こちらは「その日の作業の記録」で、日報とセットで見るもの。
-- 日報を消したら写真も消える（on delete cascade）。
--
-- ファイルそのものは現場写真と同じ site-files バケットの nippo/ に置く。
-- 保管場所の許可は既にあるので、新しく足す必要はない。

create table if not exists public.nippo_photos (
  id bigint generated always as identity primary key,
  report_id bigint not null references public.daily_reports(id) on delete cascade,
  url text not null,
  caption text not null default '',
  sort_order integer not null default 0,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploader_name text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists nippo_photos_report_idx
  on public.nippo_photos(report_id, sort_order, id);

comment on table public.nippo_photos is
  '日報に付ける写真。その日の作業の記録。日報を消すと一緒に消える';

alter table public.nippo_photos enable row level security;

-- 見えるのは社内の人。日報そのものが社内に公開されているのと同じ範囲
drop policy if exists nippo_photos_select on public.nippo_photos;
create policy nippo_photos_select on public.nippo_photos
  for select using (app_is_employee());

-- 足す・消せるのは、その日報を直せる人（本人・管理者・代理入力できる人）
drop policy if exists nippo_photos_write on public.nippo_photos;
create policy nippo_photos_write on public.nippo_photos
  for all
  using (exists (
    select 1 from public.daily_reports d
    where d.id = nippo_photos.report_id
      and (app_user_role() = 'staff' or d.user_id = auth.uid() or app_is_nippo_editor())))
  with check (exists (
    select 1 from public.daily_reports d
    where d.id = nippo_photos.report_id
      and (app_user_role() = 'staff' or d.user_id = auth.uid() or app_is_nippo_editor())));
