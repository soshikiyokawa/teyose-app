-- ════ 給与の登録と、現場への労務費の振り分け（清川創史・清川優香のみ） ════
--
-- 社員ごとに月々の給与を登録しておくと、その月度の日報（実働時間）の割合で
-- 現場ごとの労務費を出せる。給与は他の社員には一切見えないようにする。
--
--  労務費に入れる5項目 … 基本給・家族手当・役付手当・技能・資格手当・固定残業代
--  労務費に入れない2項目… 非課税通勤手当・非課税車両借上料
--
-- 給与は変わるので「いつから適用するか（月度）」を持たせて履歴で残す。
-- ある月度の給与＝その月度以前でいちばん新しい行。

create or replace function public.app_is_payroll_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select display_name in ('清川創史','清川優香') from public.profiles where id = auth.uid()),
    false)
$$;

create table if not exists public.employee_salaries (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text default '',
  -- 適用開始の月度 'YYYY-MM'（日報・出面表と同じ20日締めの月度）
  effective_month text not null check (effective_month ~ '^\d{4}-\d{2}$'),
  base_pay           integer not null default 0,  -- 基本給
  family_allowance   integer not null default 0,  -- 家族手当
  position_allowance integer not null default 0,  -- 役付手当
  skill_allowance    integer not null default 0,  -- 技能・資格手当
  fixed_overtime     integer not null default 0,  -- 固定残業代
  commute_allowance  integer not null default 0,  -- 非課税通勤手当（労務費に入れない）
  vehicle_allowance  integer not null default 0,  -- 非課税車両借上料（労務費に入れない）
  note text default '',
  updated_by text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, effective_month)
);

create index if not exists employee_salaries_user_month_idx
  on public.employee_salaries (user_id, effective_month desc);

alter table public.employee_salaries enable row level security;

-- 清川創史・清川優香だけが読み書きできる。他の社員には1行も返らない
drop policy if exists employee_salaries_all on public.employee_salaries;
create policy employee_salaries_all on public.employee_salaries
  for all using (app_is_payroll_admin()) with check (app_is_payroll_admin());
