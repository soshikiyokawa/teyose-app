-- ════ 明細の直しからも読み方を覚える ════
--
-- migration-genba63.sql で「請求金額の見つけ方」を覚えるようにした。
-- 明細（現場ごとの割り当て）でも、人が品名・金額を直したり、
-- 読み落としの行を足したりする。その直しからも覚えられるようにする。
--
-- 覚え書きは同じ表に入れ、どちらの話かを kind で分ける。
--   'total' … 請求金額（税込の総額）の見つけ方
--   'lines' … 明細の行の読み方（どの行を拾うか、金額はどの欄か、など）

alter table public.invoice_read_hints add column if not exists kind text not null default 'total';

alter table public.invoice_read_hints drop constraint if exists invoice_read_hints_kind_ck;
alter table public.invoice_read_hints add constraint invoice_read_hints_kind_ck
  check (kind in ('total','lines'));

comment on column public.invoice_read_hints.kind is
  'total＝請求金額の見つけ方／lines＝明細の行の読み方';

-- 読み取りのときは、どちらの覚え書きも新しいものから数件ずつ渡す
create index if not exists invoice_read_hints_kind_idx
  on public.invoice_read_hints(supplier_id, kind, created_at desc);
