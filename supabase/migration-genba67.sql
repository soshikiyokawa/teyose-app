-- ════ 発注書に、作った人（きよかわの担当者）の名前を持たせる ════
--
-- 発注書PDFに「担当者」として載せる。ChatWorkへ送るときにも名前を添える。
-- 発注確定のときに、画面で発注した人の表示名を入れる。
--
-- 単価をあとから直したとき（update-order-price）はPDFをデータベースの中身から
-- 作り直すので、名前も発注に持っておかないと、作り直したPDFから担当者が消える。
--
-- これより前の発注は空のまま（PDFには担当者の行を出さない）。

alter table public.orders add column if not exists created_by_name text not null default '';

comment on column public.orders.created_by_name is
  '発注書を作った人（きよかわの担当者）の表示名。発注書PDFの「担当者」に載せる';
