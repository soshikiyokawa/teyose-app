-- ════ マイグレーション㉕：カード明細の種別（JCB／Visa） ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- Visaの明細も取り込めるようにするため、明細がどのカードのものかを記録する。
-- 発注の支払方法（JCB／Visa／現金）と突き合わせて、誤った照合を防ぐ。

alter table public.card_statements add column if not exists brand text not null default 'JCB';

comment on column public.card_statements.brand is 'カードの種別（JCB／Visa）。発注の支払方法と一致するものだけを照合する';

-- 取り込み済みの明細はすべてJCBなので、既定値のままでよい
