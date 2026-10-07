-- ════ マイグレーション93：品目マスタの寸法を、品目名から独立させる ════
-- Supabaseダッシュボード → SQL Editor に全文貼り付けて実行してください。
-- （再実行しても安全です）
--
-- これまで寸法は品目名の中に書いていた（「杉 KD材 105×105×3000」）。
-- これを「品目名」と「寸法（3つの数字）」に分けて持つ。
--
--   base_name … 寸法を除いた品目名（杉 KD材）
--   dim1〜3   … 寸法（105 / 105 / 3000）
--   no_dims   … 寸法のない品目（金物・設備など）。画面でチェックを入れたもの
--
-- いまの品目名（name）は**書き換えない**。
-- 発注書・発注履歴・請求書の突き合わせは name を使っているので、これまでどおり動く。
-- 画面で品目を保存し直したときに、name は「品目名＋寸法」から組み立て直される。

alter table public.master_items add column if not exists base_name text;
alter table public.master_items add column if not exists dim1 numeric;
alter table public.master_items add column if not exists dim2 numeric;
alter table public.master_items add column if not exists dim3 numeric;
alter table public.master_items add column if not exists no_dims boolean not null default false;

comment on column public.master_items.base_name is '寸法を除いた品目名。name は base_name＋寸法から組み立てる';
comment on column public.master_items.dim1 is '寸法の1つ目（mm）';
comment on column public.master_items.dim2 is '寸法の2つ目（mm）';
comment on column public.master_items.dim3 is '寸法の3つ目（mm）';
comment on column public.master_items.no_dims is '寸法のない品目（金物・設備など）';

-- ── いまの品目名から、寸法を読み取って入れる ──
-- 「数字×数字×数字」の形（× は x・X・＊・* でもよい）を探す。
-- まだ入れていないものだけが対象（流し直しても、画面で直したものを上書きしない）
with found as (
  select id, name,
         regexp_match(name, '(\d+(?:\.\d+)?)\s*[×xX＊*]\s*(\d+(?:\.\d+)?)\s*[×xX＊*]\s*(\d+(?:\.\d+)?)') as m
  from public.master_items
  where dim1 is null and not no_dims
)
update public.master_items t
   set dim1 = (f.m)[1]::numeric,
       dim2 = (f.m)[2]::numeric,
       dim3 = (f.m)[3]::numeric,
       base_name = nullif(btrim(regexp_replace(
                     regexp_replace(f.name,
                       '(\d+(?:\.\d+)?)\s*[×xX＊*]\s*(\d+(?:\.\d+)?)\s*[×xX＊*]\s*(\d+(?:\.\d+)?)', ' '),
                     '\s+', ' ', 'g')), '')
  from found f
 where t.id = f.id and f.m is not null;

-- 品目名が寸法だけだったもの・読み取れなかったものは、名前をそのまま品目名にしておく
update public.master_items set base_name = name where base_name is null;

-- ── 発注先は、寸法も書き換えられないようにする（品目名などと同じ扱い） ──
create or replace function public.restrict_supplier_item_update() returns trigger
language plpgsql security definer as $$
begin
  if app_user_role() = 'supplier' then
    if new.name <> old.name or new.cat <> old.cat or new.unit <> old.unit
       or new.supplier_id <> old.supplier_id or new.sort_order <> old.sort_order
       or new.base_name is distinct from old.base_name
       or new.dim1 is distinct from old.dim1
       or new.dim2 is distinct from old.dim2
       or new.dim3 is distinct from old.dim3
       or new.no_dims is distinct from old.no_dims then
      raise exception '価格・原価以外の項目は編集できません';
    end if;
  end if;
  return new;
end;
$$;

-- ── 確かめる ──
-- ①は件数。②は、寸法を読み取れなかった品目（画面で寸法を入れるか、
--   「寸法のない品目」にチェックを入れてください）
select '① 寸法を読み取れた' as "区分", count(*)::text as "中身", '' as "カテゴリ"
from public.master_items where dim1 is not null
union all
select '① 読み取れなかった', count(*)::text, ''
from public.master_items where dim1 is null and not no_dims
union all
select '② 寸法が入っていない品目', name, coalesce(cat,'')
from public.master_items where dim1 is null and not no_dims
order by 1, 3, 2;
