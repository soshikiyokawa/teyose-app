// ════ 通知履歴（スマホに届いた通知を、あとから読み返す） ════
//
// スマホの通知は消してしまうと内容が分からなくなるので、送った通知を1件ずつ
// notifications テーブルに残しておき、上のバーのベルから読み返せるようにする。
//
//   ・見えるのは自分あての通知だけ（RLSで絞られる）
//   ・書き込むのは通知を送るEdge Functionだけ。アプリからは足せない
//   ・古いものは90日でSupabase側が自動で消す

let myNotifications = [];
let notificationsReady = true;

async function fetchMyNotifications(){
  if(!currentUserId){ myNotifications=[]; return; }
  const { data, error } = await sb.from('notifications').select('*')
    .order('created_at',{ascending:false}).limit(200);
  notificationsReady = !error;
  myNotifications = (data||[]).map(r=>({
    id:r.id, title:r.title||'', body:r.body||'', tab:r.tab||'',
    source:r.source||'', readAt:r.read_at||null, createdAt:r.created_at
  }));
}

function unreadNotificationCount(){
  return myNotifications.filter(n=>!n.readAt).length;
}

// 上のバーのベルに未読件数を出す
function updateNotificationBadge(){
  const b = document.getElementById('notif-badge');
  if(!b) return;
  const n = unreadNotificationCount();
  b.textContent = n>99 ? '99+' : String(n);
  b.style.display = n ? 'flex' : 'none';
}

// 通知が来た日時。今日なら時刻だけ、今年なら月日、それ以外は年から
function notifTimeLabel(iso){
  const d = new Date(iso);
  if(isNaN(d)) return '';
  const now = new Date();
  const hm = String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  const sameDay = d.toDateString()===now.toDateString();
  if(sameDay) return '今日 '+hm;
  const yest = new Date(now); yest.setDate(now.getDate()-1);
  if(d.toDateString()===yest.toDateString()) return '昨日 '+hm;
  const md = (d.getMonth()+1)+'/'+d.getDate();
  return (d.getFullYear()===now.getFullYear() ? md : d.getFullYear()+'/'+md)+' '+hm;
}

// 通知がどの機能から来たかの表示名（分からないものは出さない）
const NOTIF_SOURCE_LABEL = {
  employee:'社内チャット', supplier:'発注先チャット', staff:'事務あて', user:'お知らせ', names:'お知らせ',
  chatwork:'ChatWork', 'nippo-remind':'日報リマインド', 'nippo-check':'日報の確認',
  'ot-remind':'承認待ち', 'license-remind':'免許・保険', 'vehicle-remind':'車両',
  'payment-remind':'入金', 'inspection-remind':'定期点検', 'ekrea-price':'エクレア単価'
};

function openNotifications(){
  document.getElementById('notif-modal').classList.add('open');
  renderNotifications();
  // 開いたら既読にする（画面に出たものは読んだものとして扱う）
  markAllNotificationsRead();
}
function closeNotifications(){
  document.getElementById('notif-modal').classList.remove('open');
}

function renderNotifications(){
  const wrap = document.getElementById('notif-list');
  if(!wrap) return;
  if(!notificationsReady){
    wrap.innerHTML = '<div class="empty">通知履歴の準備ができていません。管理者にお問い合わせください</div>';
    return;
  }
  if(!myNotifications.length){
    wrap.innerHTML = '<div class="empty">通知はまだありません</div>';
    return;
  }
  wrap.innerHTML = myNotifications.map(n=>{
    const src = NOTIF_SOURCE_LABEL[n.source]||'';
    const unread = !n.readAt;
    return `
    <div class="notif-row${unread?' unread':''}"${n.tab?` onclick="openNotificationTab(${n.id})" style="cursor:pointer"`:''}>
      <div class="notif-head">
        <span class="notif-title">${unread?'<span class="notif-dot"></span>':''}${esc(n.title)}</span>
        <span class="notif-time">${notifTimeLabel(n.createdAt)}</span>
      </div>
      <div class="notif-body">${esc(n.body)}</div>
      ${src?`<div class="notif-src">${esc(src)}</div>`:''}
    </div>`;
  }).join('');
}

// 通知をタップ → その画面へ移動して閉じる
function openNotificationTab(id){
  const n = myNotifications.find(x=>x.id===id);
  closeNotifications();
  if(n?.tab && typeof appOpenTab==='function') appOpenTab(n.tab);
}

async function markAllNotificationsRead(){
  const unread = myNotifications.filter(n=>!n.readAt);
  if(!unread.length) return;
  const now = new Date().toISOString();
  unread.forEach(n=>{ n.readAt = now; });
  updateNotificationBadge();
  renderNotifications();
  const { error } = await sb.from('notifications').update({read_at:now})
    .is('read_at',null).eq('user_id',currentUserId);
  if(error){ console.warn('既読の保存に失敗しました', error); }
}

// 自分あての通知をすべて消す
async function clearMyNotifications(){
  if(!myNotifications.length) return;
  if(!confirm('通知履歴をすべて消します。よろしいですか？')) return;
  const { error } = await sb.from('notifications').delete().eq('user_id',currentUserId);
  if(error){ showToast('削除に失敗しました：'+error.message); return; }
  myNotifications = [];
  updateNotificationBadge();
  renderNotifications();
  showToast('通知履歴を消しました');
}

// リアルタイムで届いた新着を反映する（バッジと、開いていれば一覧も）
async function refreshNotifications(){
  try{ await fetchMyNotifications(); }catch(_){ return; }
  updateNotificationBadge();
  if(document.getElementById('notif-modal')?.classList.contains('open')) renderNotifications();
}
