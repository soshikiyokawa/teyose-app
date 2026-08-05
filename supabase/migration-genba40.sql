-- ════ マイグレーション㊵：単価の変更履歴（いつからの単価か） ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 発注先が単価を変えるとき「いつから」を選べるようにする。
--   ・適用日が今日以前  … すぐに新しい単価になる
--   ・適用日が先の日付  … その日が来るまでは今までの単価のまま
-- 発注書は「発注日の時点で有効な単価」で作るので、値上げ前の発注は以前の単価のままになる。

create table if not exists public.item_price_changes (
  id bigint generated always as identity primary key,
  item_id bigint not null references public.master_items(id) on delete cascade,
  cost integer not null,                 -- 新しい単価
  prev_cost integer,                     -- 変更前の単価（お知らせ用）
  effective_from date not null,          -- この日から有効
  changed_by text default '',            -- 変更した人（発注先名など）
  created_at timestamptz default now()
);

create index if not exists item_price_changes_item_idx
  on public.item_price_changes(item_id, effective_from);

comment on table public.item_price_changes is '品目の単価の変更履歴。発注書は発注日時点で有効な単価を使う';

alter table public.item_price_changes enable row level security;

-- 社内は全件、発注先は自社の品目の分だけ見られる
drop policy if exists item_price_changes_select on public.item_price_changes;
create policy item_price_changes_select on public.item_price_changes
  for select using (
    app_is_employee()
    or exists (
      select 1 from public.master_items m
      where m.id = item_price_changes.item_id and m.supplier_id = app_supplier_id()
    )
  );

-- 登録できるのは社内か、その品目の発注先だけ
drop policy if exists item_price_changes_insert on public.item_price_changes;
create policy item_price_changes_insert on public.item_price_changes
  for insert with check (
    app_is_employee()
    or exists (
      select 1 from public.master_items m
      where m.id = item_price_changes.item_id and m.supplier_id = app_supplier_id()
    )
  );

-- 取り消せるのは管理者だけ（履歴なので基本は残す）
drop policy if exists item_price_changes_delete on public.item_price_changes;
create policy item_price_changes_delete on public.item_price_changes
  for delete using (app_user_role() = 'staff');

-- 他の端末にもすぐ反映されるようにする（すでに入っていれば何もしない）
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='item_price_changes'
  ) then
    alter publication supabase_realtime add table public.item_price_changes;
  end if;
end $$;
