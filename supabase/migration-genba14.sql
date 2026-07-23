-- ════ マイグレーション⑭：チャットの長押しメニュー（引用・編集・ブックマーク・既読） ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）

-- 引用（返信元）・編集日時・ブックマーク
alter table public.chat_messages add column if not exists reply_to_id bigint;
alter table public.chat_messages add column if not exists reply_to_text text;
alter table public.chat_messages add column if not exists reply_to_sender text;
alter table public.chat_messages add column if not exists edited_at timestamptz;
alter table public.chat_messages add column if not exists bookmarks jsonb not null default '[]'::jsonb;

-- 既読管理：ユーザー×スレッドごとに「最後に開いた時刻」を記録。
-- メッセージの既読者 ＝ そのスレッドを last_read_at がメッセージ時刻以降に開いた人
create table if not exists public.chat_reads (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text default '',
  thread text not null,                 -- 'internal' または 'supplier:<id>'
  last_read_at timestamptz default now(),
  unique (user_id, thread)
);

alter table public.chat_reads enable row level security;
drop policy if exists chat_reads_select on public.chat_reads;
drop policy if exists chat_reads_insert on public.chat_reads;
drop policy if exists chat_reads_update on public.chat_reads;
-- 社員は全件閲覧可（既読確認用）、発注先は自分の行のみ
create policy chat_reads_select on public.chat_reads for select using (app_is_employee() or user_id = auth.uid());
create policy chat_reads_insert on public.chat_reads for insert with check (user_id = auth.uid());
create policy chat_reads_update on public.chat_reads for update using (user_id = auth.uid());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_reads') then
    execute 'alter publication supabase_realtime add table public.chat_reads';
  end if;
end $$;
