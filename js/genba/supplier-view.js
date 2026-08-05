// ════ 発注先が見る案件の情報（見るだけ） ════
//
// 発注先には、参加している案件の「案件情報・現場写真・図面・工程表」だけを見せる。
// 施主の個人情報（氏名・連絡先）と、金額にかかわるものは出さない。
// 現場写真は追加できる。消せるのは自分が上げた写真だけ（データベース側でも制限）。

function isSupplierView(){ return currentUserRole==='supplier'; }

// 発注先には「勤怠日報」ではなく「現場」と出す
function applySupplierNavLabel(){
  const el=document.getElementById('nav-genba-label');
  if(el) el.textContent = isSupplierView() ? '現場' : '勤怠日報';
}

// 現場写真タブの上に出す、案件のあらまし
function renderSupplierProjectInfo(){
  const el=document.getElementById('supplier-project-info');
  if(!el) return;
  if(!isSupplierView()){ el.style.display='none'; return; }
  el.style.display='';
  const p=(projects||[]).find(x=>x.id===genbaProjectId);
  if(!p){
    el.innerHTML='<div class="card" style="padding:12px;font-size:12px;color:var(--text-sub)">工事を選ぶと、その案件の情報が出ます</div>';
    return;
  }
  const row=(label,val)=>val
    ? `<div style="display:flex;gap:8px;padding:3px 0"><span style="width:76px;flex:none;color:var(--text-muted);font-size:11px">${label}</span>
         <span style="flex:1;min-width:0;font-size:12px">${esc(val)}</span></div>`
    : '';
  const period=[p.actualStartDate||p.startDate, p.handoverDate||p.endDate]
    .map(d=>d?String(d).replace(/-/g,'/'):'').filter(Boolean).join('　〜　');
  const map = (p.mapLat&&p.mapLng)
    ? `<a href="https://www.google.com/maps?q=${p.mapLat},${p.mapLng}" target="_blank" rel="noopener"
         style="font-size:11px;color:var(--accent-t)">地図を開く</a>` : '';
  el.innerHTML=`<div class="card" style="padding:12px">
    <div style="font-size:13px;font-weight:800;margin-bottom:6px">${esc(p.name)}</div>
    ${row('工事区分', p.type)}
    ${row('工事場所', p.address)}
    ${row('工期', period)}
    ${row('駐車場', p.parkingAddress)}
    ${row('連絡事項', p.note)}
    ${map?`<div style="padding:4px 0 0 84px">${map}</div>`:''}
    <div style="margin-top:8px;font-size:11px;color:var(--text-muted);line-height:1.7">
      写真は追加できます。ご自分が上げた写真だけ削除できます。<br>
      内容の変更が必要なときは、きよかわの担当者にご連絡ください。
    </div>
  </div>`;
}

// 工程表：発注先には編集の操作を出さない
function applySupplierScheduleView(){
  const bar=document.querySelector('#page-schedule .sch-toolbar');
  if(!bar) return;
  const readOnly=isSupplierView();
  bar.querySelectorAll('button').forEach(b=>{
    const t=(b.textContent||'').replace(/\s+/g,'');
    // 「今日」へ移動と Excel出力だけ残す
    const keep = t.includes('今日') || t.includes('Excel');
    b.style.display = (readOnly && !keep) ? 'none' : '';
  });
  let note=document.getElementById('sch-readonly-note');
  if(readOnly && !note){
    note=document.createElement('span');
    note.id='sch-readonly-note';
    note.style.cssText='font-size:11px;color:var(--text-muted)';
    note.textContent='表示のみ';
    bar.appendChild(note);
  }
  if(note) note.style.display = readOnly ? '' : 'none';
}
