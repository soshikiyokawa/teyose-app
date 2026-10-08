-- ════ マイグレーション95：発注書を受領するときに、品目ごとの納品予定日を入れてもらう（必須） ════
-- Supabaseダッシュボード → SQL Editor に全文貼り付けて実行してください。
-- （再実行しても安全です）
--
-- これまでの「納品希望日」は、きよかわが頼む日（due_date）。
-- それとは別に、業者さんが「この日に納めます」と答える日を、品目ごとに持つ。
--
--   delivery_dates … 品目ごとの納品予定日。[{ "i":0, "name":"杉 KD材 105×105×3000", "on":"2026-10-14" }, …]
--                    i は発注の品目の並び順（0から）。送料の行には付けない
--   delivery_on    … そのうち、いちばん遅い日（＝すべて揃う日）。並べ替えや一覧に使う
--
-- 品目（items）の中に入れないのは、業者さんが品目そのものを書き換えられないよう
-- 見張りを掛けてあるため（orders_supplier_guard）。日付だけを別の列で持つ。
--
-- 業者さんが受領するときは、すべての品目に日付が入っていなければ受け付けない。
-- 画面でも止めているが、古い版のアプリから日付なしで受領されないよう、ここでも止める。

alter table public.orders add column if not exists delivery_on date;
alter table public.orders add column if not exists delivery_dates jsonb not null default '[]'::jsonb;

comment on column public.orders.delivery_on is
  '納品予定日のうち、いちばん遅い日（すべて揃う日）。業者が受領のときに入れる（きよかわの希望日 due_date とは別）';
comment on column public.orders.delivery_dates is
  '品目ごとの納品予定日。[{i:品目の並び順, name:品目名, on:日付}]。送料の行には付けない';

-- ── 業者さんの受領には、品目ごとの納品予定日を必須にする ──
-- きよかわの社員が代わりに「受領済み」にするときは止めない
-- （店で受け取った・電話で確認した、など日付が要らない場合があるため）
create or replace function public.orders_delivery_required()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  need int;   -- 日付が要る品目の数（送料の行を除く）
  have int;   -- 日付が入っている品目の数
begin
  if app_user_role() = 'supplier'
     and new.status = 'received'
     and old.status is distinct from 'received' then

    select count(*) into need
      from jsonb_array_elements(case when jsonb_typeof(new.items) = 'array' then new.items else '[]'::jsonb end) it
     where coalesce(it->>'isShipping', 'false') <> 'true';

    select count(*) into have
      from jsonb_array_elements(case when jsonb_typeof(new.delivery_dates) = 'array' then new.delivery_dates else '[]'::jsonb end) d
     where coalesce(d->>'on', '') ~ '^\d{4}-\d{2}-\d{2}$';

    if new.delivery_on is null or have < need then
      raise exception '納品予定日を、すべての品目に入れてください。入力欄が出ない場合は、アプリを更新（右上の⟳）してからお試しください';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists orders_delivery_required_trg on public.orders;
create trigger orders_delivery_required_trg
  before update on public.orders
  for each row execute function public.orders_delivery_required();

-- 納品予定日で並べたり探したりするときに使う
create index if not exists orders_delivery_on_idx on public.orders(delivery_on) where delivery_on is not null;

-- ── 確かめる ──
select '受領済み・納品予定日あり' as "区分", count(*) as "件数"
  from public.orders where status = 'received' and delivery_on is not null
union all
select '受領済み・納品予定日なし（これまでの分）', count(*)
  from public.orders where status = 'received' and delivery_on is null
union all
select 'まだ受領されていない', count(*)
  from public.orders where status is distinct from 'received'
order by 1;
