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

create table public.estimate_categories (
  id bigint generated always as identity primary key,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

create table public.estimate_presets (
  id bigint generated always as identity primary key,
  cat text not null,
  name text not null,
  unit text not null default '式',
  cost numeric not null default 0,
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
  created_at timestamptz default now()
);

create table public.orders (
  id bigint generated always as identity primary key,
  no text,
  project text,
  date date,
  due_date date,
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
  status text default 'pending',
  created_at timestamptz default now()
);

create table public.chat_messages (
  id bigint generated always as identity primary key,
  supplier_id bigint references public.suppliers(id) on delete cascade,
  role text not null, -- 'me'（きよかわ）/ 'them'（発注先）
  type text not null default 'text', -- 'text' / 'order'
  text text,
  order_data jsonb,
  unread boolean default false,
  created_at timestamptz default now()
);

-- ユーザーのロール・所属発注先を管理するテーブル
-- staff = 社内（全権限）/ supplier = 発注先（チャット＋自社品目の単価編集のみ）
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('staff','supplier')),
  supplier_id bigint references public.suppliers(id) on delete set null,
  display_name text,
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

-- ════ RLS（行レベルセキュリティ）有効化 ════

alter table public.suppliers enable row level security;
alter table public.master_items enable row level security;
alter table public.estimate_categories enable row level security;
alter table public.estimate_presets enable row level security;
alter table public.estimate_defaults enable row level security;
alter table public.estimates enable row level security;
alter table public.orders enable row level security;
alter table public.cost_entries enable row level security;
alter table public.chat_messages enable row level security;
alter table public.profiles enable row level security;

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

-- ════ chat_messages（社内は全件・発注先は自社スレッドのみ） ════
create policy chat_messages_select on public.chat_messages
  for select using (app_user_role() = 'staff' or supplier_id = app_supplier_id());
create policy chat_messages_insert on public.chat_messages
  for insert with check (app_user_role() = 'staff' or supplier_id = app_supplier_id());
create policy chat_messages_update on public.chat_messages
  for update using (app_user_role() = 'staff' or supplier_id = app_supplier_id());
create policy chat_messages_delete on public.chat_messages
  for delete using (app_user_role() = 'staff' or supplier_id = app_supplier_id());

-- ════ Realtime（複数端末への即時反映） ════
alter publication supabase_realtime add table public.suppliers;
alter publication supabase_realtime add table public.master_items;
alter publication supabase_realtime add table public.estimates;
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.cost_entries;
alter publication supabase_realtime add table public.chat_messages;
