-- ════ 出面表・日報の手直し（清川創史のみ、全社員分） ════
--
-- これまで日報は「自分の分」しか作れなかった（daily_reports_insert）。
-- 出面表を直すには、本人が出していない日の日報（欠勤など）を足す必要があるので、
-- 清川創史だけ、他の社員の日報も作れるようにする。
-- 更新・削除はもともと管理者（staff）に開いているのでそのまま。

create or replace function public.app_is_nippo_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select display_name = '清川創史' from public.profiles where id = auth.uid()),
    false)
$$;

drop policy if exists daily_reports_insert on public.daily_reports;
create policy daily_reports_insert on public.daily_reports
  for insert with check (
    (app_is_employee() and user_id = auth.uid())
    or app_is_nippo_editor()
  );
