-- ════ マイグレーション㉜：エクレアパーツの価格を自動で取り込む ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 品目マスタに「品番」を持たせ、エクレアパーツのオンラインショップから
-- その品番の単価を定期的に取ってくる。取ってきた値は web_price に入れるだけで、
-- 原価（cost）は画面で確認して選んだものだけ書き換える。勝手には変えない。

alter table public.master_items add column if not exists maker_code text default '';
alter table public.master_items add column if not exists web_price integer;
alter table public.master_items add column if not exists web_price_at timestamptz;
alter table public.master_items add column if not exists web_page_code text default '';

comment on column public.master_items.maker_code is 'メーカーの品番（例：30-8582）。エクレアパーツの価格取得に使う';
comment on column public.master_items.web_price is '取得した最新の単価（税抜）。原価に反映するかは画面で選ぶ';
comment on column public.master_items.web_price_at is '価格を取得した日時';
comment on column public.master_items.web_page_code is '商品ページの商品コード（例：SPM09919）。2回目からは検索を省ける';

create index if not exists master_items_maker_code_idx on public.master_items(maker_code) where maker_code <> '';

-- ── 定期取得（毎月1日 9時JST） ──
-- 先に Edge Function をデプロイしてください：
--   supabase functions deploy ekrea-price --no-verify-jwt
select cron.unschedule('ekrea-price-monthly') where exists (
  select 1 from cron.job where jobname = 'ekrea-price-monthly'
);
select cron.schedule(
  'ekrea-price-monthly',
  '0 0 1 * *',
  $$
  select net.http_post(
    url     := 'https://uotzxrwtzlpdnpfbaqpi.supabase.co/functions/v1/ekrea-price',
    headers := '{"Content-Type": "application/json", "x-remind-secret": "0bf6fb2a4cdbb06f967ac194fb2f169de0d6ec0b483c7919"}'::jsonb,
    body    := '{}'::jsonb
  )
  $$
);
