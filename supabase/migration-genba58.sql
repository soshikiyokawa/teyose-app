-- ════ 請求書の明細を現場ごとに割り当てて、請求原価として扱う ════
--
-- 建材店の請求書は「日付・現場名・品名・数量・金額」の行が並んでいる。
-- これをAIで読み取り、現場ごとに割り当てて保存する。
-- 現場名が読めなかった行・どの案件か決められなかった行は、こちらで選んでもらう。
--
-- これで、現場ごとに 見積（見込み）／発注（出した額）／請求（実際に来た額）を並べられる。

create table if not exists public.invoice_lines (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references public.invoices(id) on delete cascade,
  line_no integer not null default 0,        -- 請求書の中の並び順
  raw_project text not null default '',      -- 請求書に書かれていた現場名（読み取ったまま）
  project text not null default '',          -- 割り当てた案件名。空＝まだ決まっていない
  work_date date,                            -- 納品日など、行に書かれていた日付
  name text not null default '',             -- 品名
  qty numeric,
  unit text not null default '',
  amount integer not null default 0,         -- 税抜の金額（請求書に書かれているまま）
  cost_type text not null default '材料費',
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists invoice_lines_invoice_idx on public.invoice_lines(invoice_id);
create index if not exists invoice_lines_project_idx on public.invoice_lines(project);

comment on table public.invoice_lines is
  '請求書の明細。現場ごとの請求原価として、見積・発注と突き合わせるのに使う';
comment on column public.invoice_lines.raw_project is '請求書に書かれていた現場名。割り当ての手がかりに残す';
comment on column public.invoice_lines.project is '割り当てた案件名。空なら「現場が決まっていない」';

alter table public.invoice_lines enable row level security;

-- 請求原価は社内の情報。発注先には見せない（自社宛の請求書であっても、
-- どの現場にいくら乗せたかはきよかわ側の管理情報のため）
drop policy if exists invoice_lines_select on public.invoice_lines;
create policy invoice_lines_select on public.invoice_lines
  for select using (app_is_employee());

drop policy if exists invoice_lines_write on public.invoice_lines;
create policy invoice_lines_write on public.invoice_lines
  for all using (app_user_role() = 'staff') with check (app_user_role() = 'staff');
