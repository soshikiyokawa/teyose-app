-- ════ マイグレーション㊱：案件ごとの予実（予算と実績の比較） ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 原価管理に「見積の原価＝予算」と「実際にかかった原価」を並べて出すため、
-- 会社共通の設定（1人工あたりの労務費など）を置く場所を作る。

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  updated_by text default ''
);

comment on table public.app_settings is '会社共通の設定。key＝設定名、value＝内容';

alter table public.app_settings enable row level security;

-- 社内（staff＋carpenter）は参照できる。変更は管理者のみ
drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select using (app_is_employee());
drop policy if exists app_settings_insert on public.app_settings;
create policy app_settings_insert on public.app_settings
  for insert with check (app_user_role() = 'staff');
drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_update on public.app_settings
  for update using (app_user_role() = 'staff');

-- 1人工（実働8時間）あたりの労務費。原価管理の実績に足して本当の粗利を出す
insert into public.app_settings (key, value)
values ('labor_cost_per_ninku', '{"amount": 0}'::jsonb)
on conflict (key) do nothing;
