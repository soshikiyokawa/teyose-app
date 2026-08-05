-- ════ マイグレーション㊴：発注先も案件の情報・現場資料・工程表を見られるようにする ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 対象は「その案件のメンバーに入っている発注先」だけ。参加していない案件は今までどおり見えない。
--   ・案件の情報（案件名・工事区分・住所・工期など）… 見るだけ
--   ・現場写真 … 見る＋自分で追加できる。消せるのは自分が上げた写真だけ
--   ・図面     … 見るだけ
--   ・工程表   … 見るだけ
-- 見積・金額・原価・日報などはこれまでどおり見えない。

-- ── 案件（参加している案件だけ） ──
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select using (app_is_employee() or app_is_project_member(id));

-- ── 現場写真：見る・追加は参加者、消せるのは自分が上げた分だけ ──
drop policy if exists site_photos_select on public.site_photos;
create policy site_photos_select on public.site_photos
  for select using (app_is_employee() or app_is_project_member(project_id));
drop policy if exists site_photos_insert on public.site_photos;
create policy site_photos_insert on public.site_photos
  for insert with check (
    (app_is_employee() or app_is_project_member(project_id)) and uploaded_by = auth.uid()
  );
-- 変更・削除は「管理者」か「自分が上げた写真」だけ（発注先が他人の写真を消すことはできない）
drop policy if exists site_photos_update on public.site_photos;
create policy site_photos_update on public.site_photos
  for update using (app_user_role() = 'staff' or uploaded_by = auth.uid());
drop policy if exists site_photos_delete on public.site_photos;
create policy site_photos_delete on public.site_photos
  for delete using (app_user_role() = 'staff' or uploaded_by = auth.uid());

-- ── 図面・フォルダ：見るだけ（追加・変更は社内のみ） ──
drop policy if exists drawings_select on public.drawings;
create policy drawings_select on public.drawings
  for select using (app_is_employee() or app_is_project_member(project_id));
drop policy if exists site_folders_select on public.site_folders;
create policy site_folders_select on public.site_folders
  for select using (app_is_employee() or app_is_project_member(project_id));

-- ── 工程表：参加している案件のものを見るだけ ──
-- schedules は案件名で紐づいているため、名前から案件を引いて判定する。
-- 既存の社内向けポリシーはそのまま。見るためのポリシーを1つ足すだけ（表が無ければ何もしない）
do $$
begin
  drop policy if exists schedules_supplier_select on public.schedules;
  create policy schedules_supplier_select on public.schedules
    for select using (
      exists (
        select 1 from public.projects p
        where p.name = schedules.project_name and app_is_project_member(p.id)
      )
    );
exception when undefined_table then null;
end $$;

-- ── 現場写真の保管場所（site-files）：参加者は読める・写真は置ける ──
drop policy if exists site_files_select on storage.objects;
create policy site_files_select on storage.objects
  for select to authenticated
  using (bucket_id = 'site-files');
drop policy if exists site_files_insert on storage.objects;
create policy site_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'site-files' and (app_is_employee() or app_user_role() = 'supplier'));
