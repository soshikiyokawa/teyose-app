// ════ MAIN NAV ════

// 通知タップからの画面遷移（'genba/nippo' 形式。ログイン前に届いた場合は復元後に開く）
let _pendingOpenTab = null;
// 通知から画面を開く。
//   'genba/nippo'        … そのタブまで
//   'talk:supplier:3'    … そのやりとりまで（: のうしろが行き先の合い印）
//   'task:12'            … そのタスクまで
function appOpenTab(spec){
  if(!spec) return;
  const s = String(spec);
  const c = s.indexOf(':');
  const head   = c<0 ? s : s.slice(0, c);
  const target = c<0 ? '' : s.slice(c+1);
  const [page, sub] = head.split('/');

  // チャット。お客様もここだけは開ける
  if(page === 'talk'){
    if(!currentUserRole){ _pendingOpenTab = spec; return; }
    mainTab('talk');
    if(target && typeof openTalkThreadByKey==='function') openTalkThreadByKey(target);
    return;
  }
  // 案件タブのサブタブ（定期点検など）
  if(page === 'estimate'){
    if(!currentUserRole || currentUserRole === 'supplier'){ _pendingOpenTab = spec; return; }
    mainTab('estimate');
    if(sub && document.getElementById('estsub-'+sub)) estSubTab(sub);
    return;
  }
  // 受発注タブのサブタブ（品目マスタなど）
  if(page === 'order'){
    if(!currentUserRole || currentUserRole === 'supplier'){ _pendingOpenTab = spec; return; }
    mainTab('order');
    if(sub && document.getElementById('ordersub-'+sub)) orderSubTab(sub);
    return;
  }
  if(page === 'task'){
    if(!currentUserRole){ _pendingOpenTab = spec; return; }
    mainTab('task');
    // そのタスクまで開く（消されていたら一覧のまま）
    const id = Number(target);
    if(id && typeof openTaskEdit==='function' && (tasks||[]).some(t=>t.id===id)) openTaskEdit(id);
    return;
  }
  if(page !== 'genba') return;
  if(!currentUserRole || currentUserRole === 'supplier'){ _pendingOpenTab = spec; return; }
  mainTab('genba');
  if(sub && document.getElementById('genbatab-'+sub)) genbaTab(sub);
}
function mainTab(t){
  const onEst=document.getElementById('page-estimate').classList.contains('active');
  if(t!=='estimate' && onEst){
    confirmEstDiscard(()=>_mainTabGo(t));
    return;
  }
  _mainTabGo(t);
}
function _mainTabGo(t){
  ['estimate','cost','order','schedule','genba','task','talk'].forEach(n=>{
    document.getElementById('page-'+n)?.classList.toggle('active',n===t);
    document.getElementById('nav-'+n)?.classList.toggle('active',n===t);
  });
  document.body.classList.remove('sch-preview');
  talkPanelOpen = (t==='talk');
  if(t==='talk') renderTalkPage();
  if(t==='cost') renderCost();
  if(t==='order'&&document.getElementById('ordersub-master').classList.contains('active')) renderMaster();
  if(t==='schedule'){ loadScheduleForProject(); applySupplierScheduleView && applySupplierScheduleView(); }
  if(t==='genba') renderGenbaPage();
  if(t==='task') renderTaskPage();
  window.scrollTo(0,0);
}
