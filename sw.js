const CACHE_NAME = 'teyose-v14';
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
  './js/order/supplier-master.js',
  './js/order/item-master.js',
  './js/order/order-cart.js',
  './js/order/order-confirm.js',
  './js/order/order-history.js',
  './icon-192.png',
  './icon-512.png',
  './favicon.png'
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)));
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))
  );
});

self.addEventListener('fetch', e=>{
  e.respondWith(
    caches.match(e.request).then(cached=>cached || fetch(e.request))
  );
});
