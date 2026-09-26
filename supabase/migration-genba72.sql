-- ════ パスワードを決めてもらうまで、アプリを使えないようにする ════
--
-- これまでは「招待メールのリンクから来たかどうか」をURLだけで見ていたため、
-- リンクを開いたあとに画面を読み込み直すと、パスワードを決めないまま
-- 使えてしまっていた（リンクで入った時点でログイン状態になるため）。
--
-- 誰がまだパスワードを決めていないかを、アカウントごとに覚えておく。

-- 既にお使いの方はパスワードを決めてあるので、初期値は true
alter table public.profiles add column if not exists password_set boolean not null default true;

comment on column public.profiles.password_set is
  'ご自分でパスワードを決めたか。招待した直後は false。false の間は、アプリを開くとパスワード設定の画面が出る';

-- ご本人が「決めました」と記録するための手続き。
-- profiles を直せるのは管理者だけなので、ここだけ本人に許す（自分の行のみ）
create or replace function public.app_mark_password_set()
returns void
language sql volatile security definer
set search_path = public
as $$
  update public.profiles set password_set = true where id = auth.uid()
$$;
grant execute on function public.app_mark_password_set() to authenticated;
