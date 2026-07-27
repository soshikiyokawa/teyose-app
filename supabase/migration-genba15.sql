-- ════ マイグレーション⑮：発注先チャットのChatWork転送 ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 発注先ごとに転送先のChatWorkルームIDを持たせる。設定した発注先のチャットで
-- きよかわ側が送ったメッセージが、そのルームへ自動転送される（片方向）。

alter table public.suppliers add column if not exists chatwork_room_id text default '';
