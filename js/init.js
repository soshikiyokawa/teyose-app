// ── init ──
// データの取得・ログイン状態の復元は js/auth.js が行う（Supabaseが正のデータソース）

// PWA: ホーム画面追加・オフライン表示に対応
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js');
    // SW更新時に自動リロード（新バージョン反映）
    navigator.serviceWorker.addEventListener('message', e=>{
      if(e.data?.type==='SW_UPDATED') location.reload();
    });
  });
}

// SW・キャッシュを完全消去してリロード
function hardUpdate(){
  if('serviceWorker' in navigator){
    navigator.serviceWorker.getRegistrations().then(regs=>{
      return Promise.all(regs.map(r=>r.unregister()));
    }).then(()=>{
      return caches.keys();
    }).then(keys=>{
      return Promise.all(keys.map(k=>caches.delete(k)));
    }).then(()=>{
      location.reload();
    });
  } else {
    location.reload();
  }
}

// 見積フォームフィールドの変更を検知してestDirtyをセット
window.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('page-estimate').addEventListener('input', e=>{
    // サイドバー検索は除外
    if(e.target.id==='est-sidebar-search') return;
    estDirty=true;
  });
});
