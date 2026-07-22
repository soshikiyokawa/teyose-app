-- ════ マイグレーション⑬：チャットのリアクション ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- メッセージへのリアクション（スタンプ）を保存。形式：{ "👍": ["清川創史","大工A"], "了解です": ["原口晴郎"] }
-- 更新は既存の chat_messages の UPDATE ポリシーで制御される（そのスレッドを見られる人のみ）。

alter table public.chat_messages add column if not exists reactions jsonb not null default '{}'::jsonb;
