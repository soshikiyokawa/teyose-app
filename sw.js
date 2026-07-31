const CACHE_NAME = 'teyose-v209';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/main.css',
  './css/tokens.css',
  './css/layout.css',
  './css/buttons.css',
  './css/forms.css',
  './css/cards.css',
  './css/estimate.css',
  './css/order.css',
  './css/talk.css',
  './css/overlay.css',
  './css/schedule.css',
  './css/genba.css',
  './js/supabase-client.js',
  './js/utils.js',
  './js/state.js',
  './js/data/db.js',
  './js/nav.js',
  './js/talk.js',
  './js/init.js',
  './js/auth.js',
  './js/estimate/estimate-tabs.js',
  './js/estimate/estimate-items.js',
  './js/estimate/estimate-master.js',
  './js/estimate/estimate-summary.js',
  './js/estimate/estimate-crud.js',
  './js/estimate/parking.js',
  './js/estimate/estimate-pdf.js',
  './js/estimate/estimate-invoice.js',
  './js/order/supplier-master.js',
  './js/order/item-master.js',
  './js/order/order-cart.js',
  './js/order/order-confirm.js',
  './js/order/order-history.js',
  './js/orders-list.js',
  './js/chusho.js',
  './js/receipt.js',
  './js/schedule.js',
  './js/genba/genba-tabs.js',
  './js/genba/genba-files.js',
  './js/genba/genba-photos.js',
  './js/genba/genba-drawings.js',
  './js/genba/genba-nippo.js',
  './js/genba/genba-leave.js',
  './js/genba/leave-balance.js',
  './js/genba/genba-holiday.js',
  './js/genba/license.js',
  './js/genba/work-calendar.js',
  './js/genba/account-perms.js',
  './js/push.js',
  './icon-192.png',
  './icon-512.png',
  './favicon.png',
  './logo.png'
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
      .then(()=>self.clients.matchAll({type:'window'}))
      .then(clients=>clients.forEach(c=>c.postMessage({type:'SW_UPDATED',version:CACHE_NAME})))
  );
});

self.addEventListener('fetch', e=>{
  e.respondWith(
    caches.match(e.request).then(cached=>cached || fetch(e.request))
  );
});

// ── 通知の設定（バナー・サウンド・バッジ）。アプリ側から受け取って保持する ──
let notifyPref = { banner:true, sound:true, badge:true };

self.addEventListener('message', e=>{
  if(e.data?.type==='GET_VERSION') e.ports[0]?.postMessage({version:CACHE_NAME});
  if(e.data?.type==='NOTIFY_PREF' && e.data.pref) notifyPref = {...notifyPref, ...e.data.pref};
  if(e.data?.type==='CLEAR_BADGE'){ try{ self.registration.getNotifications().then(ns=>ns.forEach(n=>n.close())); }catch(_){} }
});

// ── プッシュ通知 ──
self.addEventListener('push', e=>{
  let data = {};
  try{ data = e.data.json(); }catch(_){}
  const title = data.title || '手寄';
  // プッシュを受け取ったら必ず通知を出す決まり（userVisibleOnly）のため、
  // 「内容を表示しない」設定のときは本文だけ伏せる
  e.waitUntil((async ()=>{
    const opts = {
      body: notifyPref.banner ? (data.body || '') : '新しいお知らせがあります',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: data.tab || 'teyose',        // 同じ種類の通知はまとめる
      timestamp: Date.now(),
      data: { tab: data.tab || null }   // タップ時に開くタブ（例：'genba/nippo'）
    };
    if(notifyPref.sound){
      opts.renotify = true;             // まとめても、届くたびに音で知らせる
      opts.vibrate = [180,80,180];
    } else {
      opts.silent = true;               // サウンドOFF（バイブ指定と併用できないため分ける）
    }
    await self.registration.showNotification(title, opts);
    // アプリアイコンのバッジ：未読の通知件数を表示する
    if(notifyPref.badge){
      try{
        const list = await self.registration.getNotifications();
        if(self.navigator?.setAppBadge) await self.navigator.setAppBadge(list.length || 1);
      }catch(_){}
    }
  })());
});

self.addEventListener('notificationclick', e=>{
  e.notification.close();
  const tab = e.notification.data?.tab || null;
  e.waitUntil((async ()=>{
    // 開いた通知の分だけバッジを減らす（アプリ側が開けば正確な未読件数で上書きされる）
    try{
      const list = await self.registration.getNotifications();
      if(self.navigator?.setAppBadge){
        if(list.length) await self.navigator.setAppBadge(list.length);
        else await self.navigator.clearAppBadge?.();
      }
    }catch(_){}
    const list = await self.clients.matchAll({type:'window'});
    const existing = list.find(c=>'focus' in c);
    if(existing){
      // 開いているアプリを前面にして、該当タブへ移動させる
      if(tab) existing.postMessage({type:'OPEN_TAB', tab});
      return existing.focus();
    }
    // 未起動の場合はハッシュ付きで起動し、ログイン復元後にアプリ側が該当タブを開く
    if(self.clients.openWindow) return self.clients.openWindow(tab ? './#'+tab : './');
  })());
});
