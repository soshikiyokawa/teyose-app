-- ════ お客様が案件の中身を見られてしまう穴を閉じる（至急） ════
--
-- 何が起きていたか
--   app_is_project_member() は「自分の表示名が projects.members に入っているか」で判定していた。
--   同じ方が業者としても関わっている場合、お客様用のアカウントを別のメールアドレスで作っても
--   表示名が同じなので、お客様のアカウントまで案件のメンバー扱いになっていた。
--   その結果、案件チャット（社内と業者のやりとり）・現場写真・図面・工程表・案件そのものが
--   お客様から見えてしまっていた。
--
-- 決めごと
--   お客様（client）は「お客様チャット」だけの役割で、案件には参加しない。
--   名前が一致してもメンバーとは扱わない。
--
-- この1か所を直すと、これを使っている次のすべてが同時に閉まる：
--   chat_messages（案件チャット）／site_photos／drawings／site_folders／projects／schedules

create or replace function public.app_is_project_member(p_id bigint)
returns boolean
language sql stable security definer
as $$
  select case
    -- お客様は案件に参加しない（名前が業者の方と同じでもメンバーにしない）
    when (select role from public.profiles where id = auth.uid()) = 'client' then false
    else coalesce((
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
  end
$$;

comment on function public.app_is_project_member(bigint) is
  '案件の参加メンバーか（表示名で判定）。お客様（client）は参加しないので常に false';
