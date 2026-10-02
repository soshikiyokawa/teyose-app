-- ════ 人員配置の現場名を案件名に当てはめる【実行】 ════
--
-- 先に migration-genba83.sql（下見）を実行して、中身を確かめてから流すこと。
-- 当てはめ方と関数は genba83 で作ってある。
--
-- 当てはめは2段。
--   ① 人が決めた対応表（下の fix）。同じ名字の案件が2件あって機械では決められなかったもの
--   ② 残りを、genba83 の決まりで自動的に当てはめる
--
-- 何度実行しても同じ結果になる（すでに案件名そのものになっている行は触らない）。
-- 当てはまらないもの（「板どぶ漬け」など）は、そのまま残る。

begin;

-- ── ① 人が決めた対応表 ──
--
-- 下見の③に出た「候補が2件あるもの」。どちらか機械には決められないので、
-- 清川さんに確認して決めた（2026-10-03）。
--   竹廣様邸   → リフォーム工事（新築ではない）
--   竹廣邸外壁 → リフォーム工事（メモに「外壁」が入る）
--   藪内様邸   → 新築工事（解体ではない）
--   藪内邸     → 新築工事
do $$
declare
  f      record;
  rest   text;
  n_fix  int := 0;
begin
  for f in
    select * from (values
      ('竹廣様邸',   '竹廣様邸リフォーム工事'),
      ('竹廣邸外壁', '竹廣様邸リフォーム工事'),
      ('藪内様邸',   '藪内様邸新築工事'),
      ('藪内邸',     '藪内様邸新築工事')
    ) as t(excel, proj)
  loop
    -- 案件名が1字でも違うと当たらないので、必ず確かめてから当てる
    if not exists (select 1 from public.projects p where p.name = f.proj) then
      raise notice '案件が見つかりません（飛ばします）： %', f.proj;
      continue;
    end if;
    rest := public.ss_rest(f.excel, f.proj);
    update public.staff_assignments a
       set project_name = f.proj,
           note = case
                    when rest = '' then a.note
                    when coalesce(a.note,'') = '' then rest
                    when a.note = rest then a.note
                    else a.note || '／' || rest
                  end
     where a.project_name = f.excel;
    get diagnostics n_fix = row_count;
    raise notice '% → %  （%件%）', f.excel, f.proj, n_fix,
      case when rest = '' then '' else '・メモ「' || rest || '」' end;
  end loop;
end $$;

-- ── ② 残りを、決まりどおり自動で当てはめる ──
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

-- ③ つながった件数のまとめ
select count(*) filter (where exists (select 1 from public.projects p where p.name = a.project_name)) as "案件につながった",
       count(*) filter (where not exists (select 1 from public.projects p where p.name = a.project_name)) as "そのまま",
       count(*) as "合計"
  from public.staff_assignments a;
