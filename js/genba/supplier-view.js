// ════ 発注先が見る案件タブ（見るだけ。写真の追加だけできる） ════
//
// 社員と同じ「案件」タブを使う。ただし発注先には
//   ・一覧（カード）と案件情報だけを出し、見積・金額・原価は出さない
//   ・案件情報は書き換えできない（地図は開ける）
//   ・現場写真は追加できる。削除・移動は自分が上げた写真だけ
//   ・工程表は案件情報の下に出る（見るだけ）
// が適用される。参加している案件しか出ない（データベース側で制限）。

function isSupplierView(){ return currentUserRole==='supplier'; }

// 案件情報タブを見るだけの状態にする（社員のときは元に戻す）
function applySupplierProjectView(){
  const readOnly = isSupplierView();
  // 書き換えできないようにする（地図・写真・図面のボタンは残す）
  ['est-project','est-site','est-parking','est-start-date','est-actual-start','est-end-date','est-handover']
    .forEach(id=>{
      const el=document.getElementById(id);
      if(!el) return;
      el.readOnly = readOnly;
      el.style.background = readOnly ? 'var(--surface2)' : '';
    });
  // 保存・新規・見積へ・削除・メンバー編集・区画図の追加は出さない
  [...document.querySelectorAll('#estsub-info button')].forEach(b=>{
    const t=(b.textContent||'').replace(/\s+/g,'');
    const on=(b.getAttribute('onclick')||'');
    const isEdit = t.includes('案件を保存')||t.includes('見積情報へ')||t.includes('新規')||t==='一覧'
        || t.includes('この案件を削除')||on.includes('openMemberPicker')||b.id==='parking-doc-add-btn';
    if(isEdit) b.style.display = readOnly ? 'none' : '';
  });
  // 案件の削除欄は社員側の出し分け（updateProjDeleteBtn）に任せる。発注先のときだけ隠す
  const del=document.getElementById('proj-delete-wrap');
  if(del && readOnly) del.style.display='none';
  const badge=document.getElementById('est-badge');
  if(badge) badge.style.display = readOnly ? 'none' : '';

  // 見るだけであることを書いておく
  const head=document.querySelector('#estsub-info .card-head');
  let note=document.getElementById('sup-info-note');
  if(readOnly && head && !note){
    note=document.createElement('span');
    note.id='sup-info-note';
    note.style.cssText='font-size:11px;color:var(--text-muted);margin-left:auto';
    note.textContent='表示のみ（変更は担当者へご連絡ください）';
    head.appendChild(note);
  }
  if(note) note.style.display = readOnly ? '' : 'none';
  applySupplierScheduleView();
}

// ── 案件情報の中の工程表：ふだんは表示のみ。「編集」を押すと編集できる ──
function toggleScheduleEdit(){
  if(isSupplierView()) return;                  // 発注先は編集できない
  const on = !document.body.classList.contains('sch-edit');
  document.body.classList.toggle('sch-edit', on);
  const btn=document.getElementById('sch-edit-btn');
  if(btn) btn.textContent = on ? '編集をやめる' : '編集';
  if(on) showToast('工程表を編集できます。変更したら「保存」を押してください');
}
// 案件やタブを切り替えたら、表示のみの状態に戻す（保存し忘れた編集を持ち越さない）
function resetScheduleEdit(){
  document.body.classList.remove('sch-edit');
  const btn=document.getElementById('sch-edit-btn');
  if(btn) btn.textContent='編集';
}

// 工程表：発注先には「表示のみ」と出す
// （編集ボタンは employee-only、他のボタンは表示のみの状態ではCSSで隠れている）
function applySupplierScheduleView(){
  const bar=document.querySelector('#page-schedule .sch-toolbar');
  if(!bar) return;
  const readOnly=isSupplierView();
  let note=document.getElementById('sch-readonly-note');
  if(readOnly && !note){
    note=document.createElement('span');
    note.id='sch-readonly-note';
    note.style.cssText='font-size:11px;color:var(--text-muted);margin-left:auto';
    note.textContent='表示のみ';
    bar.appendChild(note);
  }
  if(note) note.style.display = readOnly ? '' : 'none';
}
