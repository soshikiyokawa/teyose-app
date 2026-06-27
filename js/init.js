// ── init ──

// 保存データの復元（発注先・品目マスタ・見積一覧・発注履歴・原価・チャット）
loadAppState();

newEstimate();
addSection('仮設工事');
renderSupplierSelectList();

// 自動保存：2秒ごと／離脱時／タブが非表示になった時
setInterval(saveAppState, 2000);
window.addEventListener('beforeunload', saveAppState);
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState==='hidden') saveAppState();
});

// PWA: ホーム画面追加・オフライン表示に対応
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>navigator.serviceWorker.register('sw.js'));
}
