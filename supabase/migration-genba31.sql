-- ════ マイグレーション㉛：出面表を社員全員が見られるようにする ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- これまで出面表は管理者だけのものだったが、きよかわの社員（staff・carpenter）は
-- 全員が全員分を見られるようにする。そのために、
--   ・休日出勤の申請（holiday_requests）
--   ・有給の申請（leave_requests）
-- を社員なら参照できるようにする。日報（daily_reports）は既に参照できる。
--
-- ※ 参照だけ。承認・削除は今までどおり管理者（と承認者）のみ。
-- ※ 発注先（supplier）はこれまでどおり一切見られない。

-- ── 休日出勤の申請：社員は全員分を参照できる ──
drop policy if exists holiday_requests_employee_select on public.holiday_requests;
create policy holiday_requests_employee_select on public.holiday_requests
  for select using (app_is_employee());

-- ── 有給の申請：社員は全員分を参照できる ──
drop policy if exists leave_requests_employee_select on public.leave_requests;
create policy leave_requests_employee_select on public.leave_requests
  for select using (app_is_employee());

-- ── 社員名簿（出面表の休日判定に使う）──
-- profiles には有給の残日数にかかわる列（雇用契約開始日・調整日数）もあるため、
-- テーブルごと公開はしない。出面表に必要な「名前」と「区分」だけを見せる。
create or replace view public.employee_directory as
  select id, display_name, work_group
  from public.profiles
  where app_is_employee();

comment on view public.employee_directory is
  '出面表用の社員名簿。名前と区分（訓練校生など）のみ。有給の設定は含めない';

grant select on public.employee_directory to authenticated;
