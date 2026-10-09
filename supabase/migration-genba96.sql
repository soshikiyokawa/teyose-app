-- ════ マイグレーション96：業者さんが「納品完了」を品目ごとに記録する ════
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
select '業者が直接書けない見張り',
       case when exists (select 1 from pg_trigger where tgname = 'orders_delivered_guard_trg' and not tgisinternal)
            then 'ある' else '無い' end
union all
select '受領済みで、まだ納品の記録が無い発注（件）',
       (select count(*)::text from public.orders
         where status = 'received' and jsonb_array_length(delivered_dates) = 0);
