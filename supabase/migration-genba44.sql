-- ════ マイグレーション㊹：タスクの引き継ぎ ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- チェックリストの途中まで進めて、その先を別の人に渡す場合の記録。
--   ・handoffs … 引き継ぎの履歴。[{at, from, to:[名前], note, done, total}]
--     渡した時点で「いくつ終わっていたか」も一緒に残すので、
--     受け取った人はどこから続ければよいかが分かる
--   ・チェックリストの各項目には、済にした人と日時（by / at）が入るようになる
--     （これまでの項目は by / at が空のまま。表示のときに出さないだけで問題ない）
--
-- 引き継ぎができるのはきよかわの社員だけ。発注先は担当者を変えられないので
-- （migration-genba43.sql の tasks_guard トリガー）、これまでどおり
-- 「済／未済」とチェックリストだけを触る。

alter table public.tasks add column if not exists handoffs jsonb not null default '[]'::jsonb;

comment on column public.tasks.handoffs is
  'タスクの引き継ぎ履歴。[{at, from, to:[名前], note, done, total}]。done/totalは渡した時点のチェックリストの進み具合';

-- 発注先が引き継ぎの履歴を書き換えられないように、トリガーで元の値に戻す
create or replace function public.tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if not app_is_employee() then
    new.title      := old.title;
    new.detail     := old.detail;
    new.project_id := old.project_id;
    new.assignees  := old.assignees;
    new.due_date   := old.due_date;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.handoffs   := old.handoffs;
  end if;
  return new;
end $$;
