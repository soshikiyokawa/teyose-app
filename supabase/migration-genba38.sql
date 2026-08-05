-- ════ マイグレーション㊳：発注書の受領ボタンと、請求書の送付 ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 1. 発注先が、チャットに届いた発注書に「受領しました」と返せるようにする
--    （変えられるのは受領の印だけ。金額や品目は書き換えられない）
-- 2. 発注先が請求書（PDF・写真）を月ごとに送れるようにし、一覧で見られるようにする

-- ════ 1. 発注書の受領 ════

-- 自社宛の発注は参照できる
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select using (app_user_role() = 'staff' or supplier_id = app_supplier_id());
drop policy if exists cost_entries_select on public.cost_entries;
create policy cost_entries_select on public.cost_entries
  for select using (app_user_role() = 'staff' or supplier_id = app_supplier_id());

-- 自社宛の発注だけ、受領の印を付けられる
drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
  for update using (app_user_role() = 'staff' or supplier_id = app_supplier_id());
drop policy if exists cost_entries_update on public.cost_entries;
create policy cost_entries_update on public.cost_entries
  for update using (app_user_role() = 'staff' or supplier_id = app_supplier_id());

-- 発注先が変えられるのは status だけ（それ以外を触ろうとしたら止める）
create or replace function public.restrict_supplier_order_update() returns trigger
language plpgsql security definer as $$
begin
  if app_user_role() = 'supplier' then
    if new.status is distinct from 'received' then
      raise exception '受領以外の変更はできません';
    end if;
    if new.no is distinct from old.no
       or new.supplier_id is distinct from old.supplier_id
       or new.total is distinct from old.total
       or new.items::text is distinct from old.items::text then
      raise exception '発注の内容は変更できません';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_restrict_supplier_order_update on public.orders;
create trigger trg_restrict_supplier_order_update
  before update on public.orders
  for each row execute function public.restrict_supplier_order_update();

create or replace function public.restrict_supplier_cost_update() returns trigger
language plpgsql security definer as $$
begin
  if app_user_role() = 'supplier' then
    if new.status is distinct from 'received' then
      raise exception '受領以外の変更はできません';
    end if;
    if new.amount is distinct from old.amount
       or new.name is distinct from old.name
       or new.supplier_id is distinct from old.supplier_id then
      raise exception '金額・品目は変更できません';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_restrict_supplier_cost_update on public.cost_entries;
create trigger trg_restrict_supplier_cost_update
  before update on public.cost_entries
  for each row execute function public.restrict_supplier_cost_update();

-- 誰がいつ受領したかを残す
alter table public.orders add column if not exists received_at timestamptz;
alter table public.orders add column if not exists received_by text default '';
comment on column public.orders.received_at is '発注先が受領しましたと押した日時';

-- ════ 2. 請求書 ════

create table if not exists public.invoices (
  id bigint generated always as identity primary key,
  supplier_id bigint references public.suppliers(id) on delete cascade,
  supplier_name text not null default '',   -- 表示用（発注先名が変わっても当時の名前を残す）
  month text not null,                      -- 請求月 'YYYY-MM'
  title text not null default '',           -- 「業者名＋請求月」（例：野地木材_2026年08月）
  file_path text not null,                  -- invoices バケット内の場所
  file_name text default '',                -- 元のファイル名
  file_mime text default '',
  amount integer,                           -- 請求額（任意）
  note text default '',
  uploaded_by text default '',
  created_at timestamptz default now()
);

create index if not exists invoices_supplier_month_idx on public.invoices(supplier_id, month);

alter table public.invoices enable row level security;

-- 社内は全件、発注先は自社分だけ
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select using (app_is_employee() or supplier_id = app_supplier_id());
-- 送るのは発注先（と、代理で入れる管理者）
drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices
  for insert with check (app_user_role() = 'staff' or supplier_id = app_supplier_id());
-- 消せるのは管理者のみ（送り間違いは管理者に連絡してもらう）
drop policy if exists invoices_delete on public.invoices;
create policy invoices_delete on public.invoices
  for delete using (app_user_role() = 'staff');

-- ── 請求書の保管場所（非公開バケット） ──
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

drop policy if exists invoices_files_insert on storage.objects;
create policy invoices_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'invoices' and (app_is_employee() or app_user_role() = 'supplier'));

drop policy if exists invoices_files_select on storage.objects;
create policy invoices_files_select on storage.objects
  for select to authenticated
  using (bucket_id = 'invoices' and (
    app_is_employee()
    -- 発注先は自分のフォルダ（先頭が supplier_id）だけ
    or (app_user_role() = 'supplier' and (storage.foldername(name))[1] = app_supplier_id()::text)
  ));

drop policy if exists invoices_files_delete on storage.objects;
create policy invoices_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'invoices' and app_user_role() = 'staff');
