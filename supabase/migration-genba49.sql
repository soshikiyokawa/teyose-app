-- ════ マイグレーション㊾：発注書の送付先 ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 発注先ごとに、発注書をどこへ送るかを選べるようにする。
--   chat     … 手寄のチャット（これまでどおり。発注先のアカウントに届く）
--   chatwork … ChatWorkのルームへ転送（ルームIDを入れてある発注先のみ）
--   email    … メールで送る
-- 複数選べる。空にはできない（画面側で少なくとも1つ選ばせる）。
--
-- いまの動きと変わらないよう、初期値は chat と、
-- すでにChatWorkのルームIDが入っている発注先は chatwork も入れておく。

alter table public.suppliers
  add column if not exists order_channels jsonb not null default '["chat"]'::jsonb;

comment on column public.suppliers.order_channels is
  '発注書の送付先。chat＝手寄のチャット / chatwork＝ChatWork / email＝メール';

-- すでにChatWorkのルームIDが入っている発注先は、これまでどおり転送されるようにしておく
update public.suppliers
   set order_channels = '["chat","chatwork"]'::jsonb
 where coalesce(chatwork_room_id,'') <> ''
   and order_channels = '["chat"]'::jsonb;
