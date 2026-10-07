-- ════ マイグレーション94：いま「寸法未入力」の品目を、すべて「寸法のない品目」にする ════
-- Supabaseダッシュボード → SQL Editor に全文貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 先に migration-genba93.sql を流しておくこと。
-- （93で、品目名から寸法を読み取って入れている。93を流す前にこれを流すと、
--   寸法のある品目まで「寸法のない品目」になってしまうので、下で止めるようにしてある）
--
-- 対象は「寸法が入っておらず、まだ『寸法のない品目』の印も付いていない」品目。
-- 寸法が入っている品目・品目名・単価には触らない。
-- これから足す品目は、これまでどおり寸法が必須（無いものは画面でチェックを入れる）。

-- ── 93が済んでいるか確かめる ──
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'master_items' and column_name = 'no_dims'
  ) then
    raise exception '先に supabase/migration-genba93.sql を実行してください（寸法の列がまだありません）';
  end if;
end $$;

-- ── まとめて「寸法のない品目」にする ──
update public.master_items
   set no_dims   = true,
       base_name = coalesce(nullif(base_name, ''), name)
 where dim1 is null
   and not no_dims;

-- ── 確かめる ──
-- 「寸法未入力」が 0 になっていること
select '寸法が入っている品目'     as "区分", count(*) as "件数" from public.master_items where dim1 is not null
union all
select '寸法のない品目',                    count(*)          from public.master_items where no_dims
union all
select '寸法未入力（0になるはず）',         count(*)          from public.master_items where dim1 is null and not no_dims
order by 1;
