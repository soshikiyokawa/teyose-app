// ── init ──
// データの取得・ログイン状態の復元は js/auth.js が行う（Supabaseが正のデータソース）

// PWA: ホーム画面追加・オフライン表示に対応
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>navigator.serviceWorker.register('sw.js'));
}
