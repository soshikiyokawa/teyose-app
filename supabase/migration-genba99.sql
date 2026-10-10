-- ════ マイグレーション99：可部加工場の在庫を、はじめの数として登録する（83品目） ════
-- Supabaseダッシュボード → SQL Editor に全文貼り付けて実行してください。
-- 先に migration-genba98.sql を実行しておいてください（実行していなくても、要る列はここでも足します）。
-- （再実行しても安全です。同じ品目を2回は入れません）
--
-- 2026-10-10 にいただいた一覧（スマホのメモの写し）のとおりに入れる。
--   ・置き場は「可部加工場」
--   ・数が 0 の品目も、品目として登録する（一覧の「在庫が0の品目も出す」で見える）
--   ・単位と単価は、一覧に無かったので、品目マスタに同じ名前の品目があればそこから取る。
--     無ければ 単位「個」・単価 0円 で入れる。あとで在庫の画面の「単価・単位を直す」から直せる
--     （数が 0 の品目は金額を持てないので、単価は入庫するときに入れる）
--
-- すでに同じ名前の品目が在庫にある場合（「在庫分」で発注した分など）は、数が足されてしまう。
-- そのときは、在庫の画面の「数を直す（棚卸し）」で、実際の数に合わせてください。

alter table public.cost_entries add column if not exists created_by_name text;
alter table public.cost_entries add column if not exists note text;
alter table public.cost_entries add column if not exists stock_place text;

with v(name, qty, note) as (values
  ('ウートップハイムシールド (透湿防水シート)'::text, 10::numeric, ''::text),
  ('ウートップ SD ヴァリオツヴァイ (可変調湿シート)', 14, ''),
  ('改質アスファルトルーフィング', 8, ''),
  ('バリアエース 100S', 0, ''),
  ('SUPER コート EX', 0, ''),
  ('スーパーエアデックス KD30', 1, ''),
  ('西南カバ 15×120×1820 7枚入り', 5, ''),
  ('さくらユニフローリング 15×120×1820 7枚入', 3, ''),
  ('スタイロエースⅡ 45mm', 4, ''),
  ('フェノバボード 90mm', 6, ''),
  ('フェノバボード 60mm', 6, ''),
  ('傾斜パイプ 75mm', 11, ''),
  ('傾斜パイプ 100mm', 3, ''),
  ('傾斜パイプ 150mm', 14, ''),
  ('鋼製束 YR-3045T', 10, ''),
  ('鋼製束 MST-1927L', 3, ''),
  ('バンキョウフロア-WP ガタシシ WP70', 50, ''),
  ('KMP10W(スタイロボンド)', 11, ''),
  ('根太ボンド', 70, ''),
  ('NC45mm ロール釘 ケース', 3, ''),
  ('N75mm ロール釘 ケース', 7, ''),
  ('N90mm ロール釘 ケース', 1, ''),
  ('NZ50mm ロール釘 ケース', 1, ''),
  ('N50mm ロール釘 ケース', 1, ''),
  ('CN50mm ロール釘 ケース', 2, ''),
  ('ウルト トップヘッド木製外壁用ビス 3.1×50mm', 5, ''),
  ('キソパッキンロング KP-L102', 25, ''),
  ('キソパッキンロング KP-L120', 33, ''),
  ('気密パッキンロング KPK-N105', 5, ''),
  ('気密パッキンロング KPK-N 120', 15, ''),
  ('基礎貫通スリーブ KSA75NX230H', 0, ''),
  ('基礎貫通スリーブ KSA50NX230H', 0, ''),
  ('防虫網ロール', 0, ''),
  ('防水水切シート', 0, ''),
  ('パネリード S PS8-290', 5, ''),
  ('パネリード II+ 120mm 100本入り/袋', 6, ''),
  ('シロアリポリス', 0, ''),
  ('硫酸第一鉄 500g', 10, ''),
  ('野縁 30×40×4000 10本/束', 6, ''),
  ('野縁 30×40×3000 10本/束', 5, ''),
  ('胴縁 16×40×3000 15本/束', 3, ''),
  ('間柱 30×105×3000 5本/束', 1, ''),
  ('間柱 45×105×4000 3本/束', 2, ''),
  ('間柱 45×105×3000 3本/束', 4, ''),
  ('垂木 45×60×4000 4本/束', 0, ''),
  ('垂木 45×90×4000 3本/束', 4, ''),
  ('タイガーEX ハイパー 3×10', 5, ''),
  ('ノボパン', 13, ''),
  ('構造用合板 12mm', 0, ''),
  ('構造用合板 24mm サネ付き', 0, ''),
  ('ドームパッキン', 43, ''),
  ('ゴームパッキン', 11, ''),
  ('フックコーナー', 3, ''),
  ('スモールコーナー', 12, ''),
  ('シナーコーナー', 6, ''),
  ('オメガコーナー', 0, ''),
  ('ビスどめホールダウン U15', 0, ''),
  ('ビスどめホールダウン U20', 0, ''),
  ('ビスどめホールダウン U25', 0, ''),
  ('ザボレス', 27, ''),
  ('オメガ短冊プレート 2枚/セット', 9, ''),
  ('エースクロス 011 白', 0, ''),
  ('エースクロス 011 黒', 22, ''),
  ('エースクロス SBW', 15, ''),
  ('片面ブチルテープ 50mm', 0, ''),
  ('ホワイトシート 3.6m×5.4m', 0, ''),
  ('庇腕木受け金物', 0, ''),
  ('自然給気口 150mm', 17, ''),
  ('VD-10ZVC7', 6, ''),
  ('V-08PLD8', 2, ''),
  ('電動給気シャッターP-18QDL6-BL', 3, ''),
  ('H8KS662BK', 0, ''),
  ('デュポンタイベックハード', 0, ''),
  ('ワキワキウォール', 1, ''),
  ('白ポリランバー15mm厚', 4, '引き出しの立ち上がり部分が取れるくらいのあまり'),
  ('幅はぎ25×480×2000', 2, ''),
  ('幅はぎ25×480×3000', 0, ''),
  ('幅はぎ25×640×2000', 2, ''),
  ('幅はぎ25×640×3000', 0, ''),
  ('幅はぎ30×480×2000', 0, ''),
  ('幅はぎ30×480×3000', 0, ''),
  ('幅はぎ30×640×2000', 1, ''),
  ('幅はぎ30×640×3000', 0, '')
)
insert into public.cost_entries
  (date, project, name, qty, unit, amount, supplier_id, order_no, cost_type, status, created_by_name, note, stock_place)
select (now() at time zone 'Asia/Tokyo')::date, '在庫分', v.name, v.qty,
       coalesce(nullif(m.unit, ''), '個'),
       round(v.qty * coalesce(m.cost, 0)),
       null, '在庫:初期登録', '材料費', 'received', '初期登録', v.note, '可部加工場'
  from v
  left join lateral (
    select mi.unit, mi.cost from public.master_items mi where mi.name = v.name order by mi.id limit 1
  ) m on true
 where not exists (
   select 1 from public.cost_entries e
    where e.name = v.name and e.order_no = '在庫:初期登録'
      and coalesce(e.stock_place, '可部加工場') = '可部加工場');

-- ── 確かめる ──
select 'はじめの数として登録した品目（83のはず）' as "項目",
       (select count(*)::text from public.cost_entries where order_no = '在庫:初期登録') as "結果"
union all
select 'うち、数が 0 の品目',
       (select count(*)::text from public.cost_entries where order_no = '在庫:初期登録' and qty = 0)
union all
select 'うち、品目マスタに同じ名前が無かった品目（単位「個」・単価0円で入れた）',
       (select count(*)::text from public.cost_entries e
         where e.order_no = '在庫:初期登録'
           and not exists (select 1 from public.master_items mi where mi.name = e.name))
union all
select 'うち、前から在庫に同じ名前があった品目（数が足されているので、棚卸しで直す）',
       (select count(*)::text from public.cost_entries e
         where e.order_no = '在庫:初期登録'
           and exists (select 1 from public.cost_entries o
                        where o.name = e.name and o.project = '在庫分' and o.id < e.id
                          and coalesce(o.order_no, '') <> '在庫:初期登録'));
