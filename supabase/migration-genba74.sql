-- ════ アカウントの名前を、後から変えられるようにする ════
--
-- この仕組みでは、人の名前が「名前そのもの」としてあちこちに入っている。
--   ・案件の参加メンバー（projects.members）… 案件チャット・現場写真が見られるかの判定にも使う
--   ・チャットの発言者名、既読、リアクション、ブックマーク
--   ・日報・有給・休日出勤の申請者名と承認者名
--   ・発注書の担当者、受領した人、写真や図面を上げた人、タスクの担当 など
--
-- そのため display_name だけを書き換えると、その人が案件チャットから外れたり、
-- 過去の記録が別人のものに見えたりする。ここでは、それら全部を一度に付け替える。

-- jsonb の配列（["名前A","名前B"]）の中の名前を入れ替える
create or replace function public.app__rename_in_jsonb_array(arr jsonb, old_v text, new_v text)
returns jsonb language sql immutable as $$
  select coalesce(
    (select jsonb_agg(case when e = to_jsonb(old_v) then to_jsonb(new_v) else e end)
     from jsonb_array_elements(arr) e),
    arr)
$$;

create or replace function public.app_rename_user(p_user_id uuid, p_new_name text)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_old text;
  v_new text := btrim(coalesce(p_new_name, ''));
begin
  -- 管理者だけが実行できる
  if coalesce(app_user_role(), '') <> 'staff' then
    raise exception '名前の変更は管理者のみです';
  end if;
  if v_new = '' then
    raise exception '名前を入力してください';
  end if;
  if length(v_new) > 60 then
    raise exception '名前が長すぎます';
  end if;

  select display_name into v_old from public.profiles where id = p_user_id;
  if v_old is null then
    raise exception 'そのアカウントが見つかりません';
  end if;
  if v_old = v_new then
    return jsonb_build_object('ok', true, 'changed', false, 'name', v_new);
  end if;
  -- 名前は参加メンバーの判定にも使うので、同じ名前が2人いると区別できない
  if exists (select 1 from public.profiles where display_name = v_new and id <> p_user_id) then
    raise exception '同じ名前のアカウントが既にあります。別の書き方にしてください';
  end if;

  -- ① 名簿
  update public.profiles set display_name = v_new where id = p_user_id;

  -- ② 案件の参加メンバー（ここを直さないと、その人が案件チャットから外れてしまう）
  update public.projects
     set members = app__rename_in_jsonb_array(members, v_old, v_new)
   where members ? v_old;
  update public.projects
     set client_chat_member_names = array_replace(client_chat_member_names, v_old, v_new)
   where v_old = any(client_chat_member_names);

  -- ③ チャット
  update public.chat_groups
     set member_names = array_replace(member_names, v_old, v_new)
   where v_old = any(member_names);
  update public.chat_messages set sender_name    = v_new where sender_name    = v_old;
  update public.chat_messages set reply_to_sender = v_new where reply_to_sender = v_old;
  update public.chat_messages
     set bookmarks = app__rename_in_jsonb_array(bookmarks, v_old, v_new)
   where bookmarks ? v_old;
  update public.chat_messages
     set reactions = coalesce(
       (select jsonb_object_agg(k, app__rename_in_jsonb_array(v, v_old, v_new))
        from jsonb_each(reactions) as t(k, v)), reactions)
   where reactions::text like '%' || v_old || '%';
  update public.chat_reads set user_name = v_new where user_name = v_old;

  -- ④ 勤怠・申請
  update public.daily_reports set user_name        = v_new where user_name        = v_old;
  update public.daily_reports set ot_approver_name = v_new where ot_approver_name = v_old;
  update public.daily_reports set ot_reviewer_name = v_new where ot_reviewer_name = v_old;
  update public.leave_requests   set user_name     = v_new where user_name     = v_old;
  update public.leave_requests   set reviewer_name = v_new where reviewer_name = v_old;
  update public.holiday_requests set user_name     = v_new where user_name     = v_old;
  update public.holiday_requests set approver_name = v_new where approver_name = v_old;
  update public.holiday_requests set reviewer_name = v_new where reviewer_name = v_old;

  -- ⑤ 現場・受発注・そのほか
  update public.site_photos  set uploader_name = v_new where uploader_name = v_old;
  update public.drawings     set uploader_name = v_new where uploader_name = v_old;
  update public.nippo_photos set uploader_name = v_new where uploader_name = v_old;
  update public.drawing_views set user_name    = v_new where user_name     = v_old;
  update public.orders set created_by_name = v_new where created_by_name = v_old;
  update public.orders set received_by     = v_new where received_by     = v_old;
  update public.invoices set uploaded_by = v_new where uploaded_by = v_old;
  update public.tasks set created_by  = v_new where created_by  = v_old;
  update public.tasks set done_by     = v_new where done_by     = v_old;
  update public.tasks set anchor_name = v_new where anchor_name = v_old;
  update public.tasks
     set assignees = app__rename_in_jsonb_array(assignees, v_old, v_new)
   where assignees ? v_old;

  -- 表が無い環境でも止めないもの（あとから足した機能）
  begin
    update public.task_templates set anchor_name = v_new where anchor_name = v_old;
    update public.task_templates
       set assignees = app__rename_in_jsonb_array(assignees, v_old, v_new)
     where assignees ? v_old;
  exception when undefined_table then null; end;
  begin
    update public.licenses set user_name  = v_new where user_name  = v_old;
    update public.licenses set updated_by = v_new where updated_by = v_old;
  exception when undefined_table then null; end;
  begin
    update public.vehicles set manager_name = v_new where manager_name = v_old;
    update public.vehicle_records set user_name = v_new where user_name = v_old;
  exception when undefined_table then null; end;
  begin
    update public.inspection_records set user_name = v_new where user_name = v_old;
  exception when undefined_table then null; end;
  begin
    update public.item_price_changes set changed_by = v_new where changed_by = v_old;
  exception when undefined_table then null; end;
  begin
    update public.invoice_read_hints set created_by = v_new where created_by = v_old;
  exception when undefined_table then null; end;
  begin
    update public.employee_salaries set user_name  = v_new where user_name  = v_old;
    update public.employee_salaries set updated_by = v_new where updated_by = v_old;
  exception when undefined_table then null; end;
  begin
    update public.app_settings set updated_by = v_new where updated_by = v_old;
  exception when undefined_table then null; end;

  return jsonb_build_object('ok', true, 'changed', true, 'from', v_old, 'to', v_new);
end
$$;

comment on function public.app_rename_user(uuid, text) is
  'アカウントの表示名を変え、名前で持っている所（案件の参加メンバー・チャット・日報など）もまとめて付け替える。管理者のみ';

revoke all on function public.app_rename_user(uuid, text) from public;
grant execute on function public.app_rename_user(uuid, text) to authenticated;
