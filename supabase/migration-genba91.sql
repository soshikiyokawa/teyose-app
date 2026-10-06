-- ════ マイグレーション91：1案件に2人目以降のお客様が入れない不具合を直す ════
-- Supabaseダッシュボード → SQL Editor に全文貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 何が起きていたか
--   お客様チャットの「誰が見られるか」を決める手続きが2つあり、
--     ・migration-genba69.sql … 案件に**お一人だけ**（projects.client_user_id）
--     ・migration-genba70.sql … 案件に**何人でも**（project_clients の表）
--   どちらも同じ名前で定義しているため、69をあとから流すと古い中身に戻る。
--   そうなると、projects.client_user_id に入っているお一人（＝1人目）だけが使えて、
--   2人目以降はログインできても自分のチャットが1件も出てこない。
--
-- このSQLは、新しい中身（何人でも）に直したうえで、
-- 古い列（client_user_id）のお一人も引き続き使えるようにします（誰も締め出さない）。

-- ── ① 直す前の様子を控えておく（最後にまとめて出す） ──
drop table if exists _before;
create temp table _before as
select p.proname::text as fn,
       case when pg_get_functiondef(p.oid) like '%project_clients%'
            then '新しい（何人でも）' else '古い（お一人だけ）' end as ver
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('app_my_client_chats', 'app_can_see_client_chat');

-- ── ② お客様チャットを見られるか ──
-- project_clients に入っている方。古い列のお一人も残す
create or replace function public.app_can_see_client_chat(p_project_id bigint)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project_clients c
    where c.project_id = p_project_id and c.user_id = auth.uid()
  ) or exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and (auth.uid() = any(p.client_chat_member_ids) or auth.uid() = p.client_user_id)
  )
$$;
comment on function public.app_can_see_client_chat(bigint) is
  'その案件のお客様チャットに入れるか。お客様は project_clients、きよかわ側は client_chat_member_ids で判定';

-- ── ③ お客様が、自分のチャットの一覧を引く ──
-- 同じ案件に2行あっても1件にしたいので、join ではなく exists で見る
create or replace function public.app_my_client_chats()
returns table(project_id bigint, project_name text, member_names text[])
language sql stable security definer
set search_path = public
as $$
  select p.id, p.name, p.client_chat_member_names
  from public.projects p
  where exists (
          select 1 from public.project_clients c
          where c.project_id = p.id and c.user_id = auth.uid()
        )
     or p.client_user_id = auth.uid()
  order by p.id
$$;
comment on function public.app_my_client_chats() is
  'お客様が自分のチャット一覧を引く。案件そのものは見せないので、必要な分だけ返す';

grant execute on function public.app_can_see_client_chat(bigint) to authenticated;
grant execute on function public.app_my_client_chats() to authenticated;

-- ── ④ 直す前と直したあと、そして今のお客様の様子 ──
select '① 直す前の中身' as "区分", b.fn as "名前", b.ver as "様子", '' as "ひとこと"
from _before b

union all
select '② 直したあとの中身', p.proname::text,
       case when pg_get_functiondef(p.oid) like '%project_clients%'
            then '新しい（何人でも）' else '古い（お一人だけ）' end, ''
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('app_my_client_chats', 'app_can_see_client_chat')

union all
select '③ お客様の様子', pj.name || ' / ' || coalesce(nullif(c.name,''), '（お名前未入力）'),
       c.email,
       case
         when c.user_id is null              then '✗ アカウントがまだ（「チャット案内」を押してください）'
         when pr.id is null                  then '✗ 権限がついていない'
         when pr.role <> 'client'            then '✗ 役割が client ではない（' || pr.role || '）'
         when pr.password_set is false       then '△ パスワードがまだ（ご案内メールのリンクから設定）'
         else '○ 使えます'
       end
from public.project_clients c
join public.projects pj on pj.id = c.project_id
left join public.profiles pr on pr.id = c.user_id

order by 1, 2;
