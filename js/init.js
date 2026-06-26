// ── init ──
newEstimate();
addSection('仮設工事');
renderSupplierSelectList();

// PWA: ホーム画面追加・オフライン表示に対応
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>navigator.serviceWorker.register('sw.js'));
}
