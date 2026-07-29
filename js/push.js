// ════ プッシュ通知（チャット・発注書の着信をスマホに通知） ════
// iPhoneで通知を受け取るには、ホーム画面に追加してPWAとして開く必要がある。

const VAPID_PUBLIC_KEY = 'BOEdjg87BbOf4HSU8ztT6FUZes4Tseso1nm53AfWeD_RGYc398vZUY0NbBD52pNY2-TrykfwpxesAMaZxFL5Q0g';

function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g,'+').replace(/_/g,'/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c=>c.charCodeAt(0)));
}

async function enablePushNotifications(){
  if(!('serviceWorker' in navigator) || !('PushManager' in window)){
    alert('このブラウザは通知に対応していません。');
    return false;
  }
  const perm = await Notification.requestPermission();
  if(perm!=='granted'){
    alert('通知が許可されませんでした。ブラウザの設定から通知を許可してください。');
    renderNotifySettings();
    return false;
  }
  try{
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if(!sub){
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    await dbSavePushSubscription(sub);
    showToast('この端末で通知を有効にしました');
    renderNotifySettings();
    return true;
  }catch(e){
    showToast('通知の設定に失敗しました：'+e.message);
    renderNotifySettings();
    return false;
  }
}

// ════ 通知の設定（バナー・サウンド・バッジ。端末ごとに保存） ════

const NOTIFY_PREF_KEY = 'teyose-notify-pref';
const NOTIFY_PREF_DEFAULT = { banner:true, sound:true, badge:true };

function notifyPref(){
  try{ return {...NOTIFY_PREF_DEFAULT, ...JSON.parse(localStorage.getItem(NOTIFY_PREF_KEY)||'{}')}; }
  catch(_){ return {...NOTIFY_PREF_DEFAULT}; }
}
function setNotifyPref(key, val){
  const p=notifyPref(); p[key]=!!val;
  try{ localStorage.setItem(NOTIFY_PREF_KEY, JSON.stringify(p)); }catch(_){}
  // Service Workerにも伝える（プッシュ受信時のバナー表示・音の有無に使う）
  navigator.serviceWorker?.controller?.postMessage({type:'NOTIFY_PREF', pref:p});
  if(key==='badge' && !val) clearAppBadge();
  if(key==='badge' && val) updateChatBadge();
  renderNotifySettings();
}
// 起動時とSW更新時に、現在の設定をService Workerへ送る
function pushNotifyPrefToSW(){
  navigator.serviceWorker?.controller?.postMessage({type:'NOTIFY_PREF', pref:notifyPref()});
}

// ── バッジ（アプリアイコンの未読件数） ──
function setAppBadgeCount(n){
  if(!notifyPref().badge) return clearAppBadge();
  try{
    if(n>0) navigator.setAppBadge?.(n);
    else navigator.clearAppBadge?.();
  }catch(_){}
}
function clearAppBadge(){ try{ navigator.clearAppBadge?.(); }catch(_){} }

// ── サウンド（アプリを開いている間の着信音。短いチャイムをその場で合成する） ──
let _audioCtx=null;
function playChatChime(){
  if(!notifyPref().sound) return;
  try{
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if(!Ctx) return;
    _audioCtx = _audioCtx || new Ctx();
    if(_audioCtx.state==='suspended') _audioCtx.resume();
    const t0=_audioCtx.currentTime;
    // 2音（ミ→ラ）の軽いチャイム
    [[659.25,0],[880,0.13]].forEach(([freq,delay])=>{
      const osc=_audioCtx.createOscillator(), gain=_audioCtx.createGain();
      osc.type='sine'; osc.frequency.value=freq;
      gain.gain.setValueAtTime(0.0001, t0+delay);
      gain.gain.exponentialRampToValueAtTime(0.22, t0+delay+0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0+delay+0.32);
      osc.connect(gain); gain.connect(_audioCtx.destination);
      osc.start(t0+delay); osc.stop(t0+delay+0.35);
    });
    if(navigator.vibrate) navigator.vibrate(60);
  }catch(_){}
}

// ── 設定画面 ──
async function openNotifySettings(){
  document.getElementById('notify-settings-modal').classList.add('open');
  await renderNotifySettings();
}
function closeNotifySettings(){
  document.getElementById('notify-settings-modal').classList.remove('open');
}

async function renderNotifySettings(){
  const el=document.getElementById('notify-settings-body');
  if(!el || !document.getElementById('notify-settings-modal').classList.contains('open')) return;

  const supported = ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  let subscribed=false;
  try{
    const reg = await navigator.serviceWorker?.getRegistration();
    subscribed = !!(await reg?.pushManager.getSubscription());
  }catch(_){}
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone===true;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const badgeOk = 'setAppBadge' in navigator;
  const p=notifyPref();

  const row=(label,state,ok,note)=>`
    <div style="display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:0.5px solid var(--border)">
      <span style="flex-shrink:0;width:18px">${ok?'✅':'⚠️'}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600">${label}</div>
        <div style="font-size:11px;color:var(--text-sub);line-height:1.6">${state}${note?`<br><span style="color:var(--text-muted)">${note}</span>`:''}</div>
      </div>
    </div>`;

  const toggle=(key,label,desc,disabled,disabledNote)=>`
    <label style="display:flex;align-items:flex-start;gap:8px;padding:9px 0;border-bottom:0.5px solid var(--border);cursor:${disabled?'default':'pointer'};opacity:${disabled?.55:1}">
      <input type="checkbox" ${p[key]?'checked':''} ${disabled?'disabled':''}
             onchange="setNotifyPref('${key}',this.checked)" style="width:auto;margin:3px 0 0">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600">${label}</div>
        <div style="font-size:11px;color:var(--text-sub);line-height:1.6">${disabled?disabledNote:desc}</div>
      </div>
    </label>`;

  const permLabel = {granted:'許可されています', denied:'ブロックされています', default:'まだ許可していません', unsupported:'この端末は非対応です'}[perm];

  el.innerHTML=
    `<div class="section-lbl" style="margin-top:0">この端末の状態</div>`+
    row('通知の許可', permLabel, perm==='granted',
        perm==='denied' ? 'ブラウザの設定（サイトの設定→通知）から許可し直してください' : '')+
    row('この端末の登録', subscribed?'登録済み（プッシュが届きます）':'未登録', subscribed,
        subscribed?'':'下の「この端末で通知を有効にする」を押してください')+
    (isIOS ? row('ホーム画面への追加', standalone?'追加済み':'未追加', standalone,
        standalone?'':'iPhoneは、ホーム画面に追加したアプリからでないと通知を受け取れません') : '')+
    row('バッジ（アイコンの数字）', badgeOk?'この端末は対応しています':'この端末は非対応です', badgeOk,
        badgeOk?'':'アプリ内のチャットボタンには未読件数が表示されます')+

    `<div class="section-lbl">バナー・サウンド・バッジ</div>`+
    row('バナー', perm==='granted'?'新着があると画面に表示されます':'通知を許可すると表示されます', perm==='granted', '')+
    toggle('banner','バナーにメッセージ内容を表示','オフにすると「新しいお知らせがあります」とだけ表示され、内容は伏せられます', perm!=='granted','通知が許可されていないため使えません')+
    toggle('sound','サウンド','着信音を鳴らします（アプリを開いている間はアプリ内の音、閉じている間は端末の通知音）', false)+
    toggle('badge','バッジ','未読件数をアプリアイコンとチャットボタンに表示します', false)+

    `<div style="display:flex;flex-direction:column;gap:6px;margin-top:14px">
      ${perm!=='granted'||!subscribed ? `<button class="btn primary" style="width:100%;justify-content:center" onclick="enablePushNotifications()">この端末で通知を有効にする</button>`:''}
      <button class="btn" style="width:100%;justify-content:center" onclick="sendTestNotification()">テスト通知を送る</button>
     </div>`+
    `<div style="font-size:11px;color:var(--text-muted);line-height:1.7;margin-top:10px">
       ※ 端末側の「おやすみモード」「集中モード」がオンだと、バナーや音が出ないことがあります。<br>
       ※ この設定はこの端末だけに保存されます（スマホとパソコンで別々に設定できます）。
     </div>`;
}

// テスト通知：バナー・サウンド・バッジが実際に動くか確認する
async function sendTestNotification(){
  const p=notifyPref();
  if(p.sound) playChatChime();
  if(p.badge){ try{ navigator.setAppBadge?.(1); }catch(_){} }

  if(!('Notification' in window) || Notification.permission!=='granted'){
    showToast('通知が許可されていないため、バナーは表示できません');
    return;
  }
  try{
    const reg = await navigator.serviceWorker.ready;
    const opts = {
      body: p.banner ? 'この通知が見えていればバナーは正常です。' : '新しいお知らせがあります',
      icon:'./icon-192.png', badge:'./icon-192.png',
      tag:'teyose-test',
      data:{tab:null, test:true}
    };
    if(p.sound){ opts.renotify=true; opts.vibrate=[180,80,180]; } else { opts.silent=true; }
    await reg.showNotification('手寄：テスト通知', opts);
    showToast('テスト通知を送りました');
  }catch(e){
    showToast('テスト通知に失敗しました：'+e.message);
  }
  // バッジは数秒で元に戻す
  setTimeout(()=>{ if(typeof updateChatBadge==='function') updateChatBadge(); else clearAppBadge(); }, 5000);
}
