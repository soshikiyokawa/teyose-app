-- ════ 請求書：AIで読めなかったら手で入れて、そこから読み方を覚える ════
--
-- 請求書の書き方は取引先ごとにばらばらで、AIが金額を取り違える／見つけられないことがある。
-- そのときは人が正しい金額を入れる。入れた金額をもとに、AIに
-- 「この請求書のどこを見ればその金額になるのか」を1文で書かせ、発注先ごとに覚えておく。
-- 次に同じ発注先の請求書を読むときは、その覚え書きを一緒に渡す。
--
-- モデルそのものを鍛えるのではなく、読ませるときの手がかりを積んでいく形。
-- 覚えた内容は画面から見られて、消せる（おかしなことを覚えたら消せるようにするため）。

-- ── 請求書：AIが読んだ額と、人が手で入れたかどうか ──
alter table public.invoices add column if not exists ai_total       integer;
alter table public.invoices add column if not exists amount_by_hand boolean not null default false;

comment on column public.invoices.ai_total is
  'AIが最後に読み取った請求金額。読めなかったときは null。人が入れた額と比べて読み違えを見つけるのに使う';
comment on column public.invoices.amount_by_hand is '請求金額を人が手で入れたかどうか';

-- ── 発注先ごとの「読み取りのコツ」 ──
create table if not exists public.invoice_read_hints (
  id bigint generated always as identity primary key,
  supplier_id bigint not null references public.suppliers(id) on delete cascade,
  hint text not null,                          -- 次に読むときAIに一緒に渡す1文
  ai_total integer,                            -- そのときAIが読んだ額。読めなければ null
  right_total integer,                         -- 人が入れた正しい額
  source_month text not null default '',       -- どの請求書から覚えたか
  created_by text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists invoice_read_hints_supplier_idx
  on public.invoice_read_hints(supplier_id, created_at desc);

comment on table public.invoice_read_hints is
  '請求書の読み取りのコツ。発注先ごとに積み、次の読み取りでAIに渡す';
comment on column public.invoice_read_hints.hint is
  '「合計欄ではなく右下の今回請求額を見る」のような、次も使える言い方の1文';

alter table public.invoice_read_hints enable row level security;

-- 読めるのは社員。発注先には見せない（他社の請求書の読み方が混ざるため）
drop policy if exists invoice_read_hints_select on public.invoice_read_hints;
create policy invoice_read_hints_select on public.invoice_read_hints
  for select using (app_is_employee());

drop policy if exists invoice_read_hints_write on public.invoice_read_hints;
create policy invoice_read_hints_write on public.invoice_read_hints
  for all using (app_user_role() = 'staff') with check (app_user_role() = 'staff');
