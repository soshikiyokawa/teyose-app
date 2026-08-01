-- ════ マイグレーション㉖：車両管理（車検・オイル交換・タイヤ交換） ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 会社所有の車両ごとに、車検満了日と点検責任者を登録し、
-- 車検・オイル交換・夏／冬タイヤ交換の実施記録を残す。
-- 期限や実施時期が来たら点検責任者へ通知する（vehicle-remind）。

-- ── 1. 車両 ──
create table if not exists public.vehicles (
  id bigint generated always as identity primary key,
  name text not null,                 -- 車両名（例：ハイエース①）
  plate text default '',              -- ナンバー
  manager_name text default '',       -- 点検責任者（profiles.display_name）
  inspection_date date,               -- 車検満了日
  note text default '',
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── 2. 実施記録（車検・オイル交換・夏タイヤ・冬タイヤ） ──
create table if not exists public.vehicle_records (
  id bigint generated always as identity primary key,
  vehicle_id bigint not null references public.vehicles(id) on delete cascade,
  kind text not null check (kind in ('車検','オイル交換','夏タイヤ','冬タイヤ')),
  done_date date not null,            -- 実施日
  next_date date,                     -- 次回の期限（車検のみ使う）
  odo int,                            -- 走行距離（任意）
  note text default '',
  user_name text default '',          -- 登録した人
  created_at timestamptz default now()
);

create index if not exists vehicle_records_vehicle_idx on public.vehicle_records(vehicle_id, kind, done_date desc);

-- ── 3. RLS：社内（staff＋carpenter）は参照・記録できる。車両の登録・変更は管理者のみ ──
alter table public.vehicles enable row level security;
alter table public.vehicle_records enable row level security;

drop policy if exists vehicles_select on public.vehicles;
create policy vehicles_select on public.vehicles for select using (app_is_employee());
drop policy if exists vehicles_insert on public.vehicles;
create policy vehicles_insert on public.vehicles for insert with check (app_user_role() = 'staff');
drop policy if exists vehicles_update on public.vehicles;
create policy vehicles_update on public.vehicles for update using (app_user_role() = 'staff');
drop policy if exists vehicles_delete on public.vehicles;
create policy vehicles_delete on public.vehicles for delete using (app_user_role() = 'staff');

drop policy if exists vehicle_records_select on public.vehicle_records;
create policy vehicle_records_select on public.vehicle_records for select using (app_is_employee());
drop policy if exists vehicle_records_insert on public.vehicle_records;
create policy vehicle_records_insert on public.vehicle_records for insert with check (app_is_employee());
drop policy if exists vehicle_records_update on public.vehicle_records;
create policy vehicle_records_update on public.vehicle_records for update using (app_is_employee());
drop policy if exists vehicle_records_delete on public.vehicle_records;
create policy vehicle_records_delete on public.vehicle_records for delete using (app_user_role() = 'staff');

-- ── 4. Realtime ──
do $$
declare t text;
begin
  foreach t in array array['vehicles','vehicle_records'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ── 5. 通知（毎日9時JST＝0時UTCに vehicle-remind を呼ぶ） ──
-- 先に Edge Function をデプロイしてください：
--   supabase functions deploy vehicle-remind --no-verify-jwt
select cron.unschedule('vehicle-remind-daily') where exists (
  select 1 from cron.job where jobname = 'vehicle-remind-daily'
);
select cron.schedule(
  'vehicle-remind-daily',
  '0 0 * * *',
  $$
  select net.http_post(
    url     := 'https://uotzxrwtzlpdnpfbaqpi.supabase.co/functions/v1/vehicle-remind',
    headers := '{"Content-Type": "application/json", "x-remind-secret": "0bf6fb2a4cdbb06f967ac194fb2f169de0d6ec0b483c7919"}'::jsonb,
    body    := '{}'::jsonb
  )
  $$
);
