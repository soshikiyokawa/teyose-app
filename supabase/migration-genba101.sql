-- ════ マイグレーション101：在庫の品目に、カテゴリと発注先を持たせる ════
-- Supabaseダッシュボード → SQL Editor に全文貼り付けて実行してください。
-- 先に migration-genba98.sql・99.sql を実行しておいてください。（再実行しても安全です）
--
-- 在庫の数は原価の明細から計算していて、品目そのものの表は無かった。
-- カテゴリ（木材・建材・金物など）と、いつもの発注先を持たせるために、品目の表を作る。
--   stock_items … 品目名ごとに1行。数は持たない（数はこれまでどおり明細から計算する）
--
-- 見られる・直せるのは、きよかわの社員（管理者・一般社員）だけ。
-- 業者さんには見せない。お客様には、ほかの表と同じ「お客様はだめ」の守りを掛ける。

create table if not exists public.stock_items (
  name        text primary key,                -- 在庫の品目名（原価の明細の name と同じ）
  cat         text not null default '',        -- カテゴリ（木材・建材・金物・設備 など。自由に書ける）
  supplier_id bigint references public.suppliers(id) on delete set null,   -- いつもの発注先
  updated_at  timestamptz not null default now(),
  updated_by  text not null default ''
);

comment on table public.stock_items is
  '在庫の品目ごとの情報（カテゴリ・いつもの発注先）。数は持たず、cost_entries から計算する';

alter table public.stock_items enable row level security;

drop policy if exists stock_items_employee on public.stock_items;
create policy stock_items_employee on public.stock_items
  for all to authenticated
  using (app_is_employee()) with check (app_is_employee());

-- お客様はだめ（migration-genba88.sql と同じ守り。新しい表なので、ここでも掛けておく）
drop policy if exists no_client on public.stock_items;
create policy no_client on public.stock_items as restrictive for all to authenticated
  using (not public.app_is_client()) with check (not public.app_is_client());

-- ── はじめのカテゴリを入れる ──
-- いま在庫にある品目に、名前から見当をつけてカテゴリを入れる（まだ入っていない品目だけ）。
-- 見当なので、ちがっていたら在庫の画面の「カテゴリ・発注先」から直してください。
--   木材 … 野縁・胴縁・間柱・垂木・幅はぎ
--   金物 … 鋼製束・釘・ビス・コーナー・ホールダウン・プレート・受け金物 など
--   設備 … 給気口・換気扇（型番）など
--   建材 … それ以外（シート・断熱材・合板・床材・パッキン・接着剤 など）
-- 発注先は、品目マスタに同じ名前の品目があれば、そこから入れる。
insert into public.stock_items (name, cat, supplier_id, updated_by)
select n.name,
       case
         when n.name ~ '^(野縁|胴縁|間柱|垂木|幅はぎ)' then '木材'
         when n.name ~ '(鋼製束|ロール釘|ビス|パネリード|コーナー|ホールダウン|ザボレス|プレート|金物)'
           or n.name ~ '^(ドーム|ゴーム)パッキン' then '金物'
         when n.name ~ '^(自然給気口|VD-|V-[0-9]|電動給気|H8KS)' then '設備'
         else '建材'
       end,
       (select mi.supplier_id from public.master_items mi
         where mi.name = n.name and mi.supplier_id is not null
           and mi.supplier_id is distinct from (select id from public.suppliers where name = '在庫分' order by id limit 1)
         order by mi.id limit 1),
       '初期登録'
  from (select distinct name from public.cost_entries
         where project = '在庫分' and coalesce(name, '') <> '') n
on conflict (name) do nothing;

notify pgrst, 'reload schema';

-- ── 確かめる ──
select 'カテゴリ「' || cat || '」の品目' as "項目", count(*)::text as "結果"
  from public.stock_items group by cat
union all
select '発注先が入っている品目', (select count(*)::text from public.stock_items where supplier_id is not null)
union all
select 'お客様をふさぐ守り（no_client）',
       case when exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_items' and policyname = 'no_client')
            then 'ある' else '無い' end
order by 1;
