-- ════ 「最短」で発注したことを、発注先にもそのまま伝える ════
-- 「最短」ボタンで入れた場合は、日付ではなく「最短」と書いて渡す。
-- 社内では納期の目安として日付も持っておく。
alter table public.orders add column if not exists due_asap boolean not null default false;
comment on column public.orders.due_asap is
  '納品希望日を「最短」で出したか。trueなら発注書には日付ではなく「最短」と書く';
