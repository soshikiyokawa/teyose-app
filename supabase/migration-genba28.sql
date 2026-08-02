-- ════ マイグレーション㉘：着工日・引渡日（実績） ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 案件の「着工予定日」「完工予定日」に対して、実際の日付を記録できるようにする。
-- 実績を入れると、案件情報・案件一覧の表示が「着工日」「引渡日」に変わる。

alter table public.projects add column if not exists actual_start_date date;
alter table public.projects add column if not exists handover_date date;

comment on column public.projects.actual_start_date is '着工日（実績）。入れると「着工予定日」の表示が「着工日」に変わる';
comment on column public.projects.handover_date is '引渡日（実績）。入れると「完工予定日」の表示が「引渡日」に変わる';
