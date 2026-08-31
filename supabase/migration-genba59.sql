-- ════ 品目に「1束あたりの本数」を持たせる ════
-- 木材は束で届くので、本数と束数を行き来できるようにする。0＝束の考え方なし。
alter table public.master_items add column if not exists per_bundle integer not null default 0;
alter table public.master_items drop constraint if exists master_items_per_bundle_ck;
alter table public.master_items add constraint master_items_per_bundle_ck check (per_bundle >= 0 and per_bundle <= 9999);
comment on column public.master_items.per_bundle is '1束あたりの本数。0なら束では扱わない';
