-- ════ 発注先の人も、チャットの通知先を指名できるようにする ════
--
-- これまで発注先のアカウントは社員の名簿を一切読めず、
-- 通知先を選ぶ画面に候補が出せないため、宛先の指定バーが出なかった。
--
-- 名前と区分だけの名簿を用意する。発注先の人から見えるのは
--   ・きよかわの社員（管理者・一般社員）
--   ・自分と同じ発注先の担当者
-- だけ。給与・有給などの列は入っていない。

create or replace view public.chat_directory as
  select p.id, p.display_name, p.role, p.supplier_id
    from public.profiles p
   where app_is_employee()
      or ( app_user_role() = 'supplier'
           and ( p.role in ('staff','carpenter') or p.supplier_id = app_supplier_id() ) );

grant select on public.chat_directory to authenticated;

comment on view public.chat_directory is
  'チャットの通知先を選ぶための名簿。発注先の人にはきよかわの社員と自社の担当者だけを見せる';
