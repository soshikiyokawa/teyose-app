-- ════ 見積依頼（発注の前に、発注先へ見積をお願いする） ════
--
-- 発注書と同じように、品目を並べて「見積依頼書」を作り、チャット・ChatWork・メールで送る。
-- 発注書と違うのは、単価と金額を「こちらが書かない」こと（それを教えてもらうための書類）。

create table if not exists public.quote_requests (
  id              bigint generated always as identity primary key,
  no              text not null unique,            -- 見積依頼番号（発注番号と同じ作り）
  project         text not null default '',        -- 案件名
  supplier_id     bigint references public.suppliers(id) on delete set null,
  supplier_name   text not null default '',        -- 消えた発注先でも履歴に名前を残す
  reply_by        date,                            -- 見積回答希望日
  note            text not null default '',        -- 備考（現場の条件など）
  items           jsonb not null default '[]',     -- [{name, qty, unit, spec}]
  status          text not null default 'sent',    -- sent / answered / closed
  pdf_url         text not null default '',
  answered_at     timestamptz,
  created_by      uuid references auth.users(id) on delete set null,
  created_by_name text not null default '',
  created_at      timestamptz not null default now()
);

comment on table public.quote_requests is '見積依頼。発注の前に、発注先へ見積をお願いした記録';

create index if not exists quote_requests_created_idx on public.quote_requests(created_at desc);
create index if not exists quote_requests_supplier_idx on public.quote_requests(supplier_id);

-- ── 見られる範囲 ──
-- きよかわの社員は全部。発注先は、自社宛のものだけ（発注と同じ考え方）
alter table public.quote_requests enable row level security;

drop policy if exists quote_requests_select on public.quote_requests;
create policy quote_requests_select on public.quote_requests
  for select using (app_is_employee() or supplier_id = app_supplier_id());

drop policy if exists quote_requests_write on public.quote_requests;
create policy quote_requests_write on public.quote_requests
  for all using (app_is_employee()) with check (app_is_employee());

-- 発注先が「回答しました」を押せるように、自社宛の行だけ status を直せる
drop policy if exists quote_requests_supplier_update on public.quote_requests;
create policy quote_requests_supplier_update on public.quote_requests
  for update using (supplier_id = app_supplier_id()) with check (supplier_id = app_supplier_id());
