-- ════ 発注に「備考」を持たせる ════
--
-- 「〇日の午前中に」「現場の入口が狭いので小型車で」など、
-- 品目や納品場所だけでは伝えきれないことを自由に書いて、発注書に載せる。

alter table public.orders add column if not exists note text not null default '';

comment on column public.orders.note is '発注の備考（自由記述）。発注書PDF・メール・ChatWorkに載る';
