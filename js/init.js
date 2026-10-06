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
      // 新しい版が入ったら読み込み直す。
      // ただし同じ版で何度もやらない（読み直し→また通知→読み直し、で待たされるため）
      if(e.data?.type==='SW_UPDATED'){
        const v = String(e.data.version||'1');
        let done = '';
        try{ done = sessionStorage.getItem('teyose-reloaded')||''; }catch(_){}
        if(done !== v){
          try{ sessionStorage.setItem('teyose-reloaded', v); }catch(_){}
          location.reload();
        }
      }
      if(e.data?.type==='OPEN_TAB') appOpenTab(e.data.tab); // 通知タップ→該当タブへ
      // ブラウザが通知の登録を入れ替えた → 届け先を入れ直す
      if(e.data?.type==='PUSH_RESUBSCRIBE' && typeof syncPushSubscription==='function') syncPushSubscription();
    });
    // アクティブなSWからバージョンを取得して表示
    navigator.serviceWorker.ready.then(reg=>{
      const ch = new MessageChannel();
      ch.port1.onmessage = e=>{
        if(e.data?.version){
          const el = document.getElementById('app-version');
          // 上のバーは狭いので「v376」だけ出す（'teyose-' は付けない）。
          // 問い合わせのときに読み上げてもらう番号なので、切れないことを優先する
          if(el) el.textContent = String(e.data.version).replace(/^teyose-/, '');
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
