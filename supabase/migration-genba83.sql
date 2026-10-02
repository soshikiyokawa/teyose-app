-- ════ 人員配置の現場名を案件名に当てはめる【下見。何も変えません】 ════
--
-- ANDPADの工程表は呼び名が短い。手寄の案件名に当てはめ直し、
-- はみ出した言葉（「外壁」「上棟」など）はメモに移したい。
--   例） 甲邸外壁        → 案件「甲様邸リフォーム工事」 ＋ メモ「外壁」
--        乙様邸新築上棟   → 案件「乙様邸　新築工事」 ＋ メモ「上棟」
--        板どぶ漬け       → 当てはまらないので、そのまま
--
-- このファイルは「どう変わるか」を出すだけで、1行も書き換えません。
-- 中身を見て問題なければ、続けて migration-genba84.sql を実行してください。
--
-- 当てはめ方（取り違えが怖いので、迷ったら当てはめない）
--   ① 名字（「様邸」「邸」「様」より前）が同じ案件が1件だけ → それ
--   ①b 無ければ、案件側の名字がその名字で始まるものが1件だけ → それ
--       （「丙」→「丙◯◯様邸…」のように下の名前まで入っている案件があるため）
--   ②  名字が無い呼び名は、頭からそろう文字数がいちばん多い案件。3文字以上で1件だけ
--   候補が2件以上あるときは当てはめない（そのまま残す）
--   メモは、案件名と頭からそろっているぶんを落とした残り

-- ── 名前をそろえる。﨑と崎、空白の違いを無くす ──
create or replace function public.ss_norm(t text) returns text
language sql immutable as $$
  select regexp_replace(replace(replace(coalesce(t,''), '﨑','崎'), '　',''), '\s', '', 'g')
$$;

-- ── 「名字」を取り出す。「様邸」「邸」「様」より前まで。どれも無ければ全体 ──
create or replace function public.ss_key(t text) returns text
language sql immutable as $$
  select case
    when strpos(public.ss_norm(t), '様邸') > 0 then left(public.ss_norm(t), strpos(public.ss_norm(t), '様邸') - 1)
    when strpos(public.ss_norm(t), '邸')   > 0 then left(public.ss_norm(t), strpos(public.ss_norm(t), '邸')   - 1)
    when strpos(public.ss_norm(t), '様')   > 0 then left(public.ss_norm(t), strpos(public.ss_norm(t), '様')   - 1)
    else public.ss_norm(t)
  end
$$;

-- ── 「名字＋様邸」が終わる位置（無ければ0） ──
create or replace function public.ss_mark_end(t text) returns int
language sql immutable as $$
  select case
    when strpos(public.ss_norm(t), '様邸') > 0 then strpos(public.ss_norm(t), '様邸') + 1
    when strpos(public.ss_norm(t), '邸')   > 0 then strpos(public.ss_norm(t), '邸')
    when strpos(public.ss_norm(t), '様')   > 0 then strpos(public.ss_norm(t), '様')
    else 0
  end
$$;

-- ── 頭から何文字そろっているか ──
create or replace function public.ss_lcp(a text, b text) returns int
language plpgsql immutable as $$
declare x text := public.ss_norm(a); y text := public.ss_norm(b); i int := 0;
begin
  while i < length(x) and i < length(y) and substr(x, i+1, 1) = substr(y, i+1, 1) loop
    i := i + 1;
  end loop;
  return i;
end $$;

-- ── 呼び名に当てはまる案件名を返す。決められなければ null ──
--    候補を数えるのと選ぶのを1つの問い合わせでやる（途中で案件が増えてもぶれないように）。
--    前方一致は starts_with を使う（like だと案件名の % や _ が記号として効いてしまう）
create or replace function public.ss_match(excel text) returns text
language sql stable as $$
  with p as (
    select name, public.ss_key(name) as k, public.ss_lcp(excel, name) as n
      from public.projects
  ),
  a as (select name from p where public.ss_key(excel) <> '' and k = public.ss_key(excel)),
  b as (select name from p where public.ss_key(excel) <> '' and starts_with(k, public.ss_key(excel))),
  c as (select name from p where n >= 3 and n = (select max(n) from p))
  select case
    when public.ss_key(excel) <> '' and (select count(*) from a) = 1 then (select name from a)
    when public.ss_key(excel) <> '' and (select count(*) from a) <> 1
         and (select count(*) from b) = 1 then (select name from b)
    when public.ss_key(excel) <> ''
         and ((select count(*) from a) > 1 or (select count(*) from b) > 1) then null
    when (select count(*) from c) = 1 then (select name from c)
  end
$$;

-- ── メモに移す言葉。案件名と頭からそろっているぶんは落とす ──
create or replace function public.ss_rest(excel text, proj text) returns text
language sql immutable as $$
  select case when proj is null then ''
         else substr(public.ss_norm(excel),
                     greatest(public.ss_lcp(excel, proj), public.ss_mark_end(excel)) + 1)
         end
$$;

-- ════ ここから下見。何も変わりません ════

-- ① 呼び名ごとに、どの案件へ当てはまるか
select a.project_name                       as "いまの呼び名",
       count(*)                             as "件数",
       coalesce(public.ss_match(a.project_name), '（当てはまらない）') as "当てはめ先の案件",
       nullif(public.ss_rest(a.project_name, public.ss_match(a.project_name)), '') as "メモへ移す言葉"
  from public.staff_assignments a
 where not exists (select 1 from public.projects p where p.name = a.project_name)
 group by a.project_name
 order by 3 = '（当てはまらない）', 1;

-- ② 1行ずつの見え方（直したあとの形）
select a.person                                                   as "社員大工",
       a.project_name                                             as "いまの呼び名",
       coalesce(public.ss_match(a.project_name), a.project_name)   as "直したあとの現場",
       nullif(trim(coalesce(a.note,'') || ' ' ||
              coalesce(public.ss_rest(a.project_name, public.ss_match(a.project_name)),'')), '') as "直したあとのメモ",
       a.start_date as "はじめ", a.end_date as "おわり"
  from public.staff_assignments a
 order by a.person, a.start_date;

-- ③ 当てはめ先の候補が2件以上あって、見送るもの（取り違え防止で、そのまま残る）
select a.project_name as "呼び名", public.ss_key(a.project_name) as "名字",
       (select string_agg(p.name, ' / ') from public.projects p
         where starts_with(public.ss_key(p.name), public.ss_key(a.project_name))) as "候補"
  from public.staff_assignments a
 where public.ss_match(a.project_name) is null
   and public.ss_key(a.project_name) <> ''
   and (select count(*) from public.projects p
         where starts_with(public.ss_key(p.name), public.ss_key(a.project_name))) > 1
 group by a.project_name;
