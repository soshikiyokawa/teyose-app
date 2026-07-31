-- ════ マイグレーション㉔：発注の支払方法 ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- レシートから作る発注は「その場で支払い済み」なので、納品希望日ではなく
-- 支払方法（JCB／Visa／現金）を記録する。カード明細との照合にも使う。

alter table public.orders add column if not exists payment_method text default '';

comment on column public.orders.payment_method is '支払方法（JCB／Visa／現金）。レシート取り込みの発注で必須。カード明細の照合に使う';
