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
    return;
  }
  const perm = await Notification.requestPermission();
  if(perm!=='granted'){
    alert('通知が許可されませんでした。ブラウザの設定から通知を許可してください。');
    return;
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
  }catch(e){
    showToast('通知の設定に失敗しました：'+e.message);
  }
}
