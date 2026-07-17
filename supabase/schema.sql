-- 手寄アプリ：データベース構築スクリプト
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください

-- ════ テーブル ════

create table public.suppliers (
  id bigint generated always as identity primary key,
  name text not null,
  contact text default '',
  tel text default '',
  email text default '',
  cats text default '',
  note text default '',
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

create table public.master_items (
  id bigint generated always as identity primary key,
  cat text not null,
  name text not null,
  unit text not null default '式',
  price numeric not null default 0,
  cost numeric not null default 0,
  supplier_id bigint references public.suppliers(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

-- 案件マスタ（物件名・施主名・工事区分・現場住所・備考）。見積・受発注の親となるエンティティ
create table public.projects (
  id bigint generated always as identity primary key,
  name text not null,
  client_name text default '',
  type text default '新築',
  address text default '',
  note text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 工事区分（新築／リフォーム等）。追加・削除可能なマスタ
create table public.estimate_types (
  id bigint generated always as identity primary key,
  name text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);
insert into public.estimate_types (name, sort_order) values
  ('新築',0),('リフォーム',1),('増築',2),('外構',3),('その他',4)
on conflict (name) do nothing;

create table public.estimate_categories (
  id bigint generated always as identity primary key,
  name text not null,
  work_type text not null default '新築', -- 工事区分（新築／リフォーム等）。区分ごとに工種を分けて管理する
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

create table public.estimate_presets (
  id bigint generated always as identity primary key,
  cat text not null,
  name text not null,
  unit text not null default '式',
  cost numeric not null default 0,
  work_type text not null default '新築', -- 工事区分（新築／リフォーム等）。区分ごとに品目を分けて管理する
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

create table public.estimate_defaults (
  type text primary key,
  sections jsonb not null default '[]',
  updated_at timestamptz default now()
);

create table public.estimates (
  id bigint generated always as identity primary key,
  title text,
  no text,
  date date,
  expire date,
  status text default 'draft',
  type text,
  start_date date,
  end_date date,
  client_name text,
  project_name text,
  site_name text,
  note text,
  discount_amount numeric default 0,
  tax_rate numeric default 10,
  payments jsonb default '[]',
  sections jsonb default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.orders (
  id bigint generated always as identity primary key,
  no text,
  project text,
  date date,
  due_date date,
  cost_type text,
  supplier_id bigint references public.suppliers(id) on delete set null,
  items jsonb default '[]',
  subtotal numeric default 0,
  tax numeric default 0,
  total numeric default 0,
  status text default 'pending',
  created_at timestamptz default now()
);

create table public.cost_entries (
  id bigint generated always as identity primary key,
  date date,
  project text,
  name text,
  qty numeric,
  unit text,
  amount numeric,
  supplier_id bigint references public.suppliers(id) on delete set null,
  order_no text,
  cost_type text,
  status text default 'pending',
  created_at timestamptz default now()
);

create table public.chat_messages (
  id bigint generated always as identity primary key,
  supplier_id bigint references public.suppliers(id) on delete cascade,
  is_internal boolean not null default false, -- true＝社内チャット（きよかわ社員のみ。supplier_idはnull）
  role text not null, -- 'me'（きよかわ）/ 'them'（発注先）
  type text not null default 'text', -- 'text' / 'order' / 'file'
  text text,
  order_data jsonb,
  file_url text,
  file_name text,
  file_mime text,
  unread boolean default false,
  created_at timestamptz default now()
);

-- プッシュ通知の購読情報（端末ごとに1件）
create table public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

-- ユーザーのロール・所属発注先を管理するテーブル
-- staff = 社内（全権限）/ carpenter = 社員大工（現場ページのみ）/ supplier = 発注先（チャット＋自社品目の単価編集のみ）
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('staff','carpenter','supplier')),
  supplier_id bigint references public.suppliers(id) on delete set null,
  display_name text,
  created_at timestamptz default now()
);

-- ════ 現場管理（写真・図面・日報・有給） ════

-- 写真・図面の整理用フォルダ（parent_idで階層化。写真用と図面用をkindで区別）
create table public.site_folders (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('photo','drawing')),
  parent_id bigint references public.site_folders(id) on delete cascade,
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

-- 現場写真（工事ごとに撮影日つきで保存。画像本体はStorageのsite-filesバケット）
create table public.site_photos (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  folder_id bigint references public.site_folders(id) on delete set null,
  url text not null,
  caption text default '',
  shot_date date not null default ((now() at time zone 'Asia/Tokyo')::date),
  uploaded_by uuid references auth.users(id) on delete set null,
  uploader_name text default '',
  created_at timestamptz default now()
);

-- 図面（工事ごとのPDF・画像。本体はStorageのsite-filesバケット）
create table public.drawings (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  folder_id bigint references public.site_folders(id) on delete set null,
  file_url text not null,
  file_name text not null,
  file_mime text default '',
  note text default '',
  uploaded_by uuid references auth.users(id) on delete set null,
  uploader_name text default '',
  created_at timestamptz default now()
);

-- 図面の閲覧記録（1人1図面1行。開くたびに日時を更新）
create table public.drawing_views (
  id bigint generated always as identity primary key,
  drawing_id bigint not null references public.drawings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text default '',
  viewed_at timestamptz default now(),
  unique (drawing_id, user_id)
);

-- 日報（1人1日1件〜複数件。実働・残業は分単位で保存）
-- 残業（overtime_minutes > 0）は承認フローあり：ot_status = none / pending / approved / rejected
create table public.daily_reports (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text default '',
  work_date date not null,
  project_id bigint references public.projects(id) on delete set null,
  project_name text default '',
  content text default '',
  start_time text default '08:00',
  end_time text default '18:00',
  break_minutes integer not null default 120,
  work_minutes integer not null default 0,
  overtime_minutes integer not null default 0,
  ot_status text not null default 'none' check (ot_status in ('none','pending','approved','rejected')),
  ot_approver_name text default '', -- 申請時に選んだ承認者（この1人にだけ通知・リマインドされる）
  ot_reviewer_name text default '',
  ot_review_note text default '',
  ot_reviewed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 休日出勤申請（承認プロセスは残業と同様：申請時に承認者を1人指名）
create table public.holiday_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text default '',
  work_date date not null,
  project_id bigint references public.projects(id) on delete set null,
  project_name text default '',
  reason text default '',
  substitute_date date, -- 振替休日（任意）
  approver_name text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewer_name text default '',
  review_note text default '',
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

-- 有給申請（pending＝申請中 / approved＝承認 / rejected＝却下）。承認者は清川創史（アプリ側で固定）
create table public.leave_requests (
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

-- ════ ヘルパー関数（ポリシー内でのロール参照用） ════

create or replace function public.app_user_role() returns text
language sql stable security definer as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.app_supplier_id() returns bigint
language sql stable security definer as $$
  select supplier_id from public.profiles where id = auth.uid()
$$;

-- 社内（staff＋carpenter）判定。現場管理系のポリシーで使う
create or replace function public.app_is_employee() returns boolean
language sql stable security definer as $$
  select coalesce((select role in ('staff','carpenter') from public.profiles where id = auth.uid()), false)
$$;

-- 残業の承認者判定（js/genba/genba-nippo.js の OT_APPROVERS、
-- supabase/functions/ot-remind/index.ts の APPROVERS と合わせること）
create or replace function public.app_is_ot_approver() returns boolean
language sql stable security definer as $$
  select coalesce(
    (select display_name in ('清川創史','清川太視','清川説志','清川伸二','原口晴郎')
       from public.profiles where id = auth.uid()),
    false)
$$;

-- ════ RLS（行レベルセキュリティ）有効化 ════

alter table public.projects enable row level security;
alter table public.suppliers enable row level security;
alter table public.master_items enable row level security;
alter table public.estimate_types enable row level security;
alter table public.estimate_categories enable row level security;
alter table public.estimate_presets enable row level security;
alter table public.estimate_defaults enable row level security;
alter table public.estimates enable row level security;
alter table public.orders enable row level security;
alter table public.cost_entries enable row level security;
alter table public.chat_messages enable row level security;
alter table public.profiles enable row level security;
alter table public.site_photos enable row level security;
alter table public.drawings enable row level security;
alter table public.daily_reports enable row level security;
alter table public.leave_requests enable row level security;
alter table public.site_folders enable row level security;
alter table public.drawing_views enable row level security;
alter table public.holiday_requests enable row level security;

-- ════ projects（閲覧は社内全員＝staff＋carpenter。編集はstaffのみ） ════
create policy projects_select on public.projects for select using (app_is_employee());
create policy projects_insert on public.projects for insert with check (app_user_role() = 'staff');
create policy projects_update on public.projects for update using (app_user_role() = 'staff');
create policy projects_delete on public.projects for delete using (app_user_role() = 'staff');

-- ════ profiles ════
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or app_user_role() = 'staff');
create policy profiles_insert on public.profiles
  for insert with check (app_user_role() = 'staff');
create policy profiles_update on public.profiles
  for update using (app_user_role() = 'staff');

-- ════ suppliers ════
create policy suppliers_select on public.suppliers
  for select using (app_user_role() = 'staff' or id = app_supplier_id());
create policy suppliers_insert on public.suppliers
  for insert with check (app_user_role() = 'staff');
create policy suppliers_update on public.suppliers
  for update using (app_user_role() = 'staff');
create policy suppliers_delete on public.suppliers
  for delete using (app_user_role() = 'staff');

-- ════ master_items ════
create policy master_items_select on public.master_items
  for select using (app_user_role() = 'staff' or supplier_id = app_supplier_id());
create policy master_items_insert on public.master_items
  for insert with check (app_user_role() = 'staff');
create policy master_items_update on public.master_items
  for update using (app_user_role() = 'staff' or supplier_id = app_supplier_id());
create policy master_items_delete on public.master_items
  for delete using (app_user_role() = 'staff');

-- 発注先は価格(price)・原価(cost)以外のカラムを変更できないようにする（防御の多層化）
create or replace function public.restrict_supplier_item_update() returns trigger
language plpgsql security definer as $$
begin
  if app_user_role() = 'supplier' then
    if new.name <> old.name or new.cat <> old.cat or new.unit <> old.unit
       or new.supplier_id <> old.supplier_id or new.sort_order <> old.sort_order then
      raise exception '価格・原価以外の項目は編集できません';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_restrict_supplier_item_update
  before update on public.master_items
  for each row execute function public.restrict_supplier_item_update();

-- ════ estimates / orders / cost_entries（社内のみ） ════
create policy estimate_types_select on public.estimate_types for select using (app_user_role() = 'staff');
create policy estimate_types_insert on public.estimate_types for insert with check (app_user_role() = 'staff');
create policy estimate_types_update on public.estimate_types for update using (app_user_role() = 'staff');
create policy estimate_types_delete on public.estimate_types for delete using (app_user_role() = 'staff');

create policy estimate_categories_select on public.estimate_categories for select using (app_user_role() = 'staff');
create policy estimate_categories_insert on public.estimate_categories for insert with check (app_user_role() = 'staff');
create policy estimate_categories_update on public.estimate_categories for update using (app_user_role() = 'staff');
create policy estimate_categories_delete on public.estimate_categories for delete using (app_user_role() = 'staff');

create policy estimate_presets_select on public.estimate_presets for select using (app_user_role() = 'staff');
create policy estimate_presets_insert on public.estimate_presets for insert with check (app_user_role() = 'staff');
create policy estimate_presets_update on public.estimate_presets for update using (app_user_role() = 'staff');
create policy estimate_presets_delete on public.estimate_presets for delete using (app_user_role() = 'staff');

create policy estimate_defaults_select on public.estimate_defaults for select using (app_user_role() = 'staff');
create policy estimate_defaults_insert on public.estimate_defaults for insert with check (app_user_role() = 'staff');
create policy estimate_defaults_update on public.estimate_defaults for update using (app_user_role() = 'staff');
create policy estimate_defaults_delete on public.estimate_defaults for delete using (app_user_role() = 'staff');

create policy estimates_select on public.estimates for select using (app_user_role() = 'staff');
create policy estimates_insert on public.estimates for insert with check (app_user_role() = 'staff');
create policy estimates_update on public.estimates for update using (app_user_role() = 'staff');
create policy estimates_delete on public.estimates for delete using (app_user_role() = 'staff');

create policy orders_select on public.orders for select using (app_user_role() = 'staff');
create policy orders_insert on public.orders for insert with check (app_user_role() = 'staff');
create policy orders_update on public.orders for update using (app_user_role() = 'staff');
create policy orders_delete on public.orders for delete using (app_user_role() = 'staff');

create policy cost_entries_select on public.cost_entries for select using (app_user_role() = 'staff');
create policy cost_entries_insert on public.cost_entries for insert with check (app_user_role() = 'staff');
create policy cost_entries_update on public.cost_entries for update using (app_user_role() = 'staff');
create policy cost_entries_delete on public.cost_entries for delete using (app_user_role() = 'staff');

-- ════ chat_messages ════
-- 社内チャンネル（is_internal）＝社員（staff＋carpenter）のみ
-- 発注先チャンネル＝staffは全件・発注先は自社スレッドのみ
create policy chat_messages_select on public.chat_messages
  for select using (
    (is_internal and app_is_employee())
    or (not is_internal and (app_user_role() = 'staff' or supplier_id = app_supplier_id()))
  );
create policy chat_messages_insert on public.chat_messages
  for insert with check (
    (is_internal and app_is_employee())
    or (not is_internal and (app_user_role() = 'staff' or supplier_id = app_supplier_id()))
  );
create policy chat_messages_update on public.chat_messages
  for update using (
    (is_internal and app_is_employee())
    or (not is_internal and (app_user_role() = 'staff' or supplier_id = app_supplier_id()))
  );
create policy chat_messages_delete on public.chat_messages
  for delete using (
    (is_internal and app_is_employee())
    or (not is_internal and (app_user_role() = 'staff' or supplier_id = app_supplier_id()))
  );

-- ════ chat-files（チャットへの写真・PDF等の資料添付用ストレージ） ════
-- バケット自体はSupabaseダッシュボードのStorageで作成する（public、名前は chat-files）
insert into storage.buckets (id, name, public)
values ('chat-files', 'chat-files', true)
on conflict (id) do nothing;

drop policy if exists "chat_files_insert" on storage.objects;
create policy "chat_files_insert" on storage.objects
for insert to authenticated
with check (bucket_id = 'chat-files');

drop policy if exists "chat_files_select" on storage.objects;
create policy "chat_files_select" on storage.objects
for select to authenticated
using (bucket_id = 'chat-files');

-- ════ site_photos / drawings（閲覧・追加は社内全員。削除は本人またはstaff） ════
create policy site_photos_select on public.site_photos
  for select using (app_is_employee());
create policy site_photos_insert on public.site_photos
  for insert with check (app_is_employee() and uploaded_by = auth.uid());
create policy site_photos_update on public.site_photos
  for update using (app_user_role() = 'staff' or uploaded_by = auth.uid());
create policy site_photos_delete on public.site_photos
  for delete using (app_user_role() = 'staff' or uploaded_by = auth.uid());

create policy drawings_select on public.drawings
  for select using (app_is_employee());
create policy drawings_insert on public.drawings
  for insert with check (app_is_employee() and uploaded_by = auth.uid());
create policy drawings_update on public.drawings
  for update using (app_user_role() = 'staff' or uploaded_by = auth.uid());
create policy drawings_delete on public.drawings
  for delete using (app_user_role() = 'staff' or uploaded_by = auth.uid());

-- ════ site_folders（閲覧・作成は社内全員。変更・削除は作成者またはstaff） ════
create policy site_folders_select on public.site_folders
  for select using (app_is_employee());
create policy site_folders_insert on public.site_folders
  for insert with check (app_is_employee() and created_by = auth.uid());
create policy site_folders_update on public.site_folders
  for update using (app_user_role() = 'staff' or created_by = auth.uid());
create policy site_folders_delete on public.site_folders
  for delete using (app_user_role() = 'staff' or created_by = auth.uid());

-- ════ drawing_views（閲覧記録。自分の記録のみ書き込み可） ════
create policy drawing_views_select on public.drawing_views
  for select using (app_is_employee());
create policy drawing_views_insert on public.drawing_views
  for insert with check (app_is_employee() and user_id = auth.uid());
create policy drawing_views_update on public.drawing_views
  for update using (user_id = auth.uid());

-- ════ daily_reports（本人は自分の分のみ・staffと残業承認者は全件） ════
create policy daily_reports_select on public.daily_reports
  for select using (app_user_role() = 'staff' or user_id = auth.uid() or app_is_ot_approver());
create policy daily_reports_insert on public.daily_reports
  for insert with check (app_is_employee() and user_id = auth.uid());
create policy daily_reports_update on public.daily_reports
  for update using (app_user_role() = 'staff' or user_id = auth.uid() or app_is_ot_approver());
create policy daily_reports_delete on public.daily_reports
  for delete using (app_user_role() = 'staff' or user_id = auth.uid());

-- ════ holiday_requests（本人は自分の申請のみ・staffと承認者は全件＋承認操作） ════
create policy holiday_requests_select on public.holiday_requests
  for select using (app_user_role() = 'staff' or user_id = auth.uid() or app_is_ot_approver());
create policy holiday_requests_insert on public.holiday_requests
  for insert with check (app_is_employee() and user_id = auth.uid());
create policy holiday_requests_update on public.holiday_requests
  for update using (app_user_role() = 'staff' or app_is_ot_approver() or (user_id = auth.uid() and status = 'pending'));
create policy holiday_requests_delete on public.holiday_requests
  for delete using (app_user_role() = 'staff' or (user_id = auth.uid() and status = 'pending'));

-- ════ leave_requests（本人は自分の申請のみ・staffは全件＋承認操作） ════
create policy leave_requests_select on public.leave_requests
  for select using (app_user_role() = 'staff' or user_id = auth.uid());
create policy leave_requests_insert on public.leave_requests
  for insert with check (app_is_employee() and user_id = auth.uid());
-- 承認・却下はstaff。本人は申請中（pending）の間だけ内容変更可
create policy leave_requests_update on public.leave_requests
  for update using (app_user_role() = 'staff' or (user_id = auth.uid() and status = 'pending'));
-- 取り下げは本人（pendingのみ）またはstaff
create policy leave_requests_delete on public.leave_requests
  for delete using (app_user_role() = 'staff' or (user_id = auth.uid() and status = 'pending'));

-- ════ site-files（現場写真・図面のストレージ。書き込みは社内のみ） ════
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

-- ════ push_subscriptions（自分の端末の購読のみ操作可。送信処理はEdge Functionがservice roleで参照） ════
alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_select on public.push_subscriptions
  for select using (auth.uid() = user_id);
create policy push_subscriptions_insert on public.push_subscriptions
  for insert with check (auth.uid() = user_id);
create policy push_subscriptions_update on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy push_subscriptions_delete on public.push_subscriptions
  for delete using (auth.uid() = user_id);

-- ════ マイグレーション：工種・工事品目マスタに工事区分（新築／リフォーム等）を追加 ════
-- 既存環境にこのテーブルが既に存在する場合は、SQL Editorで以下を実行してください
-- （既存の行はすべてデフォルト値「新築」になります）
-- alter table public.estimate_categories add column if not exists work_type text not null default '新築';
-- alter table public.estimate_presets add column if not exists work_type text not null default '新築';

-- ════ マイグレーション：工事区分マスタ（追加・削除可能化） ════
-- 既存環境では以下を実行してください
-- create table public.estimate_types (
--   id bigint generated always as identity primary key,
--   name text not null unique,
--   sort_order integer not null default 0,
--   created_at timestamptz default now()
-- );
-- insert into public.estimate_types (name, sort_order) values
--   ('新築',0),('リフォーム',1),('増築',2),('外構',3),('その他',4)
-- on conflict (name) do nothing;
-- alter table public.estimate_types enable row level security;
-- create policy estimate_types_select on public.estimate_types for select using (app_user_role() = 'staff');
-- create policy estimate_types_insert on public.estimate_types for insert with check (app_user_role() = 'staff');
-- create policy estimate_types_update on public.estimate_types for update using (app_user_role() = 'staff');
-- create policy estimate_types_delete on public.estimate_types for delete using (app_user_role() = 'staff');

-- ════ マイグレーション：見積に更新日時を追加（案件一覧の並び替え用） ════
-- 既存環境では以下を実行してください
-- alter table public.estimates add column if not exists updated_at timestamptz default now();
-- update public.estimates set updated_at = created_at where updated_at is null;

-- ════ マイグレーション：案件マスタテーブルを追加 ════
-- 既存環境では以下を実行してください
-- create table public.projects (
--   id bigint generated always as identity primary key,
--   name text not null,
--   client_name text default '',
--   type text default '新築',
--   address text default '',
--   note text default '',
--   created_at timestamptz default now(),
--   updated_at timestamptz default now()
-- );
-- alter table public.projects enable row level security;
-- create policy projects_select on public.projects for select using (app_user_role() = 'staff');
-- create policy projects_insert on public.projects for insert with check (app_user_role() = 'staff');
-- create policy projects_update on public.projects for update using (app_user_role() = 'staff');
-- create policy projects_delete on public.projects for delete using (app_user_role() = 'staff');

-- ════ Realtime（複数端末への即時反映） ════
alter publication supabase_realtime add table public.suppliers;
alter publication supabase_realtime add table public.master_items;
alter publication supabase_realtime add table public.estimates;
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.cost_entries;
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.site_photos;
alter publication supabase_realtime add table public.drawings;
alter publication supabase_realtime add table public.daily_reports;
alter publication supabase_realtime add table public.leave_requests;
alter publication supabase_realtime add table public.site_folders;
alter publication supabase_realtime add table public.drawing_views;
alter publication supabase_realtime add table public.holiday_requests;
