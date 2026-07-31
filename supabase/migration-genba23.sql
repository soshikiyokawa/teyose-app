-- ════ マイグレーション㉓：カード明細（JCB）の取り込みと照合 ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- JCBのCSV明細を取り込み、レシートから作った発注と突き合わせて
-- 「どの現場（案件）の費用か」を割り当てるための表。

create table if not exists public.card_statements (
  id bigint generated always as identity primary key,
  -- CSVから取り込む内容
  pay_date date,                 -- 今回のお支払日（請求月の代表日）
  card_last4 text default '',    -- カード下4桁
  card_holder text default '',   -- 利用者（カード名義）
  use_date date,                 -- ご利用日
  merchant text default '',      -- ご利用先など
  amount numeric default 0,      -- ご利用金額（税込）
  category text default '',      -- カテゴリ（ショッピング取組（国内）など）
  area text default '',          -- 国内／海外
  memo text default '',          -- 摘要
  -- 割り当て・照合の結果
  project text default '',       -- 案件（現場）。「共通」など案件外もここに入れる
  cost_type text default '',     -- 費目（材料費／外注費／労務費／諸経費）
  order_no text default '',      -- 照合できた発注番号（原価は発注時に登録済み＝二重登録しない）
  cost_entry_id bigint,          -- この明細から新しく作った原価のid
  status text not null default 'unassigned'
    check (status in ('unassigned','matched','registered','ignored')),
  --   unassigned＝未割当／matched＝発注と照合済（原価は登録済み）
  --   registered＝この明細から原価を登録した／ignored＝対象外にした
  row_key text not null unique,  -- 同じCSVを二重に取り込まないためのキー
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists card_statements_use_date_idx on public.card_statements(use_date);
create index if not exists card_statements_merchant_idx on public.card_statements(merchant);

-- 会社のお金の話なので、参照・編集は管理者（staff）のみ
alter table public.card_statements enable row level security;

drop policy if exists card_statements_select on public.card_statements;
create policy card_statements_select on public.card_statements
  for select using (app_user_role() = 'staff');
drop policy if exists card_statements_insert on public.card_statements;
create policy card_statements_insert on public.card_statements
  for insert with check (app_user_role() = 'staff');
drop policy if exists card_statements_update on public.card_statements;
create policy card_statements_update on public.card_statements
  for update using (app_user_role() = 'staff');
drop policy if exists card_statements_delete on public.card_statements;
create policy card_statements_delete on public.card_statements
  for delete using (app_user_role() = 'staff');

-- 複数端末への即時反映
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'card_statements'
  ) then
    alter publication supabase_realtime add table public.card_statements;
  end if;
end $$;
