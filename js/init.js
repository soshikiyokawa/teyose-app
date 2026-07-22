// ── init ──
// データの取得・ログイン状態の復元は js/auth.js が行う（Supabaseが正のデータソース）

// PWA: ホーム画面追加・オフライン表示に対応
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js', {updateViaCache:'none'}).then(reg=>{
      reg.update(); // 起動時に新バージョンをチェック（スマホが古いままになるのを防ぐ）
    }).catch(()=>{});
    // 復帰時（アプリを再度前面に出したとき）にも更新チェック
    document.addEventListener('visibilitychange', ()=>{
      if(document.visibilityState==='visible'){
        navigator.serviceWorker.getRegistration().then(reg=>reg&&reg.update()).catch(()=>{});
      }
    });
    navigator.serviceWorker.addEventListener('message', e=>{
      if(e.data?.type==='SW_UPDATED') location.reload();
      if(e.data?.type==='OPEN_TAB') appOpenTab(e.data.tab); // 通知タップ→該当タブへ
    });
    // アクティブなSWからバージョンを取得して表示
    navigator.serviceWorker.ready.then(reg=>{
      const ch = new MessageChannel();
      ch.port1.onmessage = e=>{
        if(e.data?.version){
          const el = document.getElementById('app-version');
          if(el) el.textContent = e.data.version;
        }
      };
      reg.active?.postMessage({type:'GET_VERSION'}, [ch.port2]);
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
