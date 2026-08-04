-- ════ マイグレーション㉝：エクレアパーツのカタログ索引（品番を自動で探すため） ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です。マイグレーション㉜の後に実行してください）
--
-- エクレアのサイトは商品名で検索してもヒットしないため、こちらで
-- 「品番 → 商品名・単価」の索引を持っておき、品目マスタの品目名と突き合わせて
-- 品番の候補を出せるようにする。
--
--   ekrea_pages   … 商品ページの一覧（どこまで読んだかの記録）
--   ekrea_catalog … 品番ごとの商品名と単価

create table if not exists public.ekrea_pages (
  page_code text primary key,          -- 商品ページの商品コード（例：SPM09919）
  listed_at timestamptz default now(), -- カテゴリ一覧で見つけた日時
  crawled_at timestamptz,              -- 中身を読んだ日時（未読はnull）
  rows int default 0                   -- そのページに載っていた品番の数
);

create table if not exists public.ekrea_catalog (
  maker_code text primary key,         -- 品番（例：30-8582）
  name text default '',                -- 商品名
  price integer,                       -- 単価（税抜）
  page_code text default '',           -- 載っている商品ページ
  updated_at timestamptz default now()
);

create index if not exists ekrea_pages_todo_idx on public.ekrea_pages(crawled_at nulls first);

-- 社内（staff＋carpenter）は参照だけできる。書き込みはEdge Function（service role）だけ
alter table public.ekrea_pages enable row level security;
alter table public.ekrea_catalog enable row level security;
drop policy if exists ekrea_pages_select on public.ekrea_pages;
create policy ekrea_pages_select on public.ekrea_pages for select using (app_is_employee());
drop policy if exists ekrea_catalog_select on public.ekrea_catalog;
create policy ekrea_catalog_select on public.ekrea_catalog for select using (app_is_employee());

-- ── カタログの取り込み（毎日3時JSTに少しずつ進める） ──
-- 先に Edge Function をデプロイしてください：
--   supabase functions deploy ekrea-catalog --no-verify-jwt
select cron.unschedule('ekrea-catalog-daily') where exists (
  select 1 from cron.job where jobname = 'ekrea-catalog-daily'
);
select cron.schedule(
  'ekrea-catalog-daily',
  '0 18 * * *',
  $$
  select net.http_post(
    url     := 'https://uotzxrwtzlpdnpfbaqpi.supabase.co/functions/v1/ekrea-catalog',
    headers := '{"Content-Type": "application/json", "x-remind-secret": "0bf6fb2a4cdbb06f967ac194fb2f169de0d6ec0b483c7919"}'::jsonb,
    body    := '{}'::jsonb
  )
  $$
);
