-- ════ マイグレーション⑤：社内チャット（きよかわ社員）＋休日出勤申請 ════
-- Supabaseダッシュボード → SQL Editor に全文貼り付けて実行してください。
-- （再実行しても安全です）

-- ── 1. チャットに社内チャンネル（きよかわ社員のみ）を追加 ──
alter table public.chat_messages add column if not exists is_internal boolean not null default false;

-- RLSを社内チャンネル対応に更新：
--   社内メッセージ＝社員（staff＋carpenter）のみ読み書き可
--   発注先メッセージ＝従来どおり（staffは全件・発注先は自社スレッドのみ）
drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
  for select using (
    (is_internal and app_is_employee())
    or (not is_internal and (app_user_role() = 'staff' or supplier_id = app_supplier_id()))
  );
drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert with check (
    (is_internal and app_is_employee())
    or (not is_internal and (app_user_role() = 'staff' or supplier_id = app_supplier_id()))
  );
drop policy if exists chat_messages_update on public.chat_messages;
create policy chat_messages_update on public.chat_messages
  for update using (
    (is_internal and app_is_employee())
    or (not is_internal and (app_user_role() = 'staff' or supplier_id = app_supplier_id()))
  );
drop policy if exists chat_messages_delete on public.chat_messages;
create policy chat_messages_delete on public.chat_messages
  for delete using (
    (is_internal and app_is_employee())
    or (not is_internal and (app_user_role() = 'staff' or supplier_id = app_supplier_id()))
  );

-- ── 2. 休日出勤申請（承認プロセスは残業と同様：承認者1人を指名） ──
create table if not exists public.holiday_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text default '',
  work_date date not null,
  project_id bigint references public.projects(id) on delete set null,
  project_name text default '',
  reason text default '',
  approver_name text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewer_name text default '',
  review_note text default '',
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

alter table public.holiday_requests enable row level security;

drop policy if exists holiday_requests_select on public.holiday_requests;
drop policy if exists holiday_requests_insert on public.holiday_requests;
drop policy if exists holiday_requests_update on public.holiday_requests;
drop policy if exists holiday_requests_delete on public.holiday_requests;
create policy holiday_requests_select on public.holiday_requests
  for select using (app_user_role() = 'staff' or user_id = auth.uid() or app_is_ot_approver());
create policy holiday_requests_insert on public.holiday_requests
  for insert with check (app_is_employee() and user_id = auth.uid());
create policy holiday_requests_update on public.holiday_requests
  for update using (app_user_role() = 'staff' or app_is_ot_approver() or (user_id = auth.uid() and status = 'pending'));
create policy holiday_requests_delete on public.holiday_requests
  for delete using (app_user_role() = 'staff' or (user_id = auth.uid() and status = 'pending'));

-- ── 3. Realtime（登録済みのテーブルはスキップ） ──
do $$
declare t text;
begin
  foreach t in array array['holiday_requests'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
