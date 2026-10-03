-- ════ マイグレーション88：お客様に見えるのは「お客様チャット」だけ（絶対） ════
-- Supabaseダッシュボード → SQL Editor に全文貼り付けて実行してください。
-- （再実行しても安全です）
--
-- これまでの考え方
--   表を1つ作るたびに「お客様には見せない」を書き足していた。
--   書き忘れた表が1つでもあると、そこから見えてしまう。
--
-- これからの考え方
--   「お客様はだめ」を、ぜんぶの表にまとめてかける。
--   許すのは、下の allow に並べた表だけ。
--   これは **restrictive（かならず満たす条件）** なので、
--   あとからどんな「見てよい」決まりを足しても、お客様には効きません。
--   新しい表を作ったときは、この SQL をもう一度流せば、その表にもかかります。
--
-- お客様が触れてよいもの（いずれも、もともと自分の分しか見えない決まり付き）
--   chat_messages      … 自分の案件のお客様チャットだけ（下の②でさらに絞る）
--   chat_reads         … 自分がどこまで読んだか
--   profiles           … 自分のアカウント（ログインに要る）
--   project_clients    … 自分の登録（お名前・メール）
--   push_subscriptions … 自分の端末への通知
--   app_my_client_chats() … 自分のチャット一覧（案件そのものは見せない手続き）

-- ── ① お客様かどうか ──
create or replace function public.app_is_client() returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select role = 'client' from public.profiles where id = auth.uid()), false)
$$;
comment on function public.app_is_client() is 'お客様（施主）のアカウントか';

-- ── ② チャットの中でも、お客様チャット以外は見せない ──
-- 社内・案件・業者・グループ・個別のやりとりは、まぎれこんでも返さない
create or replace function public.app_can_see_chat(
  p_project_id bigint, p_is_internal boolean, p_supplier_id bigint,
  p_direct_a uuid, p_direct_b uuid, p_group_id bigint, p_client_project_id bigint
) returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    -- お客様は、自分の案件のお客様チャットだけ。ほかはいっさい通さない
    when app_is_client() then
      (p_client_project_id is not null and app_can_see_client_chat(p_client_project_id))
    when p_client_project_id is not null then app_can_see_client_chat(p_client_project_id)
    when p_group_id is not null then app_is_group_member(p_group_id)
    when p_direct_a is not null then auth.uid() in (p_direct_a, p_direct_b)
    when p_project_id is not null then (app_user_role() = 'staff' or app_is_project_member(p_project_id))
    when p_is_internal then app_is_employee()
    else (app_user_role() in ('staff','carpenter') or p_supplier_id = app_supplier_id())
  end
$$;

-- ── ③ そのほかの表すべてに「お客様はだめ」をかける ──
do $$
declare
  allow text[] := array[
    'chat_messages','chat_reads','profiles','project_clients','push_subscriptions'
  ];
  r record;
  n_guard int := 0;
  n_rls   int := 0;
begin
  for r in
    select c.oid, c.relname, c.relrowsecurity
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relkind in ('r','p')                       -- ふつうの表と、分割された表
      and not (c.relname = any(allow))
      -- 拡張機能が持ち込んだ表は触らない（手寄の表ではないため）
      and not exists (select 1 from pg_depend d
                      where d.objid = c.oid and d.classid = 'pg_class'::regclass and d.deptype = 'e')
    order by c.relname
  loop
    -- 鍵（RLS）が掛かっていない表は、いまは誰でも全部できる状態。
    -- 鍵を掛けたうえで「お客様以外はこれまでどおり」を置く（社員・業者の使い勝手は変えない）
    if not r.relrowsecurity then
      execute format('alter table public.%I enable row level security', r.relname);
      execute format('drop policy if exists legacy_all on public.%I', r.relname);
      execute format(
        'create policy legacy_all on public.%I for all to authenticated '
        'using (not public.app_is_client()) with check (not public.app_is_client())', r.relname);
      n_rls := n_rls + 1;
    end if;

    execute format('drop policy if exists no_client on public.%I', r.relname);
    execute format(
      'create policy no_client on public.%I as restrictive for all to authenticated '
      'using (not public.app_is_client()) with check (not public.app_is_client())', r.relname);
    n_guard := n_guard + 1;
  end loop;

  raise notice 'お客様をふさいだ表：% 件（うち、鍵が掛かっていなかった表：% 件）', n_guard, n_rls;
end $$;

-- ── ④ ファイルの置き場（ストレージ）にも同じ守りをかける ──
--
-- いまは site-files（現場写真・図面・保存書類・日報写真）を
-- 「ログインしている人なら誰でも」読める決まりにしてある。
-- このままだと、お客様が中の一覧を取りに行けてしまう。
-- チャットの添付（chat-files）以外は、お客様には通さない。
drop policy if exists storage_no_client on storage.objects;
create policy storage_no_client on storage.objects
  as restrictive for all to authenticated
  using      (bucket_id = 'chat-files' or not public.app_is_client())
  with check (bucket_id = 'chat-files' or not public.app_is_client());

-- ── ⑤ 確かめる ──
--
-- ①に出るのは、上の allow に並べた5つだけのはず。
-- ②と③は、ふつうは何も出ません。出たら中身を確かめてください。
select '① お客様が触れる表（この5つだけのはず）' as "区分", c.relname as "名前"
from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
where ns.nspname = 'public' and c.relkind in ('r','p')
  and not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'no_client')

union all
-- 鍵（RLS）の掛かっていない表。ここは空であること
select '② 鍵の無い表（空であること）', c.relname
from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
where ns.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity

union all
-- ビューは表ではないので、上の守りが効かない。
-- 出てきたものは、お客様に見えてよい中身かどうかを1つずつ確かめること
select '③ ビュー（中身を確かめること）', c.relname
from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
where ns.nspname = 'public' and c.relkind in ('v','m')

union all
-- 鍵が無かったので、今回まとめて掛けた表。
-- 「お客様以外はこれまでどおり」にしてあるだけなので、
-- 社員・業者の間での見え方を分けたい表があれば、あとで決まりを足すとよい
select '④ 今回まとめて鍵を掛けた表', c.relname
from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
join pg_policy p on p.polrelid = c.oid and p.polname = 'legacy_all'
where ns.nspname = 'public'

order by 1, 2;
