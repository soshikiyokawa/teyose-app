-- ════ マイグレーション92：チャットの未読が続いたら、もう一度お知らせする ════
-- Supabaseダッシュボード → SQL Editor に全文貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 先に Edge Function をデプロイしておくこと：
--   npx supabase@latest functions deploy chat-remind
--
-- 何をするか
--   30分たっても読まれていないチャットがある人に、もう一度お知らせを送る。
--   同じやりとりについては3時間に1回まで。3日より前のものは、もう追いかけない。
--   夜（21時〜翌7時）は動かさない。
--
-- お知らせに本文は入れない（「社内 2件」のように件数だけ）。
-- 読み返しは手寄の中でしていただく。

-- ── ① いつ送ったかの控え ──
create table if not exists public.chat_reminders (
  user_id      uuid not null references auth.users(id) on delete cascade,
  thread       text not null,                 -- threadKeyOf と同じ合い印（internal / supplier:3 など）
  last_sent_at timestamptz not null default now(),
  primary key (user_id, thread)
);
comment on table public.chat_reminders is
  'チャットの「まだ読まれていません」を、いつ誰のどのやりとりについて送ったか';

alter table public.chat_reminders enable row level security;
-- 送るのはサーバー側（service_role）だけ。見るのは自分の分
drop policy if exists chat_reminders_select on public.chat_reminders;
create policy chat_reminders_select on public.chat_reminders
  for select using (user_id = auth.uid());

-- ── ② 未読のまとめ ──
--
-- 「そのやりとりを一度でも開いたことがある人」を相手にする（chat_reads に行がある人）。
-- 開いたことが無い人には、そもそも最初のお知らせが届いているので、追いかけない。
-- この作りなら、入っていないやりとりのことを知らせてしまう心配がない。
create or replace function public.app_chat_unread_digest(
  p_min_age interval default '30 minutes',
  p_max_age interval default '3 days'
) returns table(user_id uuid, thread text, cnt int, latest_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  with msg as (
    select m.id, m.created_at, m.sender_name,
           m.direct_a, m.direct_b,
           case
             when m.client_project_id is not null then 'client:'||m.client_project_id
             when m.group_id          is not null then 'group:'||m.group_id
             when m.project_id        is not null then 'project:'||m.project_id
             when coalesce(m.is_internal,false)   then 'internal'
             else 'supplier:'||coalesce(m.supplier_id::text,'?')
           end as k
    from public.chat_messages m
    where m.created_at <= now() - p_min_age
      and m.created_at >= now() - p_max_age
  ),
  -- 個別チャット以外。合い印は送り手・受け手で同じ
  plain as (
    select r.user_id, r.thread, m.created_at, m.sender_name
    from msg m
    join public.chat_reads r on r.thread = m.k
    where m.direct_a is null
  ),
  -- 個別チャット。相手から見た合い印は「送ってきた人」になる
  direct as (
    select r.user_id, r.thread, m.created_at, m.sender_name
    from msg m
    join public.chat_reads r
      on (r.user_id = m.direct_b and r.thread = 'direct:'||m.direct_a)
      or (r.user_id = m.direct_a and r.thread = 'direct:'||m.direct_b)
    where m.direct_a is not null
  ),
  both as (select * from plain union all select * from direct)
  select b.user_id, b.thread, count(*)::int, max(b.created_at)
  from both b
  join public.profiles pr on pr.id = b.user_id
  left join public.chat_reads r2 on r2.user_id = b.user_id and r2.thread = b.thread
  where coalesce(pr.display_name,'') <> coalesce(b.sender_name,'')   -- 自分が書いたものは数えない
    and (r2.last_read_at is null or r2.last_read_at < b.created_at)  -- まだ読んでいない
  group by b.user_id, b.thread
$$;
comment on function public.app_chat_unread_digest(interval, interval) is
  '一定時間たっても読まれていないチャットを、人とやりとりごとにまとめる（再通知用）';

-- ── ③ 定期実行（日本時間 7時〜20時40分、20分おき） ──
-- UTC 22:00〜11:40 が、日本時間の 7:00〜20:40 にあたる
select cron.unschedule('chat-remind') where exists (
  select 1 from cron.job where jobname = 'chat-remind'
);
select cron.schedule(
  'chat-remind',
  '*/20 22,23,0-11 * * *',
  $$
  select net.http_post(
    url     := 'https://uotzxrwtzlpdnpfbaqpi.supabase.co/functions/v1/chat-remind',
    headers := '{"Content-Type": "application/json", "x-remind-secret": "0bf6fb2a4cdbb06f967ac194fb2f169de0d6ec0b483c7919"}'::jsonb,
    body    := '{}'::jsonb
  )
  $$
);

-- ── ④ いまの未読の様子（確かめ用） ──
select coalesce(pr.display_name,'（名前未設定）') as "相手",
       d.thread as "やりとり",
       d.cnt    as "未読",
       to_char(d.latest_at at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') as "最後の書き込み"
from public.app_chat_unread_digest() d
join public.profiles pr on pr.id = d.user_id
order by d.cnt desc, 1;
