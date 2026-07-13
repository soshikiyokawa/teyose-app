const CACHE_NAME = 'teyose-v137';
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

// ── バージョン取得 ──
self.addEventListener('message', e=>{
  if(e.data?.type==='GET_VERSION') e.ports[0]?.postMessage({version:CACHE_NAME});
});

// ── プッシュ通知 ──
self.addEventListener('push', e=>{
  let data = {};
  try{ data = e.data.json(); }catch(_){}
  const title = data.title || '手寄';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png'
  }));
});

self.addEventListener('notificationclick', e=>{
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({type:'window'}).then(list=>{
      const existing = list.find(c=>'focus' in c);
      if(existing) return existing.focus();
      if(self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
