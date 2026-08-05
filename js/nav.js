// ════ MAIN NAV ════

// 通知タップからの画面遷移（'genba/nippo' 形式。ログイン前に届いた場合は復元後に開く）
let _pendingOpenTab = null;
function appOpenTab(spec){
  if(!spec) return;
  const [page, sub] = String(spec).split('/');
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
  ['estimate','cost','order','schedule','genba','talk'].forEach(n=>{
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
  window.scrollTo(0,0);
}
