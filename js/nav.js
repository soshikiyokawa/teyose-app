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
  ['estimate','cost','order'].forEach(n=>{
    document.getElementById('page-'+n).classList.toggle('active',n===t);
    document.getElementById('nav-'+n).classList.toggle('active',n===t);
  });
  if(t==='cost') renderCost();
  if(t==='order'&&document.getElementById('ordersub-master').classList.contains('active')) renderMaster();
  window.scrollTo(0,0);
}
