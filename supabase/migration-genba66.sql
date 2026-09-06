-- ════ 日報の写真に、SNS向きかどうかの点数を持たせる ════
--
-- 日報で集まった写真を一覧で見て、Instagramに載せるならどれがよいかを
-- AIに100点満点で採点させる。点数と一言コメントを写真の行に持つ。
--
-- 採点は Edge Function（score-photo）がサービスロールで書き込む。
-- 誰の写真でも社員なら採点を頼めるが、写真そのものの追加・削除は
-- これまでどおり日報を直せる人だけ（migration-genba65.sql の許可はそのまま）。

alter table public.nippo_photos add column if not exists ig_score     smallint;
alter table public.nippo_photos add column if not exists ig_comment   text not null default '';
alter table public.nippo_photos add column if not exists ig_scored_at timestamptz;

alter table public.nippo_photos drop constraint if exists nippo_photos_ig_score_ck;
alter table public.nippo_photos add constraint nippo_photos_ig_score_ck
  check (ig_score is null or (ig_score >= 0 and ig_score <= 100));

comment on column public.nippo_photos.ig_score is
  'Instagramに載せるのに向いているかの点数（0〜100）。null＝まだ採点していない';
comment on column public.nippo_photos.ig_comment is 'なぜその点数なのかの一言';
comment on column public.nippo_photos.ig_scored_at is '採点した日時';

-- 点数の高い順に並べるため
create index if not exists nippo_photos_ig_idx
  on public.nippo_photos(ig_score desc nulls last, id desc);
