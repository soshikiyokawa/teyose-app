-- ════ マイグレーション98：在庫の入庫・出庫・棚卸しを手で入れられるようにする／置き場を分ける ════
-- Supabaseダッシュボード → SQL Editor に全文貼り付けて実行してください。
-- （再実行しても安全です。前の版を実行済みでも、もう一度実行してください）
--
-- 在庫は、これまでどおり原価の明細（cost_entries）から計算する。別の表は作らない。
--   入庫 … 案件が「在庫分」の明細（発注先が「在庫分」のものは除く）
--   出庫 … 発注先が「在庫分」で、案件が「在庫分」でない明細（その案件の原価になる）
--   現在庫 ＝ 入庫の数 − 出庫の数。出庫の単価は、入庫の平均単価
--
-- これまでは、発注を通さないと入庫も出庫もできなかった。
-- 発注を通さない動き（余り材を戻す・現場へ持ち出す・数え直す）を、手続きから入れられるようにする。
--   ・原価の明細を書けるのは管理者だけなので、一般社員も入れられるよう、手続きを通す
--   ・出庫は、その置き場の在庫の数を超えて出せない（同時に押されても、数え直してから書く）
--   ・「だれが入れたか」は、画面から送られた値ではなく、ここで付ける
--
-- 置き場（可部加工場・亀山倉庫）ごとに数を持つ。
--   置き場の入っていない明細（これまでの分、発注から入った分）は「可部加工場」として数える。
--   平均単価は、置き場で分けずに品目ごとに1つ。

-- だれが入れたか・ひとことメモ・置き場（在庫の履歴に出す。発注から入った明細では空のまま）
alter table public.cost_entries add column if not exists created_by_name text;
alter table public.cost_entries add column if not exists note text;
alter table public.cost_entries add column if not exists stock_place text;

comment on column public.cost_entries.created_by_name is '手で入れた在庫の動き（入庫・出庫・棚卸し）を記録した人';
comment on column public.cost_entries.note is '在庫の動きに添えたメモ';
comment on column public.cost_entries.stock_place is '在庫の置き場（可部加工場／亀山倉庫）。空は可部加工場として数える';

-- 前の版（置き場なし）の手続きは消す。残っていると、どちらを呼ぶか決まらなくなる
drop function if exists public.app_stock_move(text, text, text, numeric, numeric, text, text);

-- p_kind … 'in'（入庫）／'out'（出庫）／'adjust'（棚卸し。p_qty に実際に数えた数を入れる）
--          ／'cost'（単価・単位を直す。p_unit_cost に正しい単価、p_unit に正しい単位を入れる）
-- 返すもの … 書いた明細（直すところが無かったときは、中身が空の行）
create or replace function public.app_stock_move(
  p_kind      text,
  p_name      text,
  p_unit      text    default '',
  p_qty       numeric default 0,
  p_unit_cost numeric default null,     -- 入庫の単価（税抜）。空なら、いまの平均単価
  p_project   text    default '',       -- 出庫先の案件名
  p_note      text    default '',
  p_place     text    default '可部加工場')
returns public.cost_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  stock_sup bigint;
  nm        text := btrim(coalesce(p_name, ''));
  place     text := coalesce(nullif(btrim(coalesce(p_place, '')), ''), '可部加工場');
  in_qty    numeric;      -- 入庫の数（すべての置き場）
  in_amt    numeric;
  in_here   numeric;      -- この置き場の入庫の数
  out_here  numeric;
  cur       numeric;      -- この置き場の、いまの在庫
  avg_cost  numeric;      -- 入庫の平均単価
  unit_now  text;
  who       text;
  today     date := (now() at time zone 'Asia/Tokyo')::date;
  r         public.cost_entries;
  d         numeric;
  uc        numeric;
begin
  if not app_is_employee() then
    raise exception '在庫を動かせるのは、きよかわの社員だけです';
  end if;
  if p_kind is null or p_kind not in ('in', 'out', 'adjust', 'cost') then
    raise exception '在庫の動きの種類が分かりません';
  end if;
  if nm = '' then
    raise exception '品目名を入れてください';
  end if;
  if place not in ('可部加工場', '亀山倉庫') then
    raise exception '置き場「%」はありません', place;
  end if;
  if p_kind <> 'cost' and (p_qty is null or (p_kind in ('in', 'out') and p_qty <= 0) or (p_kind = 'adjust' and p_qty < 0)) then
    raise exception '数量を入れてください';
  end if;

  select id into stock_sup from public.suppliers where name = '在庫分' order by id limit 1;
  if stock_sup is null then
    raise exception '発注先「在庫分」がありません（発注先マスタに「在庫分」を作ってください）';
  end if;

  -- 同じ品目を同時に動かされても数が狂わないように、品目ごとに順番待ちにする
  perform pg_advisory_xact_lock(hashtext('teyose-stock:' || nm));

  select coalesce(sum(qty), 0), coalesce(sum(amount), 0),
         coalesce(sum(qty) filter (where coalesce(stock_place, '可部加工場') = place), 0)
    into in_qty, in_amt, in_here
    from public.cost_entries
   where name = nm and project = '在庫分' and supplier_id is distinct from stock_sup;
  select coalesce(sum(qty), 0) into out_here
    from public.cost_entries
   where name = nm and supplier_id = stock_sup and project is distinct from '在庫分'
     and coalesce(stock_place, '可部加工場') = place;
  cur      := in_here - out_here;
  avg_cost := case when in_qty > 0 then in_amt / in_qty else 0 end;

  -- 単位は、すでにある品目ならそれに合わせる（同じ品目で単位がばらつかないように）
  select unit into unit_now from public.cost_entries
   where name = nm and project = '在庫分' and coalesce(unit, '') <> '' order by id limit 1;
  unit_now := coalesce(unit_now, nullif(btrim(coalesce(p_unit, '')), ''), '個');

  who := coalesce((select display_name from public.profiles where id = auth.uid()), '');

  if p_kind = 'in' then
    uc := coalesce(p_unit_cost, avg_cost, 0);
    if uc < 0 then raise exception '単価が正しくありません'; end if;
    insert into public.cost_entries
      (date, project, name, qty, unit, amount, supplier_id, order_no, cost_type, status, created_by_name, note, stock_place)
    values
      (today, '在庫分', nm, p_qty, unit_now, round(p_qty * uc), null, '在庫:入庫', '材料費', 'received', who, coalesce(p_note, ''), place)
    returning * into r;

  elsif p_kind = 'out' then
    if btrim(coalesce(p_project, '')) = '' or p_project in ('在庫分', '経費') then
      raise exception '出庫先の案件を選んでください';
    end if;
    if not exists (select 1 from public.projects where name = p_project) then
      raise exception '案件「%」が見つかりません', p_project;
    end if;
    if p_qty > cur then
      raise exception '在庫が足りません。「%」の%の在庫は % % です。数が合わないときは、棚卸しで直してください', nm, place, cur, unit_now;
    end if;
    insert into public.cost_entries
      (date, project, name, qty, unit, amount, supplier_id, order_no, cost_type, status, created_by_name, note, stock_place)
    values
      (today, p_project, nm, p_qty, unit_now, round(p_qty * avg_cost), stock_sup, '在庫:出庫', '材料費', 'received', who, coalesce(p_note, ''), place)
    returning * into r;

  elsif p_kind = 'adjust' then
    -- 棚卸し：実際に数えた数との差を、入庫の側に足し引きする（金額は平均単価で動かす）
    d := p_qty - cur;
    if d = 0 then return null; end if;
    insert into public.cost_entries
      (date, project, name, qty, unit, amount, supplier_id, order_no, cost_type, status, created_by_name, note, stock_place)
    values
      (today, '在庫分', nm, d, unit_now, round(d * avg_cost), null, '在庫:棚卸し', '材料費', 'received', who, coalesce(p_note, ''), place)
    returning * into r;

  else
    -- 単位を直す：その品目の在庫の明細（入庫も出庫も）の単位を、まとめて書き換える
    if nullif(btrim(coalesce(p_unit, '')), '') is not null and btrim(p_unit) <> unit_now then
      unit_now := btrim(p_unit);
      update public.cost_entries set unit = unit_now
       where name = nm
         and (project = '在庫分' or supplier_id = stock_sup);
    end if;
    -- 単価を直す：数は動かさず、入庫の金額だけを足し引きして、平均単価を合わせる。
    -- 単価が空のとき・在庫の数が 0 のとき（金額を持てない）は、単位だけ直して終わる
    if p_unit_cost is null or in_qty <= 0 then
      return null;
    end if;
    if p_unit_cost < 0 then
      raise exception '単価が正しくありません';
    end if;
    d := round(p_unit_cost * in_qty) - in_amt;
    if d = 0 then return null; end if;
    insert into public.cost_entries
      (date, project, name, qty, unit, amount, supplier_id, order_no, cost_type, status, created_by_name, note, stock_place)
    values
      (today, '在庫分', nm, 0, unit_now, d, null, '在庫:単価', '材料費', 'received', who, coalesce(p_note, ''), place)
    returning * into r;
  end if;

  return r;
end
$$;

comment on function public.app_stock_move(text, text, text, numeric, numeric, text, text, text) is
  '在庫の入庫・出庫・棚卸し・単価の修正を、原価の明細として書く。社員だけ。出庫はその置き場の在庫の数まで';

revoke all on function public.app_stock_move(text, text, text, numeric, numeric, text, text, text) from public, anon;
grant execute on function public.app_stock_move(text, text, text, numeric, numeric, text, text, text) to authenticated;

notify pgrst, 'reload schema';

-- ── 確かめる ──
select '在庫を動かす手続き（app_stock_move・置き場つき）' as "項目",
       case when to_regprocedure('public.app_stock_move(text, text, text, numeric, numeric, text, text, text)') is not null
            then 'ある' else '無い' end as "結果"
union all
select '置き場の列（stock_place）',
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'cost_entries' and column_name = 'stock_place')
            then 'ある' else '無い' end
union all
select '発注先「在庫分」',
       case when exists (select 1 from public.suppliers where name = '在庫分') then 'ある' else '無い' end;
