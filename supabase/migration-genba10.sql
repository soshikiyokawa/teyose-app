-- ════ マイグレーション⑩：勤務カレンダー（出勤日）＋社員区分 ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）

-- ── 1. profilesに社員区分を追加 ──
-- 役員／一般社員／訓練校生。空＝勤怠の対象外。カレンダーは 訓練校生→trainee、他→regular
alter table public.profiles add column if not exists work_group text default '';

-- 既知の8名の区分を設定（表示名で照合。display_nameが一致している必要があります）
update public.profiles set work_group = '役員'
  where display_name in ('清川創史','清川太視','清川説志','清川伸二');
update public.profiles set work_group = '一般社員'
  where display_name in ('原口晴郎','山口大輔','梅田昭文');
update public.profiles set work_group = '訓練校生'
  where display_name in ('石橋実咲','梶原大地');

-- ── 2. 勤務カレンダーの休日テーブル ──
-- 1行 ＝ そのカレンダーの「休日（出勤しない日）」。出勤日 ＝ この表に無い日
-- cal: 'regular'（役員・一般社員）／'trainee'（訓練校生）
create table if not exists public.work_holidays (
  cal text not null check (cal in ('regular','trainee')),
  holiday_date date not null,
  note text default '',
  primary key (cal, holiday_date)
);

alter table public.work_holidays enable row level security;

-- 閲覧は社内全員、編集は事務（staff）のみ
drop policy if exists work_holidays_select on public.work_holidays;
drop policy if exists work_holidays_insert on public.work_holidays;
drop policy if exists work_holidays_update on public.work_holidays;
drop policy if exists work_holidays_delete on public.work_holidays;
create policy work_holidays_select on public.work_holidays
  for select using (app_is_employee());
create policy work_holidays_insert on public.work_holidays
  for insert with check (app_user_role() = 'staff');
create policy work_holidays_update on public.work_holidays
  for update using (app_user_role() = 'staff');
create policy work_holidays_delete on public.work_holidays
  for delete using (app_user_role() = 'staff');

-- ── 3. Realtime（複数端末への即時反映） ──
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'work_holidays'
  ) then
    execute 'alter publication supabase_realtime add table public.work_holidays';
  end if;
end $$;
