-- ════ 人員配置を、社員なら誰でも組めるようにする ════
--
-- これまでは管理者（staff）だけが足す・直す・消すをできた。
-- 現場の都合は大工さん自身がいちばん早く分かるので、社員（staff・carpenter）
-- なら誰でも直せるようにする。
--
-- 見られる範囲はこれまでどおり社員だけ（発注先・お客様には1行も返さない）。

drop policy if exists staff_assignments_insert on public.staff_assignments;
create policy staff_assignments_insert on public.staff_assignments
  for insert with check (app_is_employee());

drop policy if exists staff_assignments_update on public.staff_assignments;
create policy staff_assignments_update on public.staff_assignments
  for update using (app_is_employee()) with check (app_is_employee());

drop policy if exists staff_assignments_delete on public.staff_assignments;
create policy staff_assignments_delete on public.staff_assignments
  for delete using (app_is_employee());

-- ── 当てたあとの確認 ──
--
-- 4つとも「app_is_employee()」になっていれば完了。
-- 発注先・お客様（supplier／client）はどの行にも出てこない
select polcmd as "操作", pg_get_expr(polqual, polrelid) as "見られる条件",
       pg_get_expr(polwithcheck, polrelid) as "書ける条件"
  from pg_policy
 where polrelid = 'public.staff_assignments'::regclass
 order by 1;
