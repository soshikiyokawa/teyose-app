-- ════ 人員配置スケジュール ════
--
-- 誰がいつどの現場に入るかを、工程表と同じ形（ガントチャート）で見るための表。
--   ・社員大工ごとに1本の帯があり、その下に「いつ・どの現場」が並ぶ
--   ・1行＝1人の1回の配置。工程表のように全体を1枚で保存せず、
--     足した・直した・消したをその場で書き込む
--     （何人かが同時にいじっても、お互いの分を消し合わないようにするため）
--
-- 見られるのは社員（staff・carpenter）だけ。直せるのは管理者（staff）だけ。

create table if not exists public.staff_assignments (
  id bigint generated always as identity primary key,
  person       text not null,                 -- 社員大工（js/genba/staff-schedule.js の STAFF_CARPENTERS と合わせる）
  project_name text not null default '',      -- 入る現場。案件以外（設計・事務など）も入れられるよう文字で持つ
  start_date   date not null,
  end_date     date not null,
  note         text default '',
  created_by   text default '',               -- 入れた人の表示名（履歴の手がかり）
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

comment on table public.staff_assignments is
  '人員配置スケジュール。1行＝社員大工1人の1回の現場入り。勤怠日報→日報タブの左に出る';

create index if not exists staff_assignments_person_idx on public.staff_assignments(person, start_date);
create index if not exists staff_assignments_term_idx   on public.staff_assignments(start_date, end_date);

-- 期間が逆さまに入らないようにする
alter table public.staff_assignments drop constraint if exists staff_assignments_term_chk;
alter table public.staff_assignments add constraint staff_assignments_term_chk
  check (end_date >= start_date);

-- 直した時刻を自動で入れる
create or replace function public.staff_assignments_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists staff_assignments_touch_trg on public.staff_assignments;
create trigger staff_assignments_touch_trg before update on public.staff_assignments
  for each row execute function public.staff_assignments_touch();

alter table public.staff_assignments enable row level security;

-- 社員は見られる（誰がどこに入るかは全員が知っておきたいもの）
drop policy if exists staff_assignments_select on public.staff_assignments;
create policy staff_assignments_select on public.staff_assignments
  for select using (app_is_employee());

-- 入れる・直す・消すのは管理者だけ（配置を決めるのは管理者のため）
drop policy if exists staff_assignments_insert on public.staff_assignments;
create policy staff_assignments_insert on public.staff_assignments
  for insert with check (app_user_role() = 'staff');

drop policy if exists staff_assignments_update on public.staff_assignments;
create policy staff_assignments_update on public.staff_assignments
  for update using (app_user_role() = 'staff') with check (app_user_role() = 'staff');

drop policy if exists staff_assignments_delete on public.staff_assignments;
create policy staff_assignments_delete on public.staff_assignments
  for delete using (app_user_role() = 'staff');

-- 他の端末での変更をすぐ反映できるようにする（工程表と同じ仕組み）
do $$
begin
  alter publication supabase_realtime add table public.staff_assignments;
exception
  when duplicate_object then null;   -- すでに入っていれば何もしない
  when undefined_object then null;   -- publication が無ければ何もしない
end $$;
