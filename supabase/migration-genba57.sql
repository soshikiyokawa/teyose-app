alter table public.master_items add column if not exists shipping integer not null default 0;
alter table public.master_items add column if not exists shipping_per text not null default 'order';
alter table public.master_items drop constraint if exists master_items_shipping_per_ck;
alter table public.master_items add constraint master_items_shipping_per_ck check (shipping_per in ('order','unit'));
comment on column public.master_items.shipping is 'メーカー送料（円）。0なら送料なし';
comment on column public.master_items.shipping_per is 'order＝1回の発注につき1回／unit＝1つごとにかかる';
