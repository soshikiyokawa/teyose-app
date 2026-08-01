-- ════ マイグレーション㉗：案件の表紙写真（外観写真） ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 案件一覧のカードに出す写真を、現場写真の中から1枚選んで固定できるようにする。
-- 未設定の場合は、これまでどおり最新の現場写真を表紙にする。

alter table public.projects add column if not exists cover_photo_id bigint;

comment on column public.projects.cover_photo_id is '案件一覧のカードに出す表紙写真（site_photos.id）。未設定なら最新の写真を使う';

-- 写真が削除されたら表紙の指定も外す
create or replace function public.clear_project_cover() returns trigger
language plpgsql security definer as $$
begin
  update public.projects set cover_photo_id = null where cover_photo_id = old.id;
  return old;
end $$;

drop trigger if exists site_photos_clear_cover on public.site_photos;
create trigger site_photos_clear_cover
  after delete on public.site_photos
  for each row execute function public.clear_project_cover();
