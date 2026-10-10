-- ════ マイグレーション96：業者さんが「納品完了」を品目ごとに記録する／発注をあとからキャンセルする ════
-- Supabaseダッシュボード → SQL Editor に全文貼り付けて実行してください。
-- （再実行しても安全です）
--
-- これまであったのは「納品予定日」（delivery_dates。受領のときに業者さんが入れる）。
-- それとは別に、実際に納めた日を品目ごとに持つ。
--
--   delivered_dates … 納品が済んだ品目。
--       [{ "i":0, "name":"杉 KD材 105×105×3000", "on":"2026-10-09",
--          "by":"山田建材 山田", "by_id":"<アカウント>", "at":"<記録した時刻>" }, …]
--       i は発注の品目の並び順（0から）。送料の行には付けない
--
-- 記録は、下の手続き（app_mark_delivered／app_unmark_delivered）からだけ行う。
--   ・2台から同時に押しても、片方の記録が消えないように、発注の行に鍵を掛けてから書く
--   ・「だれが・いつ」は、画面から送られた値ではなく、ここで付ける
--   ・業者さんが列を直接書き換えることはできない（見張りを掛ける）

alter table public.orders add column if not exists delivered_dates jsonb not null default '[]'::jsonb;

-- 発注したあとでキャンセルした品目。品目そのもの（items）は消さずに残し、どれをやめたかをここに持つ
--   [{ "i":0, "name":"品目名", "reason":"理由", "by":"記録した人", "by_id":"<アカウント>", "at":"<時刻>" }, …]
alter table public.orders add column if not exists cancelled_items jsonb not null default '[]'::jsonb;

-- 業者さんが「キャンセル品」に指定して、きよかわの確認（承認）を待っている品目
--   [{ "i":0, "name":"品目名", "by":"指定した人", "by_id":"<アカウント>", "at":"<時刻>" }, …]
-- きよかわが承認すると cancelled_items に移り、差し戻すとここから消える
alter table public.orders add column if not exists cancel_requests jsonb not null default '[]'::jsonb;

comment on column public.orders.cancel_requests is
  '業者がキャンセル品に指定し、きよかわの確認を待っている品目。[{i, name, by, by_id, at}]';

comment on column public.orders.cancelled_items is
  '発注後にキャンセルした品目。[{i:品目の並び順, name:品目名, reason, by, by_id, at}]。items は消さずに残す';

comment on column public.orders.delivered_dates is
  '納品が済んだ品目（業者の報告）。[{i:品目の並び順, name:品目名, on:納品日, by:記録した人, by_id, at}]。送料の行には付けない';

-- ── 業者さんは、この列を直接は書き換えられない ──
-- 下の手続きの中からの書き込みだけを通す（手続きが目印を立ててから書く）
create or replace function public.orders_delivered_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_user_role() = 'supplier'
     and new.delivered_dates is distinct from old.delivered_dates
     and coalesce(current_setting('app.delivered_rpc', true), '') <> '1' then
    raise exception '納品の記録は、納品タブから行ってください';
  end if;
  -- キャンセルの確定は、きよかわだけ
  if app_user_role() = 'supplier'
     and new.cancelled_items is distinct from old.cancelled_items then
    raise exception 'キャンセルの確定は、きよかわが行います';
  end if;
  -- 「キャンセル品」の指定も、手続きからだけ
  if app_user_role() = 'supplier'
     and new.cancel_requests is distinct from old.cancel_requests
     and coalesce(current_setting('app.delivered_rpc', true), '') <> '1' then
    raise exception 'キャンセル品の指定は、納品タブから行ってください';
  end if;
  return new;
end
$$;

drop trigger if exists orders_delivered_guard_trg on public.orders;
create trigger orders_delivered_guard_trg
  before update on public.orders
  for each row execute function public.orders_delivered_guard();

-- ── 納品完了を記録する ──
--   p_items … [{ "i":0, "name":"品目名" }, …]
--   p_on    … 納品日
-- 返すもの … { delivered_dates:いまの全体, changed:今回あらたに記録した品目 }
--   もう記録してある品目は飛ばす（2回押しても、お知らせが2回にならないように、changed で分かる）
-- 見えてよい発注かどうかは、発注の表の決まり（RLS）がそのまま効く
create or replace function public.app_mark_delivered(p_order_id bigint, p_items jsonb, p_on date)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  o       public.orders%rowtype;
  today   date := (now() at time zone 'Asia/Tokyo')::date;
  my_role text := app_user_role();
  who     text;
  cur     jsonb;
  list    jsonb;
  it      jsonb;
  src     jsonb;
  idx     int;
  nm      text;
  done    jsonb := '[]'::jsonb;
begin
  if my_role is null or my_role not in ('supplier', 'staff') then
    raise exception '納品を記録する権限がありません';
  end if;
  if p_on is null then
    raise exception '納品日を入れてください';
  end if;
  if p_on > today then
    raise exception '納品日に、先の日付は入れられません';
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception '発注が見つかりません。画面を更新してからお試しください';
  end if;
  if my_role = 'supplier' and o.status is distinct from 'received' then
    raise exception '先に発注書を受領してください';
  end if;
  if o.date is not null and p_on < o.date then
    raise exception '納品日が、発注日より前になっています';
  end if;

  select display_name into who from public.profiles where id = auth.uid();
  cur  := case when jsonb_typeof(o.delivered_dates) = 'array' then o.delivered_dates else '[]'::jsonb end;
  list := case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end;

  for it in select value from jsonb_array_elements(list) loop
    idx := (it->>'i')::int;
    nm  := coalesce(it->>'name', '');
    src := case when jsonb_typeof(o.items) = 'array' then o.items -> idx else null end;
    -- 発注の中にその品目が無い・名前が合わない・送料の行 → 受け付けない
    if idx is null or idx < 0      -- 負の番号は「うしろから数える」意味になってしまうので受け付けない
       or src is null
       or coalesce(src->>'name', '') <> nm
       or coalesce(src->>'isShipping', 'false') = 'true' then
      raise exception '品目が見つかりません（%）。画面を更新してからお試しください', nm;
    end if;
    -- キャンセルになった品目は、納品済みにできない
    if exists (select 1 from jsonb_array_elements(
                 case when jsonb_typeof(o.cancelled_items) = 'array' then o.cancelled_items else '[]'::jsonb end) c
                where c->>'i' = idx::text) then
      raise exception '「%」はキャンセルになっています。画面を更新してください', nm;
    end if;
    -- 「キャンセル品」に指定してあるあいだは、納品済みにできない
    if exists (select 1 from jsonb_array_elements(
                 case when jsonb_typeof(o.cancel_requests) = 'array' then o.cancel_requests else '[]'::jsonb end) c
                where c->>'i' = idx::text) then
      raise exception '「%」はキャンセル品に指定されています。納品するときは、先に指定を取り消してください', nm;
    end if;
    -- もう記録してあるものは飛ばす
    if exists (select 1 from jsonb_array_elements(cur) d
                where d->>'i' = idx::text and coalesce(d->>'name', '') = nm) then
      continue;
    end if;
    cur := cur || jsonb_build_array(jsonb_build_object(
      'i', idx, 'name', nm, 'on', to_char(p_on, 'YYYY-MM-DD'),
      'by', coalesce(who, ''), 'by_id', auth.uid(), 'at', now()));
    done := done || jsonb_build_array(jsonb_build_object('i', idx, 'name', nm));
  end loop;

  if jsonb_array_length(done) > 0 then
    perform set_config('app.delivered_rpc', '1', true);
    update public.orders set delivered_dates = cur where id = p_order_id;
    perform set_config('app.delivered_rpc', '', true);
  end if;

  return jsonb_build_object('delivered_dates', cur, 'changed', done);
end
$$;

-- ── 納品完了を取り消す（押しまちがい用） ──
-- 画面が古いままで、別の記録を消してしまわないように、
-- 納品日と「記録した時刻」（p_at。画面が持っている記録の at）も合っているものだけを消す
-- 返すもの … { delivered_dates:いまの全体, changed:消したかどうか }
create or replace function public.app_unmark_delivered(p_order_id bigint, p_i int, p_name text, p_on date, p_at text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  o       public.orders%rowtype;
  my_role text := app_user_role();
  cur     jsonb;
  nxt     jsonb;
begin
  if my_role is null or my_role not in ('supplier', 'staff') then
    raise exception '納品の記録を変える権限がありません';
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception '発注が見つかりません。画面を更新してからお試しください';
  end if;

  cur := case when jsonb_typeof(o.delivered_dates) = 'array' then o.delivered_dates else '[]'::jsonb end;
  select coalesce(jsonb_agg(t.d order by t.ord), '[]'::jsonb) into nxt
    from jsonb_array_elements(cur) with ordinality as t(d, ord)
   where not (t.d->>'i' = p_i::text
              and coalesce(t.d->>'name', '') = coalesce(p_name, '')
              and coalesce(t.d->>'on', '') = to_char(p_on, 'YYYY-MM-DD')
              and coalesce(t.d->>'at', '') = coalesce(p_at, ''));

  if jsonb_array_length(nxt) = jsonb_array_length(cur) then
    return jsonb_build_object('delivered_dates', cur, 'changed', false);
  end if;

  perform set_config('app.delivered_rpc', '1', true);
  update public.orders set delivered_dates = nxt where id = p_order_id;
  perform set_config('app.delivered_rpc', '', true);

  return jsonb_build_object('delivered_dates', nxt, 'changed', true);
end
$$;

-- ── 業者さんが、品目を「キャンセル品」に指定する ──
-- きよかわから電話などでキャンセルの連絡を受けた品目を、業者さんが納品タブで指定する。
-- これだけではキャンセルにならない。きよかわが確認（承認）して、はじめてキャンセルになる
--   p_items … [{ "i":0, "name":"品目名" }, …]
-- 返すもの … { cancel_requests:いまの全体, changed:今回あらたに指定した品目 }
create or replace function public.app_request_cancel(p_order_id bigint, p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  o       public.orders%rowtype;
  my_role text := app_user_role();
  who     text;
  cur     jsonb;
  list    jsonb;
  it      jsonb;
  src     jsonb;
  idx     int;
  nm      text;
  done    jsonb := '[]'::jsonb;
begin
  if my_role is null or my_role not in ('supplier', 'staff') then
    raise exception 'キャンセル品を指定する権限がありません';
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception '発注が見つかりません。画面を更新してからお試しください';
  end if;

  select display_name into who from public.profiles where id = auth.uid();
  cur  := case when jsonb_typeof(o.cancel_requests) = 'array' then o.cancel_requests else '[]'::jsonb end;
  list := case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end;

  for it in select value from jsonb_array_elements(list) loop
    idx := (it->>'i')::int;
    nm  := coalesce(it->>'name', '');
    src := case when jsonb_typeof(o.items) = 'array' then o.items -> idx else null end;
    if idx is null or idx < 0
       or src is null
       or coalesce(src->>'name', '') <> nm
       or coalesce(src->>'isShipping', 'false') = 'true' then
      raise exception '品目が見つかりません（%）。画面を更新してからお試しください', nm;
    end if;
    -- もう指定してある・もうキャンセルになっているものは飛ばす
    if exists (select 1 from jsonb_array_elements(cur) c where c->>'i' = idx::text)
       or exists (select 1 from jsonb_array_elements(
                    case when jsonb_typeof(o.cancelled_items) = 'array' then o.cancelled_items else '[]'::jsonb end) c
                   where c->>'i' = idx::text) then
      continue;
    end if;
    if exists (select 1 from jsonb_array_elements(
                 case when jsonb_typeof(o.delivered_dates) = 'array' then o.delivered_dates else '[]'::jsonb end) d
                where d->>'i' = idx::text) then
      raise exception '「%」は納品済みになっています。キャンセル品にするには、先に納品完了を取り消してください', nm;
    end if;
    cur := cur || jsonb_build_array(jsonb_build_object(
      'i', idx, 'name', nm, 'by', coalesce(who, ''), 'by_id', auth.uid(), 'at', now()));
    done := done || jsonb_build_array(jsonb_build_object('i', idx, 'name', nm));
  end loop;

  if jsonb_array_length(done) > 0 then
    perform set_config('app.delivered_rpc', '1', true);
    update public.orders set cancel_requests = cur where id = p_order_id;
    perform set_config('app.delivered_rpc', '', true);
  end if;

  return jsonb_build_object('cancel_requests', cur, 'changed', done);
end
$$;

-- ── 「キャンセル品」の指定を外す ──
-- 業者さんが押しまちがいを取り消すとき、または、きよかわが差し戻すとき
-- 返すもの … { cancel_requests:いまの全体, changed:外したかどうか }
-- 一般社員は発注の行を直接は書き換えられないので、この手続きは持ち主の権限で動かす（security definer）。
-- そのぶん、だれが呼んでよいかはここで確かめる：きよかわの社員か、その発注の業者さん
create or replace function public.app_withdraw_cancel(p_order_id bigint, p_i int, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o       public.orders%rowtype;
  my_role text := app_user_role();
  cur     jsonb;
  nxt     jsonb;
begin
  if my_role is null or my_role not in ('supplier', 'staff', 'carpenter') then
    raise exception 'キャンセル品の指定を変える権限がありません';
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception '発注が見つかりません。画面を更新してからお試しください';
  end if;
  -- 業者さんは、自社あての発注だけ
  if my_role = 'supplier' and o.supplier_id is distinct from app_supplier_id() then
    raise exception '発注が見つかりません。画面を更新してからお試しください';
  end if;

  cur := case when jsonb_typeof(o.cancel_requests) = 'array' then o.cancel_requests else '[]'::jsonb end;
  select coalesce(jsonb_agg(t.r order by t.ord), '[]'::jsonb) into nxt
    from jsonb_array_elements(cur) with ordinality as t(r, ord)
   where not (t.r->>'i' = p_i::text and coalesce(t.r->>'name', '') = coalesce(p_name, ''));

  if jsonb_array_length(nxt) = jsonb_array_length(cur) then
    return jsonb_build_object('cancel_requests', cur, 'changed', false);
  end if;

  perform set_config('app.delivered_rpc', '1', true);
  update public.orders set cancel_requests = nxt where id = p_order_id;
  perform set_config('app.delivered_rpc', '', true);

  return jsonb_build_object('cancel_requests', nxt, 'changed', true);
end
$$;

revoke all on function public.app_request_cancel(bigint, jsonb) from public, anon;
revoke all on function public.app_withdraw_cancel(bigint, int, text) from public, anon;
grant execute on function public.app_request_cancel(bigint, jsonb) to authenticated;
grant execute on function public.app_withdraw_cancel(bigint, int, text) to authenticated;

-- ── きよかわが承認して、品目をキャンセルにする（社員。管理者・一般社員） ──
--   p_items  … [{ "i":0, "name":"品目名" }, …]（まるごとキャンセルのときは、送料の行も入れて呼ぶ）
--   p_reason … 理由（空でもよい）
-- 返すもの … { cancelled_items:いまの全体, changed:今回あらたにキャンセルした品目 }
--   ・納品済みの品目はキャンセルできない（先に納品完了を取り消す）
--   ・原価（cost_entries）から、その品目の行を1つ消す
-- 一般社員は発注と原価の行を直接は書き換えられないので、持ち主の権限で動かす（security definer）。
-- 呼べるのは、きよかわの社員（管理者・一般社員）だけ
create or replace function public.app_cancel_order_items(p_order_id bigint, p_items jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o     public.orders%rowtype;
  who   text;
  cur   jsonb;
  dlv   jsonb;
  list  jsonb;
  it    jsonb;
  src   jsonb;
  idx   int;
  nm    text;
  q     numeric;
  done  jsonb := '[]'::jsonb;
begin
  if not app_is_employee() then
    raise exception 'キャンセル品を承認できるのは、きよかわの社員だけです';
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception '発注が見つかりません。画面を更新してからお試しください';
  end if;

  select display_name into who from public.profiles where id = auth.uid();
  cur  := case when jsonb_typeof(o.cancelled_items) = 'array' then o.cancelled_items else '[]'::jsonb end;
  dlv  := case when jsonb_typeof(o.delivered_dates) = 'array' then o.delivered_dates else '[]'::jsonb end;
  list := case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end;

  for it in select value from jsonb_array_elements(list) loop
    idx := (it->>'i')::int;
    nm  := coalesce(it->>'name', '');
    src := case when jsonb_typeof(o.items) = 'array' then o.items -> idx else null end;
    if idx is null or idx < 0 or src is null or coalesce(src->>'name', '') <> nm then
      raise exception '品目が見つかりません（%）。画面を更新してからお試しください', nm;
    end if;
    -- もうキャンセルしてあるものは飛ばす
    if exists (select 1 from jsonb_array_elements(cur) c where c->>'i' = idx::text) then
      continue;
    end if;
    if exists (select 1 from jsonb_array_elements(dlv) d where d->>'i' = idx::text) then
      raise exception '「%」は納品済みになっています。キャンセルするには、先に納品完了を取り消してください', nm;
    end if;

    cur := cur || jsonb_build_array(jsonb_build_object(
      'i', idx, 'name', nm, 'reason', coalesce(p_reason, ''),
      'by', coalesce(who, ''), 'by_id', auth.uid(), 'at', now()));
    done := done || jsonb_build_array(jsonb_build_object('i', idx, 'name', nm));

    -- 原価から、その品目の行を1つ消す。同じ名前の行がいくつかあるときは、数量が合うものを先に選ぶ
    q := case when coalesce(src->>'qty', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (src->>'qty')::numeric else null end;
    delete from public.cost_entries
     where id = (select ce.id from public.cost_entries ce
                  where ce.order_no = o.no
                    and ce.supplier_id is not distinct from o.supplier_id
                    and ce.name = nm
                  order by (case when q is not null and ce.qty = q then 0 else 1 end), ce.id
                  limit 1);
  end loop;

  if jsonb_array_length(done) > 0 then
    -- キャンセルになった品目は、確認待ち（cancel_requests）からも外す
    update public.orders
       set cancelled_items = cur,
           cancel_requests = (
             select coalesce(jsonb_agg(t.r order by t.ord), '[]'::jsonb)
               from jsonb_array_elements(
                      case when jsonb_typeof(o.cancel_requests) = 'array' then o.cancel_requests else '[]'::jsonb end)
                    with ordinality as t(r, ord)
              where not exists (select 1 from jsonb_array_elements(cur) c where c->>'i' = t.r->>'i'))
     where id = p_order_id;
  end if;

  return jsonb_build_object('cancelled_items', cur, 'changed', done);
end
$$;

-- ── 受領のときの「納品予定日は必須」から、キャンセルした品目を外す ──
-- （migration-genba95.sql の決まりを、キャンセルに合わせて入れ直す）
create or replace function public.orders_delivery_required()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  need int;   -- 日付が要る品目の数（送料の行と、キャンセルした品目を除く）
  have int;   -- 日付が入っている品目の数
begin
  if app_user_role() = 'supplier'
     and new.status = 'received'
     and old.status is distinct from 'received' then

    select count(*) into need
      from jsonb_array_elements(case when jsonb_typeof(new.items) = 'array' then new.items else '[]'::jsonb end)
           with ordinality as t(it, ord)
     where coalesce(t.it->>'isShipping', 'false') <> 'true'
       and not exists (select 1 from jsonb_array_elements(
                         case when jsonb_typeof(new.cancelled_items) = 'array' then new.cancelled_items else '[]'::jsonb end) c
                        where c->>'i' = (t.ord - 1)::text);

    select count(*) into have
      from jsonb_array_elements(case when jsonb_typeof(new.delivery_dates) = 'array' then new.delivery_dates else '[]'::jsonb end) d
     where coalesce(d->>'on', '') ~ '^\d{4}-\d{2}-\d{2}$'
       -- キャンセルした品目に付いている日付は数えない
       and not exists (select 1 from jsonb_array_elements(
                         case when jsonb_typeof(new.cancelled_items) = 'array' then new.cancelled_items else '[]'::jsonb end) c
                        where c->>'i' = d->>'i');

    if need > 0 and (new.delivery_on is null or have < need) then
      raise exception '納品予定日を、すべての品目に入れてください。入力欄が出ない場合は、アプリを更新（右上の⟳）してからお試しください';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.app_cancel_order_items(bigint, jsonb, text) from public, anon;
grant execute on function public.app_cancel_order_items(bigint, jsonb, text) to authenticated;
revoke all on function public.app_mark_delivered(bigint, jsonb, date) from public, anon;
revoke all on function public.app_unmark_delivered(bigint, int, text, date, text) from public, anon;
grant execute on function public.app_mark_delivered(bigint, jsonb, date) to authenticated;
grant execute on function public.app_unmark_delivered(bigint, int, text, date, text) to authenticated;

-- 画面から新しい手続きがすぐ呼べるように、決まりを読み直させる
notify pgrst, 'reload schema';

-- ── 確かめる ──
select '納品の列（delivered_dates）' as "項目",
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'orders' and column_name = 'delivered_dates')
            then 'ある' else '無い' end as "結果"
union all
select '記録する手続き（app_mark_delivered）',
       case when to_regprocedure('public.app_mark_delivered(bigint, jsonb, date)') is not null then 'ある' else '無い' end
union all
select '取り消す手続き（app_unmark_delivered）',
       case when to_regprocedure('public.app_unmark_delivered(bigint, int, text, date, text)') is not null then 'ある' else '無い' end
union all
select 'キャンセルの列（cancelled_items）',
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'orders' and column_name = 'cancelled_items')
            then 'ある' else '無い' end
union all
select 'キャンセル品に指定する手続き（app_request_cancel）',
       case when to_regprocedure('public.app_request_cancel(bigint, jsonb)') is not null then 'ある' else '無い' end
union all
select '指定を外す手続き（app_withdraw_cancel）',
       case when to_regprocedure('public.app_withdraw_cancel(bigint, int, text)') is not null then 'ある' else '無い' end
union all
select '承認してキャンセルにする手続き（app_cancel_order_items）',
       case when to_regprocedure('public.app_cancel_order_items(bigint, jsonb, text)') is not null then 'ある' else '無い' end
union all
select '業者が直接書けない見張り',
       case when exists (select 1 from pg_trigger where tgname = 'orders_delivered_guard_trg' and not tgisinternal)
            then 'ある' else '無い' end
union all
select '受領済みで、まだ納品の記録が無い発注（件）',
       (select count(*)::text from public.orders
         where status = 'received' and jsonb_array_length(delivered_dates) = 0);
