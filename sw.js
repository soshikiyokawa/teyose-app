const CACHE_NAME = 'teyose-v496';

// ── 手元に置いておくもの ──
//
// だいじなのは「画面が読みに行く名前」と「ここに入れる名前」をそろえること。
// index.html は js や main.css を ?v=467 を付けて読む。
// 付けずに入れておくと、名前がちがうので見つけられず、
// せっかく手元にあっても毎回ネットから取り直しになる。
// 電波が弱いところだと、これが「立ち上がりが遅いときがある」の元になる。
//
// 版は CACHE_NAME から取る。上の1か所を直せば、下は自動でついてくる。
const V = CACHE_NAME.split('-v')[1] || '';

// ?v= を付けずに読むもの
//   ・画面そのもの（index.html）
//   ・絵（アイコン・ロゴ）
//   ・main.css の中から読むCSS（@import には ?v= が付かない）
// ── 外から持ってきた部品（地図・Supabase） ──
//
// 以前はCDN（unpkg / jsdelivr）から読んでいたが、別のあて先は下の fetch で素通しするため、
// 開くたびにネットを待っていた。とくに leaflet.css は <head> にあるので、
// これが返ってくるまで画面に何も出ない（真っ白のまま待つ）元になっていた。
//
// 中身は変わらないので、手寄の版を上げても取り直さなくてよい。
// そのため、ふだんの保管庫とは分けてある（版を上げても消さない）
const LIB_CACHE = 'teyose-lib-1';
const LIB_ASSETS = [
  './vendor/supabase.js',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png'
];

const PLAIN = [
  './',
  './index.html',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './favicon.png',
  './logo.png',
  './css/tokens.css',
  './css/layout.css',
  './css/buttons.css',
  './css/forms.css',
  './css/cards.css',
  './css/estimate.css',
  './css/order.css',
  './css/talk.css',
  './css/overlay.css',
  './css/genba.css',
  './css/tasks.css'
];

// index.html から ?v= 付きで読むもの
const VERSIONED = [
  'css/main.css',
  'css/schedule.css',
  'js/supabase-client.js',
  'js/utils.js',
  'js/state.js',
  'js/data/db.js',
  'js/nav.js',
  'js/talk.js',
  'js/talk-search.js',
  'js/swipe-tabs.js',
  'js/notifications.js',
  'js/tasks.js',
  'js/task-templates.js',
  'js/init.js',
  'js/auth.js',
  'js/account.js',
  'js/cost-budget.js',
  'js/payment-schedule.js',
  'js/estimate/quote-import.js',
  'js/estimate/estimate-tabs.js',
  'js/estimate/estimate-items.js',
  'js/estimate/estimate-master.js',
  'js/estimate/estimate-summary.js',
  'js/estimate/estimate-crud.js',
  'js/estimate/info-view.js',
  'js/estimate/parking.js',
  'js/estimate/estimate-pdf.js',
  'js/estimate/estimate-invoice.js',
  'js/genba/supplier-view.js',
  'js/genba/genba-tabs.js',
  'js/genba/genba-files.js',
  'js/genba/genba-photos.js',
  'js/genba/genba-drawings.js',
  'js/genba/genba-nippo.js',
  'js/genba/genba-dezura.js',
  'js/genba/staff-schedule.js',
  'js/genba/payroll.js',
  'js/genba/overtime-pay.js',
  'js/genba/genba-leave.js',
  'js/genba/leave-balance.js',
  'js/genba/genba-holiday.js',
  'js/genba/license.js',
  'js/genba/vehicle.js',
  'js/genba/work-calendar.js',
  'js/genba/account-perms.js',
  'js/order/ekrea-price.js',
  'js/order/invoice.js',
  'js/order/invoice-viewer.js',
  'js/order/invoice-onedrive.js',
  'js/order/item-price.js',
  'js/order/supplier-master.js',
  'js/order/item-master.js',
  'js/order/order-cart.js',
  'js/order/order-confirm.js',
  'js/order/order-history.js',
  'js/order/order-receive.js',
  'js/order/order-delivery.js',
  'js/order/order-cancel.js',
  'js/order/order-price-edit.js',
  'js/order/invoice-lines.js',
  'js/order/card-match.js',
  'js/order/quote-request.js',
  'js/orders-list.js',
  'js/inspection.js',
  'js/chusho.js',
  'js/receipt-scan.js',
  'js/receipt-ledger.js',
  'js/receipt.js',
  'js/schedule.js',
  'js/push.js'
];

const ASSETS = PLAIN.concat(VERSIONED.map(p => `./${p}?v=${V}`));

self.addEventListener('install', e=>{
  e.waitUntil((async ()=>{
    const cache = await caches.open(CACHE_NAME);
    // まとめて入れると、1つでも取りそこねたときに全部入らない（電波の弱いところで起きる）。
    // 1つずつ入れて、取りそこねたものだけ諦める。残りは次に開いたときに入る
    await Promise.all(ASSETS.map(u => cache.add(u).catch(()=>{})));
    // 外から持ってきた部品は、まだ入っていないものだけ入れる（版を上げても取り直さない）
    const lib = await caches.open(LIB_CACHE);
    await Promise.all(LIB_ASSETS.map(async u => {
      if(await lib.match(u)) return;
      await lib.add(u).catch(()=>{});
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    // 古い版の保管庫だけ消す。外から持ってきた部品（LIB_CACHE）は残す
    caches.keys().then(keys=>Promise.all(
      keys.filter(k=>k!==CACHE_NAME && k!==LIB_CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
      .then(()=>self.clients.matchAll({type:'window'}))
      .then(clients=>clients.forEach(c=>c.postMessage({type:'SW_UPDATED',version:CACHE_NAME})))
  );
});

self.addEventListener('fetch', e=>{
  const req = e.request;

  // GET以外（ファイルの送信など、本文のある通信）には一切手を出さない。
  //
  // これまでは全ての通信を受けて caches.match（非同期）を挟んでから fetch し直していた。
  // 本文つきの通信でこれをやると、待っている間に本文が読めなくなり、
  // 中身が空のまま送られてしまう。請求書の送信が
  // 「請求書の保存に失敗しました：No content provided」で失敗していたのはこれが原因。
  if(req.method !== 'GET') return;

  // アプリ以外への通信（Supabaseなど）もそのまま通す。保存してある物とは関係がないため
  let sameOrigin = false;
  try{ sameOrigin = new URL(req.url).origin === self.location.origin; }catch(_){}
  if(!sameOrigin) return;

  // 手元にあればそれを使う（ネットを待たないので速い）。
  // 無ければ取りに行き、そのとき手元にも入れておく
  //（入れそこねた分が、次に開いたときには手元から出せるようになる）
  e.respondWith((async ()=>{
    const cached = await caches.match(req);
    if(cached) return cached;
    const res = await fetch(req);
    if(res && res.ok && res.type === 'basic'){
      const copy = res.clone();
      // 外から持ってきた部品（vendor/。PDFの表示に使う pdf.js など）は中身が変わらないので、
      // 手寄の版を上げても消さない保管庫に入れる。初めて使ったときにだけ取りに行けば済む
      const lib = new URL(req.url).pathname.includes('/vendor/');
      caches.open(lib ? LIB_CACHE : CACHE_NAME).then(c=>c.put(req, copy)).catch(()=>{});
    }
    return res;
  })());
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

// ── ブラウザが登録を入れ替えたとき ──
// 黙って入れ替わると、サーバーが持っている届け先が古いままになり、通知が届かなくなる。
// 開いている画面に知らせて、入れ直してもらう。開いていなければ、次に開いたときに直る
self.addEventListener('pushsubscriptionchange', e=>{
  e.waitUntil((async ()=>{
    const list = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    list.forEach(c=>c.postMessage({type:'PUSH_RESUBSCRIBE'}));
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
