-- ════ マイグレーション㉞：車両の追加・編集を社員全員ができるようにする ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- これまで車両の登録は管理者だけだったが、きよかわの社員（staff・carpenter）なら
-- 誰でも車両を追加・編集できるようにする。
-- 削除だけは今までどおり管理者のみ（実施記録もまとめて消えるため）。

drop policy if exists vehicles_insert on public.vehicles;
create policy vehicles_insert on public.vehicles for insert with check (app_is_employee());

drop policy if exists vehicles_update on public.vehicles;
create policy vehicles_update on public.vehicles for update using (app_is_employee());

-- 削除は管理者のみ（変更なし。念のため入れ直し）
drop policy if exists vehicles_delete on public.vehicles;
create policy vehicles_delete on public.vehicles for delete using (app_user_role() = 'staff');

-- ── 社員名簿に「区分（staff／carpenter）」を足す ──
-- 車両の点検責任者を選ぶ一覧などで、一般社員からも社員の名前が出るようにするため。
-- 発注先のアカウントは名簿に含めない。有給の設定は今までどおり含めない。
drop view if exists public.employee_directory;
create view public.employee_directory as
  select id, display_name, role, work_group
  from public.profiles
  where app_is_employee() and role in ('staff', 'carpenter');

comment on view public.employee_directory is
  '社内の名簿。名前・区分・勤務区分のみ（有給の設定は含めない）。出面表や点検責任者の選択に使う';

grant select on public.employee_directory to authenticated;
