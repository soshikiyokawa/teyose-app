-- ════ マイグレーション89：チャットは「最近のぶんだけ」読む ════
-- Supabaseダッシュボード → SQL Editor に全文貼り付けて実行してください。
-- （再実行しても安全です）
--
-- これまでは、アプリを開くたびに、これまでのやりとりを**全部**取りに行っていた。
-- やりとりは消えずに積み上がるので、使うほど立ち上がりが遅くなる。
--
-- これからは、スレッドごとに直近の分だけを取りに行く。
-- 古いところは「もっと前を読む」を押したときに、そのスレッドの分だけ取りに行く。
--
-- 見える範囲は、これまでどおり。
-- どちらの手続きも security invoker（＝呼んだ人の権限で動く）ので、
-- chat_messages の決まりがそのまま効く。お客様に他のスレッドは返らない。

-- ── ① どのスレッドのものか、を1つの文字にする ──
-- アプリ側の chatThreadNameOfRow（js/data/db.js）と同じ順で見る
create or replace function public.app_chat_key(
  p_client bigint, p_group bigint, p_a uuid, p_b uuid,
  p_project bigint, p_internal boolean, p_supplier bigint
) returns text
language sql immutable
as $$
  select case
    when p_client  is not null then 'c:'||p_client
    when p_group   is not null then 'g:'||p_group
    when p_a       is not null then 'd:'||least(p_a::text, p_b::text)||'|'||greatest(p_a::text, p_b::text)
    when p_project is not null then 'p:'||p_project
    when coalesce(p_internal, false) then 'i:'
    else 's:'||coalesce(p_supplier::text, '?')
  end
$$;
comment on function public.app_chat_key(bigint,bigint,uuid,uuid,bigint,boolean,bigint) is
  'チャット1件が、どのスレッドのものかを表す文字（社内・案件・発注先・グループ・個別・お客様）';

-- 件数が増えても遅くならないように、この文字で引けるようにしておく
create index if not exists chat_messages_thread_idx on public.chat_messages (
  public.app_chat_key(client_project_id, group_id, direct_a, direct_b, project_id, is_internal, supplier_id),
  created_at desc, id desc
);

-- ── ② 開いたときに読む分：スレッドごとの直近 p_per_thread 件 ──
create or replace function public.app_recent_chat(p_per_thread int default 100)
returns setof public.chat_messages
language sql stable
as $$
  select (m.rec).*
  from (
    select c as rec,
           row_number() over (
             partition by public.app_chat_key(c.client_project_id, c.group_id, c.direct_a, c.direct_b,
                                              c.project_id, c.is_internal, c.supplier_id)
             order by c.created_at desc, c.id desc
           ) as rn
    from public.chat_messages c
  ) m
  where m.rn <= greatest(1, least(coalesce(p_per_thread, 100), 1000))
  order by (m.rec).created_at, (m.rec).id
$$;
comment on function public.app_recent_chat(int) is
  '開いたときに読むチャット。スレッドごとに直近の分だけ返す（古いところは app_chat_older で取る）';

-- ── ③ 「もっと前を読む」：いま持っているいちばん古い1件より前を、同じスレッドから ──
create or replace function public.app_chat_older(p_anchor_id bigint, p_limit int default 100)
returns setof public.chat_messages
language sql stable
as $$
  with a as (
    select c.created_at, c.id,
           public.app_chat_key(c.client_project_id, c.group_id, c.direct_a, c.direct_b,
                               c.project_id, c.is_internal, c.supplier_id) as k
    from public.chat_messages c
    where c.id = p_anchor_id
  )
  select c.*
  from public.chat_messages c, a
  where public.app_chat_key(c.client_project_id, c.group_id, c.direct_a, c.direct_b,
                            c.project_id, c.is_internal, c.supplier_id) = a.k
    and (c.created_at, c.id) < (a.created_at, a.id)
  order by c.created_at desc, c.id desc
  limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;
comment on function public.app_chat_older(bigint,int) is
  '「もっと前を読む」。渡した1件と同じスレッドの、それより前のやりとりを新しい順に返す';

grant execute on function public.app_chat_key(bigint,bigint,uuid,uuid,bigint,boolean,bigint) to authenticated;
grant execute on function public.app_recent_chat(int) to authenticated;
grant execute on function public.app_chat_older(bigint,int) to authenticated;

-- ── ④ どれくらい減るか見てみる ──
select count(*) as "ぜんぶの件数",
       (select count(*) from public.app_recent_chat(100)) as "これから読む件数"
from public.chat_messages;
