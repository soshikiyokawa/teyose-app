// ── init ──
// データの取得・ログイン状態の復元は js/auth.js が行う（Supabaseが正のデータソース）

// PWA: ホーム画面追加・オフライン表示に対応
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>navigator.serviceWorker.register('sw.js'));
}

// 見積フォームフィールドの変更を検知してestDirtyをセット
window.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('page-estimate').addEventListener('input', e=>{
    // サイドバー検索は除外
    if(e.target.id==='est-sidebar-search') return;
    estDirty=true;
  });
});
