-- ════ マイグレーション100：在庫の品目を削除する／手で入れた動きを取り消す ════
-- Supabaseダッシュボード → SQL Editor に全文貼り付けて実行してください。
-- 先に migration-genba98.sql を実行しておいてください。（再実行しても安全です）
--
-- どちらも、きよかわの管理者だけ。
--
-- ① 品目を削除する（app_stock_delete_item）
--    在庫は原価の明細から計算しているので、「品目を消す」は次のどちらかになる。
--    ・手で入れた記録しか無い品目（はじめの数・手入力の入庫・棚卸し・単価の修正だけ）
--        → その記録をぜんぶ消す。在庫の一覧から、なくなる
--    ・発注で入れた記録や、出庫の記録がある品目
--        → 記録は消せない（消すと、案件の原価や発注の記録と合わなくなる）。
--          代わりに、すべての置き場の数を 0 に直す。ふだんの一覧からは隠れる
--
-- ② 手で入れた動きを1件取り消す（app_stock_delete_move）
--    入れまちがえた入庫・出庫・棚卸し・単価の修正・はじめの数を消す。
--    消すと在庫がマイナスになる場合（入庫を消したいが、もうその分を出庫している）は、消せない

create or replace function public.app_stock_delete_item(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  stock_sup bigint;
  nm        text := btrim(coalesce(p_name, ''));
  who       text;
  today     date := (now() at time zone 'Asia/Tokyo')::date;
  place     text;
  cur       numeric;
  in_qty    numeric;
  in_amt    numeric;
  avg_cost  numeric;
  unit_now  text;
  n         int := 0;
begin
  if app_user_role() is distinct from 'staff' then
    raise exception '在庫の品目を削除できるのは、きよかわの管理者だけです';
  end if;
  if nm = '' then raise exception '品目名がありません'; end if;

  select id into stock_sup from public.suppliers where name = '在庫分' order by id limit 1;
  perform pg_advisory_xact_lock(hashtext('teyose-stock:' || nm));

  if not exists (select 1 from public.cost_entries
                  where name = nm and (project = '在庫分' or supplier_id = stock_sup)) then
    return jsonb_build_object('mode', 'none', 'count', 0);
  end if;

  -- 発注で入れた記録・出庫の記録があるか
  if exists (
       select 1 from public.cost_entries
        where name = nm
          and ( (project = '在庫分' and supplier_id is distinct from stock_sup and coalesce(order_no, '') not like '在庫:%')
             or (supplier_id = stock_sup and project is distinct from '在庫分') )
     ) then
    -- 記録は残して、置き場ごとに数を 0 に直す
    who := coalesce((select display_name from public.profiles where id = auth.uid()), '');
    select coalesce(sum(qty), 0), coalesce(sum(amount), 0) into in_qty, in_amt
      from public.cost_entries
     where name = nm and project = '在庫分' and supplier_id is distinct from stock_sup;
    avg_cost := case when in_qty > 0 then in_amt / in_qty else 0 end;
    select unit into unit_now from public.cost_entries
     where name = nm and project = '在庫分' and coalesce(unit, '') <> '' order by id limit 1;

    foreach place in array array['可部加工場', '亀山倉庫'] loop
      select coalesce(sum(qty) filter (where project = '在庫分' and supplier_id is distinct from stock_sup), 0)
           - coalesce(sum(qty) filter (where supplier_id = stock_sup and project is distinct from '在庫分'), 0)
        into cur
        from public.cost_entries
       where name = nm and coalesce(stock_place, '可部加工場') = place;
      if cur <> 0 then
        insert into public.cost_entries
          (date, project, name, qty, unit, amount, supplier_id, order_no, cost_type, status, created_by_name, note, stock_place)
        values
          (today, '在庫分', nm, -cur, coalesce(unit_now, '個'), round(-cur * avg_cost), null, '在庫:棚卸し', '材料費', 'received', who, '品目の削除', place);
        n := n + 1;
      end if;
    end loop;
    return jsonb_build_object('mode', 'zero', 'count', n);
  end if;

  -- 手で入れた記録しか無い → ぜんぶ消す
  delete from public.cost_entries
   where name = nm and project = '在庫分' and coalesce(order_no, '') like '在庫:%';
  get diagnostics n = row_count;
  return jsonb_build_object('mode', 'deleted', 'count', n);
end
$$;

create or replace function public.app_stock_delete_move(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  stock_sup bigint;
  e         public.cost_entries;
  place     text;
  cur       numeric;
  is_out    boolean;
begin
  if app_user_role() is distinct from 'staff' then
    raise exception '在庫の動きを取り消せるのは、きよかわの管理者だけです';
  end if;

  select id into stock_sup from public.suppliers where name = '在庫分' order by id limit 1;
  select * into e from public.cost_entries where id = p_id;
  if not found then
    raise exception 'その記録は、もうありません。画面を更新してください';
  end if;
  if coalesce(e.order_no, '') not in ('在庫:入庫', '在庫:出庫', '在庫:棚卸し', '在庫:単価', '在庫:初期登録') then
    raise exception '発注から入った記録は、ここでは取り消せません（発注履歴から直してください）';
  end if;

  perform pg_advisory_xact_lock(hashtext('teyose-stock:' || coalesce(e.name, '')));

  is_out := (e.supplier_id = stock_sup and e.project is distinct from '在庫分');
  place  := coalesce(e.stock_place, '可部加工場');

  -- 消したあとの、その置き場の在庫。マイナスになるなら消せない
  select coalesce(sum(qty) filter (where project = '在庫分' and supplier_id is distinct from stock_sup), 0)
       - coalesce(sum(qty) filter (where supplier_id = stock_sup and project is distinct from '在庫分'), 0)
    into cur
    from public.cost_entries
   where name = e.name and coalesce(stock_place, '可部加工場') = place and id <> e.id;
  if not is_out and cur < 0 then
    raise exception 'この記録を取り消すと、%の在庫がマイナスになります（もう出庫している分があります）。先に出庫のほうを取り消すか、棚卸しで数を直してください', place;
  end if;

  delete from public.cost_entries where id = e.id;
end
$$;

revoke all on function public.app_stock_delete_item(text) from public, anon;
revoke all on function public.app_stock_delete_move(bigint) from public, anon;
grant execute on function public.app_stock_delete_item(text) to authenticated;
grant execute on function public.app_stock_delete_move(bigint) to authenticated;

notify pgrst, 'reload schema';

-- ── 確かめる ──
select '品目を削除する手続き（app_stock_delete_item）' as "項目",
       case when to_regprocedure('public.app_stock_delete_item(text)') is not null then 'ある' else '無い' end as "結果"
union all
select '動きを取り消す手続き（app_stock_delete_move）',
       case when to_regprocedure('public.app_stock_delete_move(bigint)') is not null then 'ある' else '無い' end;
