-- ════ 人員配置の現場名を案件名に当てはめる【実行】 ════
--
-- 先に migration-genba83.sql（下見）を実行して、中身を確かめてから流すこと。
-- 当てはめ方と関数は genba83 で作ってある。
--
-- 当てはめは2段。
--   ① 人が決めた対応表（下の fix）。呼び名と案件名がそのままでは結びつかないもの
--   ② 残り（中山様・中村様・前田様邸・清藤様邸）を、genba83 の決まりで自動的に当てはめる
--
-- 何度実行しても同じ結果になる（すでに案件名そのものになっている行は触らない）。
-- 当てはまらないもの（「加計倉庫」「板どぶ漬け」「次刻み」）は、そのまま残る。

begin;

-- ── ① 人が決めた対応表 ──
--
-- 清川さんに確認して決めたもの（2026-10-03）。
--   ・浄行寺と付くもの → 浄行寺庫裏新築工事
--   ・藤﨑（藤崎）と付くもの → 藤﨑様邸新築工事
--   ・写真館と付くもの → PAUSE photoスタジオ新築工事（呼び名からは結びつかないため）
--   ・竹廣様邸／竹廣邸外壁 → リフォーム工事（新築ではない）
--   ・藪内様邸／藪内邸 → 新築工事（解体ではない）
-- メモも推測せず、ここに書いたものをそのまま入れる。
do $$
declare
  f     record;
  n     int;
  n_all int := 0;
begin
  for f in
    select * from (values
      -- 呼び名,                       案件名,                          メモ
      ('浄行寺様邸新築',         '浄行寺庫裏新築工事',             ''        ),
      ('浄行寺様邸新築上棟',     '浄行寺庫裏新築工事',             '上棟'    ),
      ('浄行寺様邸新築刻み',     '浄行寺庫裏新築工事',             '刻み'    ),
      ('浄行寺様邸新築土台敷き', '浄行寺庫裏新築工事',             '土台敷き'),
      ('浄行寺様邸土台敷き',     '浄行寺庫裏新築工事',             '土台敷き'),
      ('藤﨑様邸',               '藤﨑様邸新築工事',               ''        ),
      ('藤崎様邸',               '藤﨑様邸新築工事',               ''        ),
      ('藤﨑邸',                 '藤﨑様邸新築工事',               ''        ),
      ('藤﨑邸フェンス',         '藤﨑様邸新築工事',               'フェンス'),
      ('藤﨑邸焼杉',             '藤﨑様邸新築工事',               '焼杉'    ),
      ('写真館新築',             'PAUSE photoスタジオ新築工事',    ''        ),
      ('写真館新築刻み',         'PAUSE photoスタジオ新築工事',    '刻み'    ),
      ('写真館土台敷き',         'PAUSE photoスタジオ新築工事',    '土台敷き'),
      ('竹廣様邸',               '竹廣様邸リフォーム工事',         ''        ),
      ('竹廣邸外壁',             '竹廣様邸リフォーム工事',         '外壁'    ),
      ('藪内様邸',               '藪内様邸新築工事',               ''        ),
      ('藪内邸',                 '藪内様邸新築工事',               ''        )
    ) as t(excel, proj, memo)
  loop
    -- 案件名が1字でも違うと当たらないので、必ず確かめてから当てる
    if not exists (select 1 from public.projects p where p.name = f.proj) then
      raise notice '※ 案件が見つかりません（飛ばします）： % ← %', f.proj, f.excel;
      continue;
    end if;
    update public.staff_assignments a
       set project_name = f.proj,
           note = case
                    when f.memo = '' then a.note
                    when coalesce(a.note,'') = '' then f.memo
                    when a.note = f.memo then a.note
                    else a.note || '／' || f.memo
                  end
     where a.project_name = f.excel;
    get diagnostics n = row_count;
    n_all := n_all + n;
    if n > 0 then
      raise notice '% → %  （%件%）', f.excel, f.proj, n,
        case when f.memo = '' then '' else '・メモ「' || f.memo || '」' end;
    end if;
  end loop;
  raise notice '── 対応表で当てはめた合計： %件 ──', n_all;
end $$;

-- ── ② 残りを、決まりどおり自動で当てはめる ──
--    （中山様・中村様・前田様邸・清藤様邸。名字がひとつに決まるもの）
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

-- ② まだ案件につながっていない現場
--    「加計倉庫」4件／「板どぶ漬け」3件／「次刻み」2件 の計9件だけなら想定どおり
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
