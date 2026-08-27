-- ════ 発注済みの単価を、発注先があとから直せるようにする ════
--
-- 単価が決まらないまま発注することがあり（実際に単価0の発注が入っている）、
-- あとから発注先に入れてもらえるようにする。
--   ・変更の履歴（誰が・いつ・いくらから いくらへ）を発注に残す
--   ・原価管理の金額も同時に直す
--   ・きよかわの社員に通知する
--
-- 単価の書き換えそのものは Edge Function（update-order-price）が行う。
-- 発注先がデータベースを直接いじれると、品目や数量まで変えられてしまうため、
-- ここでは発注先が直接できることを「受領の記録だけ」に絞る。

alter table public.orders add column if not exists price_edits jsonb not null default '[]'::jsonb;

comment on column public.orders.price_edits is
  '発注先による単価変更の履歴。[{at, byName, changes:[{name,qty,before,after}], subtotal:{before,after}, total:{before,after}}]';

-- ── 発注先が直接変更できるのは「受領の記録」だけにする ──
create or replace function public.orders_supplier_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_user_role() = 'supplier' then
    if new.no          is distinct from old.no
    or new.project     is distinct from old.project
    or new.supplier_id is distinct from old.supplier_id
    or new.date        is distinct from old.date
    or new.due_date    is distinct from old.due_date
    or new.cost_type   is distinct from old.cost_type
    or new.items       is distinct from old.items
    or new.subtotal    is distinct from old.subtotal
    or new.tax         is distinct from old.tax
    or new.total       is distinct from old.total
    or new.price_edits is distinct from old.price_edits
    then
      raise exception '発注先が直接変更できるのは受領の記録だけです';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists orders_supplier_guard_trg on public.orders;
create trigger orders_supplier_guard_trg
  before update on public.orders
  for each row execute function public.orders_supplier_guard();

-- ── 原価も同じ。発注先が直接変更できるのは受領の記録だけ ──
create or replace function public.cost_entries_supplier_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_user_role() = 'supplier' then
    if new.project     is distinct from old.project
    or new.name        is distinct from old.name
    or new.qty         is distinct from old.qty
    or new.unit        is distinct from old.unit
    or new.amount      is distinct from old.amount
    or new.supplier_id is distinct from old.supplier_id
    or new.order_no    is distinct from old.order_no
    or new.cost_type   is distinct from old.cost_type
    or new.date        is distinct from old.date
    then
      raise exception '発注先が直接変更できるのは受領の記録だけです';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists cost_entries_supplier_guard_trg on public.cost_entries;
create trigger cost_entries_supplier_guard_trg
  before update on public.cost_entries
  for each row execute function public.cost_entries_supplier_guard();
