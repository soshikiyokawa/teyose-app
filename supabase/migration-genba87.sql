-- ════ マイグレーション87：日報の写真を、案件の現場写真にも並べる ════
-- Supabaseダッシュボード → SQL Editor に全文貼り付けて実行してください。
-- （再実行しても安全です。すでに入っているものは飛ばします）
--
-- これから付ける写真はアプリが自動で入れます。
-- これは、これまでに日報へ付けた写真を後から入れるためのものです。
--
-- 入れる先は、案件ごとの「日報写真」フォルダ（現場写真の中）です。
-- ファイルは上げ直しません。同じものを指す行を足すだけなので、保存している量は増えません。
-- 工事が案件に紐づいていない日報（職業訓練校・その他・休み・欠勤）の写真は対象外です。

-- ── 1. 同じ写真を二重に入れないための索引（消すときにも使う） ──
create index if not exists site_photos_url_idx on public.site_photos (url);

-- ── 2. 案件ごとに「日報写真」フォルダを用意する ──
-- 作った人は入れない（＝変更・削除は管理者のみ。うっかり消されないようにするため）
insert into public.site_folders (project_id, kind, parent_id, name)
select distinct r.project_id, 'photo', null, '日報写真'
from public.nippo_photos p
join public.daily_reports r on r.id = p.report_id
where r.project_id is not null
  and not exists (
    select 1 from public.site_folders f
    where f.project_id = r.project_id and f.kind = 'photo'
      and f.parent_id is null and f.name = '日報写真'
  );

-- ── 3. まだ入っていない写真を、そのフォルダに入れる ──
-- 撮った日は日報の作業日、上げた人は日報に写真を付けた人をそのまま引き継ぐ
insert into public.site_photos (project_id, folder_id, url, caption, shot_date, uploaded_by, uploader_name)
select distinct r.project_id, f.id, p.url, '', r.work_date, p.uploaded_by, coalesce(p.uploader_name,'')
from public.nippo_photos p
join public.daily_reports r on r.id = p.report_id
join public.site_folders f
  on f.project_id = r.project_id and f.kind = 'photo'
 and f.parent_id is null and f.name = '日報写真'
where r.project_id is not null
  and not exists (select 1 from public.site_photos s where s.url = p.url);

-- ── 4. 入ったか確かめる ──
select p.name as 案件, count(*) as 枚数
from public.site_photos s
join public.site_folders f on f.id = s.folder_id
join public.projects p on p.id = s.project_id
where f.kind = 'photo' and f.parent_id is null and f.name = '日報写真'
group by p.name
order by 2 desc, 1;
