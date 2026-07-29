-- ════ マイグレーション⑳：有給残日数の管理 ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 就業規則 第54条にもとづき、雇用契約開始日から付与日・付与日数を自動計算するため、
-- profiles に「雇用契約開始日」を追加する。
-- あわせて、アプリ導入前に取得した分などを反映するための「調整日数」を追加する。

alter table public.profiles add column if not exists hire_date date;
alter table public.profiles add column if not exists leave_adjust numeric not null default 0;
alter table public.profiles add column if not exists leave_adjust_note text default '';

comment on column public.profiles.hire_date is '雇用契約開始日（年次有給休暇の付与日・付与日数の計算に使用）';
comment on column public.profiles.leave_adjust is '有給残日数の調整（＋／−日数）。アプリ導入前の残日数・取得分を反映するために使う';
comment on column public.profiles.leave_adjust_note is '調整の理由メモ';

-- 参照・更新のポリシーは既存のものをそのまま使う
--   profiles_select：本人 または 管理者（staff）
--   profiles_update：管理者（staff）のみ
-- ＝ 社員は自分の残日数を見られるが、入社日・調整の変更は管理者だけができる。
