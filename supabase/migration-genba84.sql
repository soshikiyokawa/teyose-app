-- ════ 人員配置の現場名を案件名に当てはめる【実行】 ════
--
-- 先に migration-genba83.sql（下見）を実行して、中身を確かめてから流すこと。
-- 当てはめ方と関数は genba83 で作ってある（このファイルは当てはめるだけ）。
--
-- 何度実行しても同じ結果になる（すでに案件名そのものになっている行は触らない）。
-- 当てはまらないもの（「板どぶ漬け」など）は、そのまま残る。

begin;

update public.staff_assignments a
   set project_name = public.ss_match(a.project_name),
       note = case
                -- はみ出した言葉が無ければ、メモはそのまま
                when public.ss_rest(a.project_name, public.ss_match(a.project_name)) = '' then a.note
                -- メモが空なら、そのまま入れる
                when coalesce(a.note,'') = '' then public.ss_rest(a.project_name, public.ss_match(a.project_name))
                -- すでに同じ言葉が入っていれば、足さない
                when a.note = public.ss_rest(a.project_name, public.ss_match(a.project_name)) then a.note
                -- それ以外は、うしろに足す
                else a.note || '／' || public.ss_rest(a.project_name, public.ss_match(a.project_name))
              end
 where public.ss_match(a.project_name) is not null
   -- すでに案件名そのものになっている行は触らない
   and not exists (select 1 from public.projects p where p.name = a.project_name);

commit;

-- ── 当てたあとの確認 ──
--
-- ① いまの中身。「案件あり」が ○ なら手寄の案件とつながっている
select person as "社員大工", project_name as "現場", nullif(note,'') as "メモ",
       start_date as "はじめ", end_date as "おわり",
       case when exists (select 1 from public.projects p where p.name = staff_assignments.project_name)
            then '○' else '—' end as "案件あり"
  from public.staff_assignments
 order by person, start_date;

-- ② まだ案件につながっていない現場（「板どぶ漬け」など、そのままでよいものだけのはず）
select project_name as "案件につながっていない現場", count(*) as "件数"
  from public.staff_assignments a
 where not exists (select 1 from public.projects p where p.name = a.project_name)
 group by project_name
 order by 2 desc, 1;
