-- ════ マイグレーション㊿：有給残が足りないときの欠勤扱い ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- 有給の申請を承認するとき、その人の残日数が足りなければ、
-- 足りない日を「欠勤」として扱う。承認そのものは通す。
--
--   absence_dates … 欠勤扱いにした日（'YYYY-MM-DD' の配列）
--                   残が一部だけ足りない場合は、古い日から有給を当てて、
--                   あふれた後ろの日を欠勤にする
--
-- 出面表ではその日を「欠」と出し、有給日数には数えない。
-- 残日数の計算でも、欠勤にした分は有給を使っていないものとして扱う。

alter table public.leave_requests
  add column if not exists absence_dates jsonb not null default '[]'::jsonb;

comment on column public.leave_requests.absence_dates is
  '有給残が足りず欠勤扱いにした日付の配列。出面表では「欠」と表示し、有給日数には数えない';
