// ════ MAIN NAV ════
function mainTab(t) {
  ['estimate','cost','order'].forEach(n=>{
    document.getElementById('page-'+n).classList.toggle('active',n===t);
    document.getElementById('nav-'+n).classList.toggle('active',n===t);
  });
  if(t==='cost') renderCost();
  if(t==='order'&&document.getElementById('ordersub-master').classList.contains('active')) renderMaster();
  window.scrollTo(0,0);
}
