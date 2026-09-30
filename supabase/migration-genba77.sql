-- ════ 経費の発注は、出した本人だけが見られるようにする ════
--
-- 案件が「経費」の発注（レシートから取り込んだ会社の経費）は、
-- 個人の買い物やプライベートに近い内容が混ざる。他の社員には見せない。
-- 清川創史・清川優香だけは全員ぶんを見られる（給与と同じ扱い。app_is_payroll_admin）。
--
-- 対象は次の3つ。どれも「経費」の分だけを絞る。
--   ・orders       … 発注そのもの
--   ・cost_entries … 原価（原価管理の「経費を表示」）
--   ・receipts     … レシート台帳
--
-- 誰が出したかは、これまで created_by_name（名前）しか持っていなかった。
-- 名前で人を見分けるのは危ない（同じ名前の人がいると混ざる）ので、
-- アカウントのID（created_by）を持たせて、そちらで判断する。

alter table public.orders add column if not exists created_by uuid references auth.users(id) on delete set null;
comment on column public.orders.created_by is '発注を出した人のアカウント。経費の発注を本人だけに見せるのに使う';

-- これまでの分は、名前から引き当てる（同じ名前が2人いる場合は入れない）
update public.orders o
   set created_by = p.id
  from public.profiles p
 where o.created_by is null
   and coalesce(o.created_by_name,'') <> ''
   and p.display_name = o.created_by_name
   and (select count(*) from public.profiles q where q.display_name = o.created_by_name) = 1;

create index if not exists orders_created_by_idx on public.orders(created_by);

-- ── 経費の発注を見られるか ──
create or replace function public.app_can_see_expense(p_created_by uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select app_is_payroll_admin() or (p_created_by is not null and p_created_by = auth.uid())
$$;
comment on function public.app_can_see_expense(uuid) is
  '経費の発注・原価・レシートを見られるか。出した本人と、清川創史・清川優香だけ';

-- ── orders ──
--
-- これまでの「管理者は全部見られる」に、経費だけの例外を足す。
-- 業者は自社宛の発注を見る（経費の発注に業者は関係しないが、条件はそのまま残す）。
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select using (
    (app_user_role() = 'staff' and (project <> '経費' or app_can_see_expense(created_by)))
    or supplier_id = app_supplier_id()
  );

drop policy if exists orders_carpenter_select on public.orders;
create policy orders_carpenter_select on public.orders
  for select using (
    app_user_role() = 'carpenter' and (project <> '経費' or app_can_see_expense(created_by))
  );

-- 直す・消すも、見られる人だけ
drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
  for update using (
    (app_user_role() = 'staff' and (project <> '経費' or app_can_see_expense(created_by)))
    or supplier_id = app_supplier_id()
  );

drop policy if exists orders_carpenter_update on public.orders;
create policy orders_carpenter_update on public.orders
  for update using (
    app_user_role() = 'carpenter' and (project <> '経費' or app_can_see_expense(created_by))
  );

drop policy if exists orders_delete on public.orders;
create policy orders_delete on public.orders
  for delete using (
    app_user_role() = 'staff' and (project <> '経費' or app_can_see_expense(created_by))
  );

drop policy if exists orders_carpenter_delete on public.orders;
create policy orders_carpenter_delete on public.orders
  for delete using (
    app_user_role() = 'carpenter' and (project <> '経費' or app_can_see_expense(created_by))
  );

-- ── cost_entries（原価）──
--
-- 誰が出したかの列は持っていないので、同じ発注番号の発注からたどる。
create or replace function public.app_can_see_expense_cost(p_project text, p_order_no text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when coalesce(p_project,'') <> '経費' then true
    when app_is_payroll_admin() then true
    else exists (
      select 1 from public.orders o
      where o.no = p_order_no and o.created_by = auth.uid()
    )
  end
$$;

drop policy if exists cost_entries_select on public.cost_entries;
create policy cost_entries_select on public.cost_entries
  for select using (
    (app_user_role() = 'staff' and app_can_see_expense_cost(project, order_no))
    or supplier_id = app_supplier_id()
  );

drop policy if exists cost_entries_carpenter_select on public.cost_entries;
create policy cost_entries_carpenter_select on public.cost_entries
  for select using (
    app_user_role() = 'carpenter' and app_can_see_expense_cost(project, order_no)
  );

drop policy if exists cost_entries_update on public.cost_entries;
create policy cost_entries_update on public.cost_entries
  for update using (
    (app_user_role() = 'staff' and app_can_see_expense_cost(project, order_no))
    or supplier_id = app_supplier_id()
  );

drop policy if exists cost_entries_carpenter_update on public.cost_entries;
create policy cost_entries_carpenter_update on public.cost_entries
  for update using (
    app_user_role() = 'carpenter' and app_can_see_expense_cost(project, order_no)
  );

drop policy if exists cost_entries_delete on public.cost_entries;
create policy cost_entries_delete on public.cost_entries
  for delete using (
    app_user_role() = 'staff' and app_can_see_expense_cost(project, order_no)
  );

-- ── receipts（レシート台帳）──
--
-- 経費のレシートは、出した本人と清川創史・清川優香だけ。
-- 案件のレシート（材料費など）は、これまでどおり社員なら見られる。
drop policy if exists receipts_select on public.receipts;
create policy receipts_select on public.receipts
  for select using (
    app_is_employee() and (project <> '経費' or app_can_see_expense(created_by))
  );

drop policy if exists receipts_write on public.receipts;
create policy receipts_write on public.receipts
  for all using (
    app_is_employee() and (project <> '経費' or app_can_see_expense(created_by))
  ) with check (app_is_employee());
