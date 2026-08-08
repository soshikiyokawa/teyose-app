-- ════ マイグレーション㊷：1つの発注先に複数のアカウント ════
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- （再実行しても安全です）
--
-- これまでは「1つの発注先＝1つのアカウント」を前提にしていて、
-- 案件の参加メンバーの判定もアカウントの表示名で行っていた。
--   案件のメンバー：['清川創史', '山田建材']  ← 山田建材＝アカウントの表示名
--
-- 発注先に何人か担当者がいる場合は、1人1アカウントにした方が
-- 「誰がやったか」が残り、担当が代わったときもその人だけ止められる。
-- そこでメンバーの判定を、表示名だけでなく「所属している発注先の名前」でも
-- 通るようにする。案件のメンバーに会社名が入っていれば、その会社の
-- アカウント全員が見られる（あとから人が増えても設定し直さなくてよい）。
--
-- これまでの設定（会社名＝そのアカウントの表示名）もそのまま通るので、
-- 既存の案件データを直す必要はない。

create or replace function public.app_is_project_member(p_id bigint) returns boolean
language sql stable security definer as $$
  select coalesce((
    select
      -- ① 自分の表示名が参加メンバーに入っている（社員・発注先どちらも）
      p.members ? (select display_name from public.profiles where id = auth.uid())
      -- ② 発注先の場合は、所属している会社の名前が入っていてもよい
      or coalesce((
        select p.members ? s.name
        from public.suppliers s
        where s.id = (select supplier_id from public.profiles where id = auth.uid())
      ), false)
    from public.projects p where p.id = p_id
  ), false)
$$;

comment on function public.app_is_project_member(bigint) is
  '案件の参加メンバーかどうか。自分の表示名、または所属している発注先の名前が members に入っていれば true';
