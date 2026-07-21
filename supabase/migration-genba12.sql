-- ════ マイグレーション⑫：一般社員（carpenter）に業務機能を開放 ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 権限② 一般社員（carpenter）は、アカウント設定・権限変更・勤務カレンダー・出面表 を除く
-- すべての業務機能（見積・原価・受発注・受注一覧・工程表・案件編集・マスタ・チャット）を使えるようにする。
-- 既存のstaffポリシーは残したまま、carpenter許可ポリシーを「追加」する（RLSはOR結合）。
-- プロフィール（権限）と work_holidays（勤務カレンダー）はstaff専用のまま。

do $$
declare
  tbl text;
  biz_tables text[] := array[
    'projects','estimate_types','estimate_categories','estimate_presets','estimate_defaults',
    'estimates','orders','cost_entries','suppliers','master_items','schedules'
  ];
begin
  foreach tbl in array biz_tables loop
    -- SELECT
    execute format('drop policy if exists %I on public.%I', tbl||'_carpenter_select', tbl);
    execute format('create policy %I on public.%I for select using (app_user_role() = ''carpenter'')', tbl||'_carpenter_select', tbl);
    -- INSERT
    execute format('drop policy if exists %I on public.%I', tbl||'_carpenter_insert', tbl);
    execute format('create policy %I on public.%I for insert with check (app_user_role() = ''carpenter'')', tbl||'_carpenter_insert', tbl);
    -- UPDATE
    execute format('drop policy if exists %I on public.%I', tbl||'_carpenter_update', tbl);
    execute format('create policy %I on public.%I for update using (app_user_role() = ''carpenter'')', tbl||'_carpenter_update', tbl);
    -- DELETE
    execute format('drop policy if exists %I on public.%I', tbl||'_carpenter_delete', tbl);
    execute format('create policy %I on public.%I for delete using (app_user_role() = ''carpenter'')', tbl||'_carpenter_delete', tbl);
  end loop;
end $$;

-- チャット：一般社員は社内＋発注先スレッドの両方を利用可（社内は既存のapp_is_employeeで許可済み）
drop policy if exists chat_messages_carpenter_select on public.chat_messages;
drop policy if exists chat_messages_carpenter_insert on public.chat_messages;
drop policy if exists chat_messages_carpenter_update on public.chat_messages;
drop policy if exists chat_messages_carpenter_delete on public.chat_messages;
create policy chat_messages_carpenter_select on public.chat_messages for select using (app_user_role() = 'carpenter');
create policy chat_messages_carpenter_insert on public.chat_messages for insert with check (app_user_role() = 'carpenter');
create policy chat_messages_carpenter_update on public.chat_messages for update using (app_user_role() = 'carpenter');
create policy chat_messages_carpenter_delete on public.chat_messages for delete using (app_user_role() = 'carpenter');

-- 日報：一般社員は原価の人工集計のため全件閲覧可（作成・編集は従来どおり本人分のみ）
drop policy if exists daily_reports_carpenter_select_all on public.daily_reports;
create policy daily_reports_carpenter_select_all on public.daily_reports for select using (app_user_role() = 'carpenter');
