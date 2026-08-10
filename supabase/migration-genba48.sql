-- ════ マイグレーション㊽：現場資料に「保存書類」を追加 ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 確認済証・検査済証・瑕疵保険証書のように、引渡しのあとも取っておく書類を
-- 案件ごとに残せるようにする。写真・図面と同じ仕組み（drawings と site_folders）を使い、
-- 種類を 'document' で分ける。
--
-- 保存書類はきよかわの社員だけが見られる（発注先には出さない）。
-- 写真と図面はこれまでどおり、参加している発注先も見られる。

-- フォルダの種類に 'document' を足す
alter table public.site_folders drop constraint if exists site_folders_kind_check;
alter table public.site_folders add constraint site_folders_kind_check
  check (kind in ('photo','drawing','document'));

-- 保存書類は社員だけに見せる（発注先は写真・図面まで）
drop policy if exists drawings_select on public.drawings;
create policy drawings_select on public.drawings
  for select using (
    app_is_employee()
    or (coalesce(kind,'drawing') <> 'document' and app_is_project_member(project_id))
  );

drop policy if exists site_folders_select on public.site_folders;
create policy site_folders_select on public.site_folders
  for select using (
    app_is_employee()
    or (coalesce(kind,'drawing') <> 'document' and app_is_project_member(project_id))
  );

comment on column public.drawings.kind is
  'drawing＝図面 / parking＝駐車場の資料 / document＝保存書類（確認済証など。社員のみ）';
