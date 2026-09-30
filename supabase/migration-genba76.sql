-- ════ レシート台帳 ════
--
-- これまで、レシートは読み取って発注（支払済みの記録）に起こしたあと、
-- 写真そのものは捨てていた。あとから「この支出の元のレシートを見たい」と
-- なったときに何も残っていない。
--
-- 整えたレシートの画像と、読み取った内容（日付・店名・税率ごとの内訳）を残し、
-- 日付順の台帳として見られるようにする。

create table if not exists public.receipts (
  id             bigint generated always as identity primary key,
  order_no       text not null default '',      -- 起こした発注の番号（つながりを見るため）
  paid_on        date not null,                 -- レシートの日付（買った日）
  shop           text not null default '',       -- 店名
  project        text not null default '',       -- 案件（「経費」など）
  cost_type      text not null default '',       -- 勘定科目・費目区分
  payment_method text not null default '',       -- 支払方法
  subtotal       integer not null default 0,     -- 税抜
  tax            integer not null default 0,     -- 消費税
  total          integer not null default 0,     -- 税込（レシートの支払額）
  tax_rows       jsonb  not null default '[]',   -- 税率ごとの内訳 [{rate,base,tax,incl}]
  items          jsonb  not null default '[]',   -- 品目
  file_path      text not null default '',       -- 整えた画像の置き場所（receipts バケット）
  note           text not null default '',
  created_by     uuid references auth.users(id) on delete set null,
  created_by_name text not null default '',
  created_at     timestamptz not null default now()
);

comment on table public.receipts is 'レシート台帳。整えた画像と読み取った内容を日付順に残す';

create index if not exists receipts_paid_on_idx on public.receipts(paid_on desc);
create index if not exists receipts_order_no_idx on public.receipts(order_no);

-- ── 見られる範囲：きよかわの社員だけ（お客様・業者には見せない） ──
alter table public.receipts enable row level security;

drop policy if exists receipts_select on public.receipts;
create policy receipts_select on public.receipts
  for select using (app_is_employee());

drop policy if exists receipts_write on public.receipts;
create policy receipts_write on public.receipts
  for all using (app_is_employee()) with check (app_is_employee());

-- ── 画像の置き場所（公開しない。見るときだけ期限付きのリンクを作る） ──
insert into storage.buckets (id, name, public, file_size_limit)
values ('receipts', 'receipts', false, 10485760)
on conflict (id) do nothing;

drop policy if exists receipts_files_select on storage.objects;
create policy receipts_files_select on storage.objects
  for select using (bucket_id = 'receipts' and app_is_employee());

drop policy if exists receipts_files_insert on storage.objects;
create policy receipts_files_insert on storage.objects
  for insert with check (bucket_id = 'receipts' and app_is_employee());

drop policy if exists receipts_files_delete on storage.objects;
create policy receipts_files_delete on storage.objects
  for delete using (bucket_id = 'receipts' and app_user_role() = 'staff');
