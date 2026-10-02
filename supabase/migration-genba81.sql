-- ════ 人員配置の名前を、アカウントの表示名にそろえる ════
--
-- はじめは呼び名（会長・太視…）で入れていたが、日報の実績と同じ名前にしておきたいので
-- アカウントの表示名に付け替える（js/genba/genba-nippo.js の EMPLOYEE_ORDER と同じ綴り）。
--
-- migration-genba80.sql を当てたあとに実行する。
-- まだ呼び名で1件も入れていなければ、何も変わらない（0件更新で正常）。

update public.staff_assignments set person = case person
    when '会長' then '清川伸二'
    when '太視' then '清川太視'
    when '説志' then '清川説志'
    when '原口' then '原口晴郎'
    when '山口' then '山口大輔'
    when '梅田' then '梅田昭文'
    when '石橋' then '石橋実咲'
    when '梶原' then '梶原大地'
    when '創史' then '清川創史'
    else person
  end
 where person in ('会長','太視','説志','原口','山口','梅田','石橋','梶原','創史');

-- ── 当てたあとの確認 ──
--
-- 「表に出ない人」が0件なら問題なし。
-- 1件以上あれば、その名前がアカウントの表示名と合っていないということ
-- （画面では、決まった9人の下に別の行として出るので、消えてはいない）
select person as "名前", count(*) as "件数",
       case when person in ('清川伸二','清川太視','清川説志','原口晴郎','山口大輔',
                            '梅田昭文','石橋実咲','梶原大地','清川創史')
            then 'OK' else '← 9人の並びに無い' end as "確認"
  from public.staff_assignments
 group by person
 order by 3, 1;
