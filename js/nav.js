// ════ MAIN NAV ════
function mainTab(t){
  const onEst=document.getElementById('page-estimate').classList.contains('active');
  if(t!=='estimate' && onEst){
    confirmEstDiscard(()=>_mainTabGo(t));
    return;
  }
  _mainTabGo(t);
}
function _mainTabGo(t){
  ['estimate','cost','order','orderslist','schedule','genba'].forEach(n=>{
    document.getElementById('page-'+n)?.classList.toggle('active',n===t);
    document.getElementById('nav-'+n)?.classList.toggle('active',n===t);
  });
  document.body.classList.remove('sch-preview');
  if(t==='cost') renderCost();
  if(t==='order'&&document.getElementById('ordersub-master').classList.contains('active')) renderMaster();
  if(t==='orderslist') renderOrdersList();
  if(t==='schedule') loadScheduleForProject();
  if(t==='genba') renderGenbaPage();
  window.scrollTo(0,0);
}
