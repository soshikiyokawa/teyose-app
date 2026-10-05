-- ════ マイグレーション90：見積の明細は、その案件を開いたときに読む ════
-- Supabaseダッシュボード → SQL Editor に全文貼り付けて実行してください。
-- （再実行しても安全です）
--
-- これまでは、アプリを開くたびに見積を「明細ごと」全件取りに行っていた。
-- 見積1件の明細は数百行になることもあり、件数が増えるほど立ち上がりが遅くなる。
--
-- これからは、
--   ・開いたときは、明細を**除いた**見積だけを読む
--   ・案件一覧の「見積総額」「原価」は、データベース側で足した数字を受け取る
--   ・明細そのものは、その案件（見積）を開いたときに、その1件だけ読む
--
-- 見える範囲は変えない。estimates_lite は security_invoker（＝見る人の権限で動く）なので、
-- estimates の決まりがそのまま効く（社内のみ。お客様・発注先には返らない）。

-- ── ① 明細の合計（売価・原価）を出す ──
-- 数として読めないもの（空欄・文字）は0として数える。
-- ここで落ちると見積の保存まで巻き込むので、必ず値を返す作りにしてある
create or replace function public.app_est_sum(p_sections jsonb, p_field text)
returns numeric
language sql immutable
as $$
  select coalesce(sum(
      (case when (t.item->>'qty')    ~ '^-?[0-9]+(\.[0-9]+)?$' then (t.item->>'qty')::numeric    else 0 end)
    * (case when (t.item->>p_field)  ~ '^-?[0-9]+(\.[0-9]+)?$' then (t.item->>p_field)::numeric  else 0 end)
  ), 0)
  from jsonb_array_elements(
         case when jsonb_typeof(p_sections) = 'array' then p_sections else '[]'::jsonb end
       ) as s(sec),
       jsonb_array_elements(
         case when jsonb_typeof(s.sec->'items') = 'array' then s.sec->'items' else '[]'::jsonb end
       ) as t(item)
$$;
comment on function public.app_est_sum(jsonb, text) is
  '見積の明細から、数量×（price＝売価／cost＝原価）の合計を出す';

-- ── ② 明細を除いた見積（＋合計の数字） ──
-- 列は estimates の並びから自動で作る。あとで列を足したら、この SQL をもう一度流すこと
drop view if exists public.estimates_lite;
do $$
declare cols text;
begin
  select string_agg(format('e.%I', column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'estimates' and column_name <> 'sections';

  execute 'create view public.estimates_lite with (security_invoker = true) as select '
       || cols
       || ', public.app_est_sum(e.sections, ''price'') as sections_total'
       || ', public.app_est_sum(e.sections, ''cost'')  as sections_cost'
       || ' from public.estimates e';
end $$;

comment on view public.estimates_lite is
  '明細（sections）を除いた見積。合計だけ数字で持つ。開いたときの読み込みを軽くするためのもの';

grant select on public.estimates_lite to authenticated;

-- ── ③ どこが重かったのか、実際の大きさを見る ──
select '見積の明細（sections）'      as "中身", count(*) as "件数",
       pg_size_pretty(coalesce(sum(pg_column_size(sections)),0))      as "大きさ"
from public.estimates
union all
select '見積の明細以外',               count(*),
       pg_size_pretty(coalesce(sum(pg_column_size(e.*) - pg_column_size(e.sections)),0))
from public.estimates e
union all
select '発注の明細（items）',           count(*),
       pg_size_pretty(coalesce(sum(pg_column_size(items)),0))
from public.orders
union all
select 'チャット',                      count(*),
       pg_size_pretty(coalesce(sum(pg_column_size(c.*)),0))
from public.chat_messages c
union all
select '現場写真の記録',                count(*),
       pg_size_pretty(coalesce(sum(pg_column_size(p.*)),0))
from public.site_photos p;
