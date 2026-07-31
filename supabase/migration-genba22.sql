-- ════ マイグレーション㉒：免許・自動車保険の管理 ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 社員ごとに運転免許証（番号・有効期限）と自動車保険（対人・対物補償額・満了日）を登録し、
-- 撮影した証拠写真を保存する。有効期限の1か月前・2週間前・1週間前に本人へ通知する。

-- ── 1. テーブル（1人1行） ──
create table if not exists public.licenses (
  user_id uuid primary key references auth.users(id) on delete cascade,
  user_name text default '',
  -- 運転免許証
  license_no text default '',
  license_expire date,
  license_photo text default '',        -- license-files バケット内のパス
  -- 自動車保険
  insurer text default '',              -- 保険会社名
  liability_person text default '',     -- 対人賠償（例：無制限）
  liability_object text default '',     -- 対物賠償（例：無制限／3,000万円）
  insurance_expire date,                -- 保険期間の満了日
  insurance_photo text default '',
  note text default '',
  updated_at timestamptz default now(),
  updated_by text default ''
);

-- ── 2. RLS（本人と管理者だけが見られる。個人情報のため他の社員には見せない） ──
alter table public.licenses enable row level security;

drop policy if exists licenses_select on public.licenses;
create policy licenses_select on public.licenses
  for select using (user_id = auth.uid() or app_user_role() = 'staff');

drop policy if exists licenses_insert on public.licenses;
create policy licenses_insert on public.licenses
  for insert with check (user_id = auth.uid() or app_user_role() = 'staff');

drop policy if exists licenses_update on public.licenses;
create policy licenses_update on public.licenses
  for update using (user_id = auth.uid() or app_user_role() = 'staff');

drop policy if exists licenses_delete on public.licenses;
create policy licenses_delete on public.licenses
  for delete using (app_user_role() = 'staff');

-- ── 3. ストレージ（証拠写真。免許証は個人情報なので「非公開」バケットにする） ──
insert into storage.buckets (id, name, public)
values ('license-files', 'license-files', false)
on conflict (id) do update set public = false;

-- ファイルは「<自分のuser_id>/ファイル名」に置く。本人と管理者だけが読み書きできる。
drop policy if exists "license_files_insert" on storage.objects;
create policy "license_files_insert" on storage.objects
for insert to authenticated
with check (bucket_id = 'license-files'
  and (app_user_role() = 'staff' or (storage.foldername(name))[1] = auth.uid()::text));

drop policy if exists "license_files_select" on storage.objects;
create policy "license_files_select" on storage.objects
for select to authenticated
using (bucket_id = 'license-files'
  and (app_user_role() = 'staff' or (storage.foldername(name))[1] = auth.uid()::text));

drop policy if exists "license_files_delete" on storage.objects;
create policy "license_files_delete" on storage.objects
for delete to authenticated
using (bucket_id = 'license-files'
  and (app_user_role() = 'staff' or (storage.foldername(name))[1] = auth.uid()::text));

-- ── 4. Realtime（複数端末への即時反映） ──
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'licenses'
  ) then
    alter publication supabase_realtime add table public.licenses;
  end if;
end $$;

-- ── 5. 期限の通知（毎日9時JST＝0時UTCに license-remind を呼ぶ） ──
-- 先に Edge Function をデプロイしてください：supabase functions deploy license-remind
select cron.unschedule('license-remind-daily') where exists (
  select 1 from cron.job where jobname = 'license-remind-daily'
);
select cron.schedule(
  'license-remind-daily',
  '0 0 * * *',
  $$
  select net.http_post(
    url     := 'https://uotzxrwtzlpdnpfbaqpi.supabase.co/functions/v1/license-remind',
    headers := '{"Content-Type": "application/json", "x-remind-secret": "0bf6fb2a4cdbb06f967ac194fb2f169de0d6ec0b483c7919"}'::jsonb,
    body    := '{}'::jsonb
  )
  $$
);
