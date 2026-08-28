-- ════ 既存の案件すべてに、管理者を参加メンバーとして足す ════
-- すでに入っている人はそのまま。重複はしない。
with staff as (
  select display_name from public.profiles where role='staff' and coalesce(display_name,'')<>''
)
update public.projects p
   set members = (
     select coalesce(jsonb_agg(v order by v), '[]'::jsonb)
       from (
         select jsonb_array_elements_text(coalesce(p.members,'[]'::jsonb)) as v
         union
         select display_name from staff
       ) u
   )
 where exists (select 1 from staff s where not coalesce(p.members,'[]'::jsonb) ? s.display_name);

select p.name as 案件, jsonb_array_length(p.members) as 人数,
       (select count(*) from public.profiles s
         where s.role='staff' and coalesce(s.display_name,'')<>'' and not p.members ? s.display_name) as 足りない管理者
  from public.projects p order by p.name;
