-- ════ 発注に「納品場所」を持たせる ════
--
-- これまで発注書の納品場所は「（案件名）現場」と決め打ちだった。
-- 加工場に入れてもらう、別の場所に届けてもらう、ということがあるので選べるようにする。
--   現場          … その案件の現場住所
--   きよかわ加工場 … 広島県広島市安佐北区可部2-13-7
--   その他        … 自由に書いた場所
--
-- delivery_place   … どれを選んだか（'現場' / 'きよかわ加工場' / 'その他'）
-- delivery_address … 発注書に書く場所そのもの（住所や自由記述）

alter table public.orders add column if not exists delivery_place   text not null default '';
alter table public.orders add column if not exists delivery_address text not null default '';

comment on column public.orders.delivery_place   is '納品場所の種類（現場／きよかわ加工場／その他）';
comment on column public.orders.delivery_address is '発注書に書く納品場所（住所・自由記述）';
