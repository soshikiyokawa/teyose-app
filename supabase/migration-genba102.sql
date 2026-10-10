-- ════ マイグレーション102：在庫の品目名を、品目マスタの名前に合わせる ════
-- Supabaseダッシュボード → SQL Editor に全文貼り付けて実行してください。
-- 先に migration-genba98.sql・101.sql を実行しておいてください。（再実行しても安全です）
--
-- 在庫の品目名と、品目マスタの品目名が、同じものなのに書き方がちがうことがある
-- （空白の有無・全角と半角・「×」と「x」など）。
-- 名前がちがうと、発注して入れた分と、手で入れた分が、別の品目として並んでしまう。
-- 在庫の画面の「品目マスタと名前を合わせる」から、品目マスタの名前に付け替える。
--
-- 付け替えるのは、在庫に関わる原価の明細だけ（案件が「在庫分」のもの・発注先が「在庫分」のもの）。
-- ほかの案件に、たまたま同じ名前の明細があっても、それは触らない。
-- 付け替えた先に、もう同じ名前の在庫があれば、1つの品目にまとまる（数は足される）。
-- きよかわの社員（管理者・一般社員）が使える。

create or replace function public.app_stock_rename(
  p_from        text,
  p_to          text,
  p_unit        text   default null,    -- 品目マスタの単位（入れると、その品目の在庫の明細の単位をそろえる）
  p_supplier_id bigint default null,    -- 品目マスタの発注先（在庫の品目に発注先が入っていなければ入れる）
  p_cat         text   default null)    -- 品目マスタのカテゴリ（在庫の品目にカテゴリが入っていなければ入れる）
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  stock_sup bigint;
  f   text := btrim(coalesce(p_from, ''));
  t   text := btrim(coalesce(p_to, ''));
  u   text := nullif(btrim(coalesce(p_unit, '')), '');
  n   int := 0;
  who text;
begin
  if not app_is_employee() then
    raise exception '在庫の品目名を変えられるのは、きよかわの社員だけです';
  end if;
  if f = '' or t = '' then raise exception '品目名がありません'; end if;
  if f = t then return 0; end if;

  select id into stock_sup from public.suppliers where name = '在庫分' order by id limit 1;

  -- 2つの品目を、いつも同じ順番で順番待ちにする（向かい合って待ち合わない）
  perform pg_advisory_xact_lock(hashtext('teyose-stock:' || least(f, t)));
  perform pg_advisory_xact_lock(hashtext('teyose-stock:' || greatest(f, t)));

  update public.cost_entries
     set name = t
   where name = f and (project = '在庫分' or supplier_id = stock_sup);
  get diagnostics n = row_count;

  -- 単位をそろえる（まとまった先の、前からある明細もふくめて）
  if u is not null then
    update public.cost_entries
       set unit = u
     where name = t and (project = '在庫分' or supplier_id = stock_sup) and unit is distinct from u;
  end if;

  -- 品目の情報（カテゴリ・発注先）も付け替える。表がまだ無い環境では何もしない
  if to_regclass('public.stock_items') is not null then
    who := coalesce((select display_name from public.profiles where id = auth.uid()), '');
    if exists (select 1 from public.stock_items where name = t) then
      -- 付け替えた先にもう情報がある：空いているところだけ、もとの品目・品目マスタの値で埋める
      update public.stock_items d
         set cat = case when coalesce(d.cat, '') <> '' then d.cat
                        else coalesce(nullif((select s.cat from public.stock_items s where s.name = f), ''), nullif(btrim(coalesce(p_cat, '')), ''), '') end,
             supplier_id = coalesce(d.supplier_id, (select s.supplier_id from public.stock_items s where s.name = f), p_supplier_id),
             updated_at = now(), updated_by = who
       where d.name = t;
      delete from public.stock_items where name = f;
    elsif exists (select 1 from public.stock_items where name = f) then
      update public.stock_items
         set name = t,
             cat = case when coalesce(cat, '') <> '' then cat else coalesce(nullif(btrim(coalesce(p_cat, '')), ''), '') end,
             supplier_id = coalesce(supplier_id, p_supplier_id),
             updated_at = now(), updated_by = who
       where name = f;
    elsif n > 0 then
      insert into public.stock_items (name, cat, supplier_id, updated_by)
      values (t, coalesce(nullif(btrim(coalesce(p_cat, '')), ''), ''), p_supplier_id, who)
      on conflict (name) do nothing;
    end if;
  end if;

  return n;
end
$$;

comment on function public.app_stock_rename(text, text, text, bigint, text) is
  '在庫の品目名を付け替える（品目マスタの名前に合わせる）。在庫に関わる原価の明細だけを書き換える';

revoke all on function public.app_stock_rename(text, text, text, bigint, text) from public, anon;
grant execute on function public.app_stock_rename(text, text, text, bigint, text) to authenticated;

notify pgrst, 'reload schema';

-- ── 確かめる ──
select '品目名を付け替える手続き（app_stock_rename）' as "項目",
       case when to_regprocedure('public.app_stock_rename(text, text, text, bigint, text)') is not null then 'ある' else '無い' end as "結果"
union all
select '在庫の品目のうち、品目マスタに同じ名前があるもの',
       (select count(*)::text from (select distinct name from public.cost_entries where project = '在庫分') n
         where exists (select 1 from public.master_items mi where mi.name = n.name))
union all
select '在庫の品目のうち、品目マスタに同じ名前が無いもの（画面で候補を確かめる）',
       (select count(*)::text from (select distinct name from public.cost_entries where project = '在庫分') n
         where not exists (select 1 from public.master_items mi where mi.name = n.name));
