-- ════ マイグレーション㉑：有給の取得実績を管理者が登録できるようにする ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です。マイグレーション⑳の後に実行してください）
--
-- アプリを使い始める前に取得した有給を、管理者が本人に代わって登録できるようにする。
-- （年5日の取得義務の消化状況を正しく表示するため）

drop policy if exists leave_requests_insert on public.leave_requests;
create policy leave_requests_insert on public.leave_requests for insert with check (
  (app_is_employee() and user_id = auth.uid())   -- 本人による申請（従来どおり）
  or app_user_role() = 'staff'                   -- 管理者による実績の代理登録
);
