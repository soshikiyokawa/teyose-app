-- ════ マイグレーション⑦：発注先「在庫分」（在庫出庫用）を追加 ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）

-- 在庫から現場へ出す時に使う疑似発注先。
-- 入庫＝案件「在庫分」で発注／出庫＝発注先「在庫分」で現場向けに発注
insert into public.suppliers (name, contact, note, sort_order)
select '在庫分', '', '自社在庫（在庫から現場へ出す時に使う発注先。削除しないでください）', 999
where not exists (select 1 from public.suppliers where name = '在庫分');
