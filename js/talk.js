// ════ 社内チャットの通知先（ALL＝全員／個別指定） ════
let notifyTargets = [];   // 空＝ALL（全員）。表示名の配列

// 社員（発注先ではない人）の表示名。自分は除く。
// 発注先チャットは管理者も一般社員も見られて書き込めるので、どちらも候補に出す
// きよかわの社員（管理者＋一般社員）の名前。
// お客様（client）は社員ではないので入れない。入れてしまうと、通知の宛先に並び、
// チャット本文の先頭が入った通知がお客様に届いてしまう
function _staffNames(){
  return (typeof allProfiles!=='undefined' ? allProfiles : [])
    .filter(p=>(p.role==='staff'||p.role==='carpenter') && p.displayName && p.displayName!==currentUserDisplayName)
    .map(p=>p.displayName);
}
// その発注先のアカウント（担当者）の表示名。自分は除く
function _supplierNames(supName){
  // 発注先の人が自社のスレッドを見ている場合は、発注先の一覧が無くても自分の所属で引ける
  const sid = supplierIdByName(supName)
    || (currentUserRole==='supplier' ? currentUserSupplierId : null);
  if(!sid) return [];
  return (typeof allProfiles!=='undefined' ? allProfiles : [])
    .filter(p=>p.role==='supplier' && p.supplierId===sid && p.displayName && p.displayName!==currentUserDisplayName)
    .map(p=>p.displayName);
}

// 通知先の候補。まとまりごとに分けて返す
//   社内チャット … 社員全員
//   案件チャット … 参加メンバー
//   発注先チャット … その発注先の担当者と、きよかわの社員
//     きよかわ側からも発注先側からも同じ候補が出る（自分は常に除く）。
//     発注先の人が見られる名簿は chat_directory に絞ってある（migration-genba54.sql）
function notifyGroups(){
  const t = activeTalkPanelSupplier;
  if(isDirectThread(t)) return [];   // 相手は1人なので選ぶ必要がない
  if(isClientThread(t)) return [];   // 宛先は決まっている（お客様／きよかわの担当）
  if(isGroupThread(t)){
    const g = groupById(groupThreadIds[t]);
    return [{label:'', names:(g?.memberNames||[]).filter(n=>n && n!==currentUserDisplayName)}];
  }
  if(t===INTERNAL_THREAD) return [{label:'', names:_staffNames()}];
  if(isProjectThread(t)){
    const p = projects.find(x=>x.id===projectThreadIds[t]);
    return [{label:'', names:otherMemberNames(p?.members)}];
  }
  return [
    {label:'発注先の担当者', names:_supplierNames(t)},
    {label:'きよかわの社員', names:_staffNames()}
  ].filter(g=>g.names.length);
}
// 候補をひとまとめにした配列（残っている宛先の掃除に使う）
function notifyCandidateNames(){
  return notifyGroups().reduce((a,g)=>a.concat(g.names), []);
}

function openNotifyPicker(){
  const groups = notifyGroups();
  const el = document.getElementById('notify-picker');
  const btn = n => `<button class="notify-opt${notifyTargets.includes(n)?' mine':''}" onclick="toggleNotifyTarget('${n.replace(/'/g,"\\'")}')">
      ${notifyTargets.includes(n)?'✓ ':''}${esc(n)}
    </button>`;
  const body = groups.length
    ? groups.map(g=>(g.label?`<div class="notify-group">${esc(g.label)}</div>`:'') + g.names.map(btn).join('')).join('')
    : '<div style="font-size:12px;color:var(--text-muted);padding:8px">通知できる相手が登録されていません</div>';
  el.innerHTML =
    `<button class="notify-opt${notifyTargets.length?'':' mine'}" onclick="pickNotifyAll()">
       <span style="font-weight:800">ALL（${esc(notifyAllLabel())}）</span>
     </button>` + body;
  document.getElementById('notify-modal').classList.add('open');
}

// ALL を選んだときに誰へ行くか。スレッドの種類と自分の立場で変わる
function notifyAllLabel(){
  const t = activeTalkPanelSupplier;
  if(t===INTERNAL_THREAD) return '全員';
  if(isProjectThread(t)) return '参加メンバー';
  if(isGroupThread(t)) return 'メンバー全員';
  return currentUserRole==='supplier' ? 'きよかわの社員' : 'この発注先';
}
function closeNotifyPicker(){ document.getElementById('notify-modal').classList.remove('open'); updateNotifyLabel(); }
function pickNotifyAll(){ notifyTargets = []; closeNotifyPicker(); }
function toggleNotifyTarget(name){
  const i = notifyTargets.indexOf(name);
  if(i>=0) notifyTargets.splice(i,1); else notifyTargets.push(name);
  openNotifyPicker();  // 選択状態を反映して開き直す
}

// 入力欄の上に現在の通知先を表示
function updateNotifyLabel(){
  const bar = document.getElementById('talk-notify-bar');
  if(!bar) return;
  // 発注先チャットでも宛先を選べる。相手がいないスレッドだけ隠す
  const showBar = !!activeTalkPanelSupplier && notifyCandidateNames().length>0;
  bar.style.display = showBar ? 'flex' : 'none';
  if(!showBar) return;
  const label = notifyTargets.length ? notifyTargets.join('、') : 'ALL（'+notifyAllLabel()+'）';
  document.getElementById('talk-notify-label').textContent = label;
}

// ════ チャットのリアクション（スタンプ） ════
const REACTION_PALETTE = ['👍','👏','🙏','ありがとうございます','お大事に','お疲れ様です','お願いします','おめでとうございます','ご安全に','承知しました','済','了解です'];
let reactingMsgId = null;

// メッセージ下のリアクション表示（他人の投稿には追加ボタンも出す）
// 発注書の吹き出しに出す「受領しました」。押せるのは発注先だけ。
// 社内から見たときは、受領済みかどうかの表示だけ出す
function orderReceiveHtml(o){
  const ord=(orders||[]).find(x=>x.no===o.no);
  const received = ord ? ord.status==='received' : false;
  const canEdit = currentUserRole==='supplier' || currentUserRole==='staff' || currentUserRole==='carpenter';
  if(received){
    // 受領済み：受領した日と、納品予定日（品目で違えば「10/14〜10/16」）。押すと品目ごとの日付が見られる
    const days = (typeof orderDeliveryDaysLabel==='function') ? orderDeliveryDaysLabel(ord) : '';
    const late = (typeof orderDeliveryLate==='function') && orderDeliveryLate(ord);
    const no = esc(o.no);
    return `<div class="ord-recv done">
      <div>✓ 受領済み${ord?.receivedAt?`（${String(ord.receivedAt).slice(0,10).replace(/-/g,'/')}）`:''}</div>
      ${days
        ? `<button type="button" class="ord-recv-days${late?' late':''}" onclick="openOrderReceive('${no}','change')">
             納品予定 ${days}${late?'（希望日より後）':''}<span>${canEdit?'変える':'見る'}</span></button>`
        : (canEdit && !ord?.paymentMethod
            ? `<button type="button" class="ord-recv-days need" onclick="openOrderReceive('${no}','change')">
                 納品予定日が入っていません<span>入れる</span></button>` : '')}
    </div>`;
  }
  if(currentUserRole!=='supplier') return '';
  return `<div style="padding:4px 10px 10px">
    <button class="btn sm primary" style="width:100%;justify-content:center" onclick="receiveOrderFromChat('${esc(o.no)}')">
      受領する（納品予定日を入れる）
    </button>
  </div>`;
}

// 発注先が発注書を受領する。品目ごとの納品予定日を入れてもらう画面を開く
// （日付がすべて入るまで受領できない。js/order/order-receive.js）
function receiveOrderFromChat(orderNo){
  openOrderReceive(orderNo, 'receive');
}

// 発注書の吹き出しに出す「単価を直す」。発注先ときよかわの管理者だけ
function orderPriceEditBtnHtml(orderNo){
  if(typeof openOrderPriceEdit!=='function') return '';
  if(currentUserRole!=='supplier' && currentUserRole!=='staff') return '';
  if(typeof orderByNo==='function' && !orderByNo(orderNo)) return '';   // 発注が見つからないときは出さない
  return `<button class="btn sm" onclick="openOrderPriceEdit('${esc(orderNo)}')" style="flex:1;justify-content:center">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="12" height="12" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
    単価・送料
  </button>`;
}

function reactionsHtml(m, isMe){
  const reactions = m.reactions||{};
  const keys = Object.keys(reactions).filter(k=>(reactions[k]||[]).length);
  const chips = keys.map(k=>{
    const arr = reactions[k]||[];
    const mine = arr.includes(currentUserDisplayName);
    return `<button class="reaction-chip${mine?' mine':''}" title="${esc(arr.join('、'))}" onclick="dbToggleReaction(${m.id},'${k.replace(/'/g,"\\'")}')">${esc(k)} ${arr.length}</button>`;
  }).join('');
  // 他人の投稿にのみ「＋リアクション」ボタン
  const addBtn = !isMe ? `<button class="reaction-add" title="リアクション" onclick="openReactionPicker(${m.id})">
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.4 2 4 2 4-2 4-2"/><line x1="9" y1="9.5" x2="9.01" y2="9.5"/><line x1="15" y1="9.5" x2="15.01" y2="9.5"/></svg>
  </button>` : '';
  if(!chips && !addBtn) return '';
  return `<div class="reactions${isMe?' me':''}">${chips}${addBtn}</div>`;
}

function openReactionPicker(msgId){
  reactingMsgId = msgId;
  let msg=null;
  for(const k in talkThreads){ const f=(talkThreads[k]||[]).find(m=>m.id===msgId); if(f){msg=f;break;} }
  const mine = new Set();
  if(msg) Object.keys(msg.reactions||{}).forEach(r=>{ if((msg.reactions[r]||[]).includes(currentUserDisplayName)) mine.add(r); });
  document.getElementById('reaction-picker').innerHTML = REACTION_PALETTE.map(v=>
    `<button class="reaction-opt${mine.has(v)?' mine':''}" onclick="pickReaction('${v.replace(/'/g,"\\'")}')">${esc(v)}</button>`).join('');
  document.getElementById('reaction-modal').classList.add('open');
}
function closeReactionPicker(){ document.getElementById('reaction-modal').classList.remove('open'); reactingMsgId=null; }
async function pickReaction(v){
  const id=reactingMsgId; closeReactionPicker();
  if(id!=null) await dbToggleReaction(id, v);
}

// ════ メッセージ長押しメニュー（引用・編集・ブックマーク・既読・コピー・削除） ════
let _msgMenuReady = false;
function setupMsgMenuHandlers(){
  if(_msgMenuReady) return;
  const c = document.getElementById('talk-panel-messages');
  if(!c) return;
  _msgMenuReady = true;
  let timer=null, startX=0, startY=0;
  const start=(e)=>{
    const b=e.target.closest('.talk-bubble'); if(!b) return;
    const mid=Number(b.dataset.mid);
    const p=e.touches?e.touches[0]:e; startX=p.clientX; startY=p.clientY;
    timer=setTimeout(()=>{ timer=null; if(navigator.vibrate)navigator.vibrate(12); openMsgMenu(mid); }, 480);
  };
  const cancel=()=>{ if(timer){clearTimeout(timer);timer=null;} };
  const move=(e)=>{ if(!timer)return; const p=e.touches?e.touches[0]:e; if(Math.abs(p.clientX-startX)>10||Math.abs(p.clientY-startY)>10) cancel(); };
  c.addEventListener('touchstart',start,{passive:true});
  c.addEventListener('touchmove',move,{passive:true});
  c.addEventListener('touchend',cancel);
  c.addEventListener('touchcancel',cancel);
  c.addEventListener('mousedown',start);
  c.addEventListener('mousemove',move);
  c.addEventListener('mouseup',cancel);
  c.addEventListener('mouseleave',cancel);
  // PC右クリック / 一部端末の長押し
  c.addEventListener('contextmenu',e=>{ const b=e.target.closest('.talk-bubble'); if(b){ e.preventDefault(); openMsgMenu(Number(b.dataset.mid)); } });
}

function findMsg(mid){ return (talkThreads[activeTalkPanelSupplier]||[]).find(m=>m.id===mid)||null; }

function openMsgMenu(mid){
  const m=findMsg(mid); if(!m) return;
  menuMsgId=mid;
  const internalThread = isNamedSenderThread(activeTalkPanelSupplier);
  const isMe = internalThread ? m.senderName===currentUserDisplayName : m.role==='me';
  const isMine = m.senderName===currentUserDisplayName; // 自分が送信した本人か
  const canEdit = isMine && m.type==='text';
  const canDelete = isMine || currentUserRole==='staff';
  const hasText = m.type==='text' || (m.type==='file' && m.fileName);
  const bookmarked = Array.isArray(m.bookmarks)&&m.bookmarks.includes(currentUserDisplayName);
  const item=(icon,label,fn,danger)=>`<button class="msg-menu-item${danger?' danger':''}" onclick="${fn}"><span class="mmi-icon">${icon}</span>${label}</button>`;
  let html='';
  html+=item('↩','引用して返信','menuQuote()');
  if(canEdit) html+=item('✏️','編集','menuEdit()');
  html+=item('🔖', bookmarked?'ブックマーク解除':'ブックマーク','menuBookmark()');
  if(!isClientUser()) html+=item('✓✓','既読メンバー','menuReadMembers()');
  if(hasText) html+=item('📋','テキストをコピー','menuCopy()');
  if(canDelete) html+=item('🗑','削除','menuDelete()',true);
  document.getElementById('msg-menu-items').innerHTML=html;
  document.getElementById('msg-menu').classList.add('open');
}
function closeMsgMenu(){ document.getElementById('msg-menu').classList.remove('open'); }

// ① 引用
function menuQuote(){
  const m=findMsg(menuMsgId); closeMsgMenu(); if(!m) return;
  quotingMsg=m; editingMsgId=null; hideEditBar();
  const snip=(m.text||(m.type==='file'?'📎 '+(m.fileName||'ファイル'):m.type==='order'?'📋 発注書':'')).slice(0,60);
  document.getElementById('talk-quote-text').textContent=(m.senderName||'')+'：'+snip;
  document.getElementById('talk-quote-bar').style.display='flex';
  document.getElementById('talk-panel-input').focus();
}
function cancelQuote(){ quotingMsg=null; const b=document.getElementById('talk-quote-bar'); if(b) b.style.display='none'; }

// ② 編集
function menuEdit(){
  const m=findMsg(menuMsgId); closeMsgMenu(); if(!m||m.type!=='text') return;
  editingMsgId=m.id; quotingMsg=null; cancelQuote();
  const input=document.getElementById('talk-panel-input');
  input.value=m.text; input.focus();
  document.getElementById('talk-edit-bar').style.display='flex';
}
function cancelEditMsg(){ editingMsgId=null; const b=document.getElementById('talk-edit-bar'); if(b) b.style.display='none'; const i=document.getElementById('talk-panel-input'); if(i) i.value=''; }
function hideEditBar(){ const b=document.getElementById('talk-edit-bar'); if(b) b.style.display='none'; }

// ③ ブックマーク
async function menuBookmark(){
  const id=menuMsgId; closeMsgMenu();
  await dbToggleBookmark(id);
  renderTalkPanelMessages();
}

// ④ 既読メンバー
function menuReadMembers(){
  const m=findMsg(menuMsgId); closeMsgMenu(); if(!m) return;
  const thread=threadKeyOf(activeTalkPanelSupplier);
  // このスレッドを、メッセージ時刻以降に開いた人（送信者本人は除く）
  const readers=chatReads.filter(r=>r.thread===thread && r.lastReadAt>=m.ts && r.userName!==m.senderName)
    .map(r=>r.userName).filter(Boolean);
  const uniq=[...new Set(readers)];
  document.getElementById('read-members-list').innerHTML = uniq.length
    ? uniq.map(n=>`<div class="read-member">✓ ${esc(n)}</div>`).join('')
    : '<div class="empty" style="padding:14px">まだ既読の人はいません</div>';
  document.getElementById('read-members-modal').classList.add('open');
}
function closeReadMembers(){ document.getElementById('read-members-modal').classList.remove('open'); }

// ⑤ テキストコピー
async function menuCopy(){
  const m=findMsg(menuMsgId); closeMsgMenu(); if(!m) return;
  const t=m.text||m.fileName||'';
  try{ await navigator.clipboard.writeText(t); showToast('コピーしました'); }
  catch(e){
    // フォールバック
    const ta=document.createElement('textarea'); ta.value=t; document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); showToast('コピーしました'); }catch(_){ showToast('コピーできませんでした'); }
    ta.remove();
  }
}

// ⑥ 削除
async function menuDelete(){
  const id=menuMsgId; closeMsgMenu();
  if(!confirm('このメッセージを削除しますか？')) return;
  try{ await dbDeleteChatMessage(activeTalkPanelSupplier,id); }catch(e){ return; }
  renderTalkPanelMessages();
}

// ════ PDFビューワー ════
function openPdfViewer(url, title) {
  const overlay = document.getElementById('pdf-viewer-overlay');
  document.getElementById('pdf-viewer-frame').src = url;
  document.getElementById('pdf-viewer-dl').href = url;
  document.getElementById('pdf-viewer-title').textContent = title || '発注書PDF';
  overlay.style.display = 'flex';
}
function closePdfViewer() {
  document.getElementById('pdf-viewer-overlay').style.display = 'none';
  document.getElementById('pdf-viewer-frame').src = '';
}

// ════ チャットページ制御 ════
// 他のタブと同じく、画面をチャットに切り替えて表示する

function toggleTalkPanel(){ mainTab('talk'); }   // 旧・パネル呼び出しの互換

// チャットタブに切り替わったときに呼ばれる（nav.js の _mainTabGo から）
function renderTalkPage(){
  talkPanelOpen = true;
  // 前に開いていたスレッドがあればそのまま開き直す（無ければ一覧）
  if(activeTalkPanelSupplier) openTalkPanelThread(activeTalkPanelSupplier);
  else closeTalkPanelThread();
  fitTalkPage();
}

// ── チャット領域の高さ ──
//
// 入力欄がいつも画面のいちばん下に来るように、チャット領域の高さを実際に測って決める。
// スマホは「見えている高さ」がころころ変わる（URLバーの出入り・文字を打つときのキーボード）ので、
// window.innerHeight ではなく visualViewport（＝いま実際に見えている範囲）を基準にする。

// 文字を打つキーボードが出ているか
function talkKeyboardOpen(){
  const vv = window.visualViewport;
  return !!vv && (window.innerHeight - vv.height > 120);
}

function fitTalkPage(){
  const wrap = document.getElementById('talk-page-wrap');
  if(!wrap || !document.getElementById('page-talk')?.classList.contains('active')) return;
  const msgs = document.getElementById('talk-panel-messages');
  const stick = msgs ? chatAtBottom(msgs) : false;   // いちばん下を見ていたか

  const vv = window.visualViewport;
  const viewH  = vv ? vv.height    : window.innerHeight;  // いま見えている高さ
  const viewTop = vv ? vv.offsetTop : 0;                  // 見えている範囲の上端
  if(!talkKeyboardOpen()) window.scrollTo(0,0);           // ページ先頭を基準に測る

  // 下のメニューは画面下に貼り付いている。キーボードで隠れているときは差し引かない。
  // メニューの分の余白は app-shell の padding-bottom で既に取ってあるので、
  // 大きいほうだけを空ける（両方引くと、その分だけ入力欄が浮いてしまう）
  const nav = document.getElementById('app-nav');
  const navShown = nav && getComputedStyle(nav).display !== 'none'
    && nav.getBoundingClientRect().bottom <= viewTop + viewH + 1;
  const shell = document.getElementById('app-shell');
  const shellPad = shell ? parseFloat(getComputedStyle(shell).paddingBottom) || 0 : 0;
  const reserve = navShown ? Math.max(nav.offsetHeight, shellPad) : 0;

  const top = wrap.getBoundingClientRect().top - viewTop;  // 見えている範囲の上端からの位置
  const margin = parseFloat(getComputedStyle(wrap).marginBottom) || 0;
  wrap.style.height = Math.max(200, viewH - top - reserve - margin) + 'px';

  // 高さが変わると見えている位置がずれるので、下を見ていたなら下に戻す
  if(stick && msgs) msgs.scrollTop = msgs.scrollHeight;
}
window.addEventListener('resize', fitTalkPage);
window.addEventListener('orientationchange', ()=>setTimeout(fitTalkPage, 300));
// URLバーの出入り・キーボードの開閉に合わせて測り直す
if(window.visualViewport){
  visualViewport.addEventListener('resize', fitTalkPage);
  visualViewport.addEventListener('scroll', fitTalkPage);
}

// ── スレッド一覧のタブ（社内・案件・業者） ──
//
// 案件が増えると発注先が下に押し出されて探しにくいので、種類で分けて出す。
let talkListTab = 'project';
function talkThreadKind(name){
  if(isClientThread(name)) return 'client';
  if(name===INTERNAL_THREAD || isDirectThread(name) || isGroupThread(name)) return 'internal';
  return isProjectThread(name) ? 'project' : 'supplier';
}
function setTalkListTab(tab){
  talkListTab = tab;
  renderTalkPanelList();
}
function renderTalkListTabs(names){
  const el=document.getElementById('talk-list-tabs');
  if(!el) return;
  const defs=[
    {key:'internal', label:'社内・個別'},
    {key:'project',  label:'案件'},
    {key:'supplier', label:'業者'},
    {key:'client',   label:'お客様'},
  ].filter(d=>names.some(n=>talkThreadKind(n)===d.key));
  // 選んでいたタブが無くなったら、残っているいちばん左に寄せる
  if(defs.length && !defs.some(d=>d.key===talkListTab)) talkListTab=defs[0].key;
  el.style.display = defs.length>1 ? '' : 'none';
  el.innerHTML=defs.map(d=>{
    const mine=names.filter(n=>talkThreadKind(n)===d.key);
    const unread=mine.reduce((s,n)=>s+chatUnreadFor(n),0);
    return `<button class="talk-tab${d.key===talkListTab?' active':''}" onclick="setTalkListTab('${d.key}')">
      ${d.label}<span class="talk-tab-n">${mine.length}</span>${unread?`<span class="talk-tab-unread">${unread}</span>`:''}
    </button>`;
  }).join('');
}

// ── 個別チャットを始める ──
//
// 管理者・社員・発注先の誰でも、相手を1人選んで直接やりとりできる。
// 見られるのはその2人だけ（migration-genba62.sql）。
// 相手の候補は chat_directory と同じ考え方で、その人が名前を知ってよい相手だけ出す。
function directCandidates(){
  return (allProfiles||[])
    // お客様（client）はお客様チャットだけの役割なので、個別チャットの相手には出さない
    .filter(p=>p.id && p.id!==currentUserId && p.displayName && p.role!=='client')
    .map(p=>({
      id:p.id, name:p.displayName,
      kind: p.role==='supplier'
        ? ((suppliers||[]).find(s=>s.id===p.supplierId)?.name || '発注先')
        : (p.role==='staff' ? 'きよかわ（管理者）' : 'きよかわ（社員）'),
    }))
    .sort((a,b)=> a.kind.localeCompare(b.kind,'ja') || a.name.localeCompare(b.name,'ja'));
}

function openDirectPicker(){
  const cands=directCandidates();
  const el=document.getElementById('direct-picker');
  if(!cands.length){
    el.innerHTML='<div style="font-size:12px;color:var(--text-muted);padding:12px">相手の候補がいません</div>';
  } else {
    let html='', lastKind='';
    for(const c of cands){
      if(c.kind!==lastKind){ html+=`<div class="section-lbl" style="margin:10px 0 4px">${esc(c.kind)}</div>`; lastKind=c.kind; }
      const has=!!talkThreads[DIRECT_THREAD_PREFIX+c.name];
      html+=`<button type="button" class="member-row" onclick="startDirectChat('${String(c.id).replace(/'/g,"\\'")}')">
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</span>
        ${has?'<span style="font-size:11px;color:var(--text-muted)">やりとり中</span>':''}
      </button>`;
    }
    el.innerHTML=html;
  }
  document.getElementById('direct-modal').classList.add('open');
}
function closeDirectPicker(){ document.getElementById('direct-modal').classList.remove('open'); }

function startDirectChat(userId){
  const name=directThreadName(userId);
  if(!talkThreads[name]) talkThreads[name]=[];   // まだやりとりが無くても一覧に出す
  closeDirectPicker();
  openTalkPanelThread(name);
}

// ── グループチャットを作る・変える ──
//
// 誰でも作れて、個別チャットと同じ候補からメンバーを選ぶ。
// 見られるのはメンバーだけ（migration-genba68.sql）。
let groupEditId = null;            // null＝新しく作る
let groupEditPicked = new Set();   // 選んだメンバー（自分は含めない。保存のときに必ず足す）

function openGroupEditor(id){
  const g = id ? groupById(id) : null;
  if(id && !g){ showToast('グループが見つかりません'); return; }
  groupEditId = g ? g.id : null;
  groupEditPicked = new Set((g?.memberIds||[]).filter(x=>x!==currentUserId));
  document.getElementById('group-modal-title').textContent = g ? 'グループの変更' : 'グループを作る';
  document.getElementById('group-name').value = g ? g.name : '';
  document.getElementById('group-save-btn').textContent = g ? '保存' : '作成';
  document.getElementById('group-leave-btn').hidden = !g;
  // 消せるのは作った人だけ
  document.getElementById('group-delete-btn').hidden = !(g && g.createdBy===currentUserId);
  renderGroupMemberPicker();
  document.getElementById('group-modal').classList.add('open');
  if(!g) setTimeout(()=>document.getElementById('group-name').focus(), 60);
}
function closeGroupEditor(){ document.getElementById('group-modal').classList.remove('open'); }

function renderGroupMemberPicker(){
  const cands = directCandidates();
  // 候補に出ない人（発注先の人から見た他社の人など）がメンバーにいても、外してしまわないよう残す
  const g = groupEditId ? groupById(groupEditId) : null;
  const extra = (g?.memberIds||[])
    .map((id,i)=>({id, name:(g.memberNames||[])[i]||'（名前不明）', kind:'そのほかのメンバー'}))
    .filter(x=>x.id!==currentUserId && !cands.some(c=>c.id===x.id));
  const list = [...cands, ...extra];
  const el = document.getElementById('group-picker');
  document.getElementById('group-count').textContent = `自分を含めて ${groupEditPicked.size+1}人`;
  if(!list.length){ el.innerHTML='<div style="font-size:12px;color:var(--text-muted);padding:12px">メンバーの候補がいません</div>'; return; }
  let html='', lastKind='';
  for(const c of list){
    if(c.kind!==lastKind){ html+=`<div class="section-lbl" style="margin:10px 0 4px">${esc(c.kind)}</div>`; lastKind=c.kind; }
    const on = groupEditPicked.has(c.id);
    html+=`<button type="button" class="member-row${on?' on':''}" aria-pressed="${on}" onclick="toggleGroupMember('${String(c.id).replace(/'/g,"\\'")}')">
      <span class="member-check">${on?'✓':''}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</span>
    </button>`;
  }
  el.innerHTML = html;
}
function toggleGroupMember(id){
  if(groupEditPicked.has(id)) groupEditPicked.delete(id); else groupEditPicked.add(id);
  const box = document.getElementById('group-picker');
  const top = box.scrollTop;
  renderGroupMemberPicker();
  box.scrollTop = top;   // 選ぶたびに一覧の先頭へ戻らないように
}

async function saveGroupEditor(){
  const name = document.getElementById('group-name').value.trim();
  if(!name){ alert('グループ名を入れてください'); return; }
  if(name.length>40){ alert('グループ名は40文字までにしてください'); return; }
  if(!groupEditPicked.size){ alert('自分のほかに、メンバーを1人以上選んでください'); return; }
  const btn = document.getElementById('group-save-btn');
  btn.disabled = true;
  let id = groupEditId;
  try{
    if(id) await dbUpdateChatGroup(id, name, [...groupEditPicked]);
    else id = (await dbCreateChatGroup(name, [...groupEditPicked])).id;
  }catch(_){ btn.disabled = false; return; }
  btn.disabled = false;
  closeGroupEditor();
  // 名前が変わるとスレッド名も変わるので、チャットを取り直してから開く
  try{ await fetchChatData(); }catch(_){}
  openTalkPanelThread(groupThreadName(id));
  showToast(groupEditId ? 'グループを保存しました' : 'グループを作りました');
}

async function leaveGroupFromEditor(){
  const g = groupById(groupEditId); if(!g) return;
  if(!confirm(`「${g.name}」から退出しますか？\n退出すると、このグループのやりとりは見られなくなります。`)) return;
  try{ await dbLeaveChatGroup(g.id); }catch(_){ return; }
  closeGroupEditor();
  try{ await fetchChatData(); }catch(_){}
  closeTalkPanelThread();
  showToast('グループから退出しました');
}

async function deleteGroupFromEditor(){
  const g = groupById(groupEditId); if(!g) return;
  if(!confirm(`「${g.name}」を削除しますか？\nメンバー全員の画面から消え、やりとりもすべて消えます。元に戻せません。`)) return;
  try{ await dbDeleteChatGroup(g.id); }catch(_){ return; }
  closeGroupEditor();
  try{ await fetchChatData(); }catch(_){}
  closeTalkPanelThread();
  showToast('グループを削除しました');
}

function renderTalkPanelList(){
  document.getElementById('talk-panel-list').style.display='flex';
  document.getElementById('talk-panel-detail').style.display='none';
  // 案件チャット：管理者は全案件、それ以外（一般社員・業者）は参加している案件のみ
  const names=visibleThreadNames();
  const el=document.getElementById('talk-panel-thread-list');
  if(!names.length){
    document.getElementById('talk-list-tabs').style.display='none';
    el.innerHTML='<div class="empty">'+(isClientUser()?'まだチャットがありません。きよかわからのご案内をお待ちください':'発注先が登録されていません')+'</div>';
    return;
  }
  updateChatBadge();
  renderTalkListTabs(names);
  // 最新の書き込みがあるスレッドを上に。書き込みが無いスレッドは下に元の順で並べる
  const lastTs=n=>{ const l=(talkThreads[n]||[]); return l.length ? l[l.length-1].ts : 0; };
  const allSups=names.map((n,i)=>({n,i,ts:lastTs(n)}))
    .filter(x=>talkThreadKind(x.n)===talkListTab)
    .sort((a,b)=> b.ts-a.ts || a.i-b.i)
    .map(x=>x.n);
  // 「社内・個別」タブでは、個別チャットを始められるようにする
  const startBtn = talkListTab==='internal'
    ? `<div style="padding:8px 12px 4px">
        <div style="display:flex;gap:8px">
          <button class="btn sm" style="flex:1;justify-content:center" onclick="openDirectPicker()">＋ 個別チャット</button>
          <button class="btn sm" style="flex:1;justify-content:center" onclick="openGroupEditor()">＋ グループを作る</button>
        </div>
      </div>` : '';
  if(!allSups.length){
    el.innerHTML=startBtn+`<div class="empty" style="padding:24px">${
      talkListTab==='project'?'参加している案件がありません'
      :talkListTab==='client'?(isClientUser()?'まだやりとりがありません':'お客様チャットの担当に選ばれている案件がありません')
      :talkListTab==='internal'?'まだやりとりがありません'
      :'発注先が登録されていません'}</div>`;
    return;
  }
  el.innerHTML=startBtn+allSups.map(name=>{
    const isInternal=name===INTERNAL_THREAD;
    const isProject=isProjectThread(name);
    const isDirect=isDirectThread(name);
    const isGroup=isGroupThread(name);
    const grp=isGroup ? groupById(groupThreadIds[name]) : null;
    const isClient=isClientThread(name);
    const msgs=talkThreads[name]||[];
    const last=msgs[msgs.length-1];
    const preview=last?(last.type==='order'?'📋 発注書 '+last.orderData.no:last.type==='quote'?'📝 見積依頼 '+(last.orderData?.no||''):last.type==='file'?'📎 '+last.fileName:last.text)
      :(isInternal?'社員メンバーの連絡用':isProject?'この案件のメンバーで連絡':isDirect?'この2人だけのやりとり':isGroup?`メンバー ${(grp?.memberIds||[]).length}人`:isClient?(isClientUser()?'きよかわとのやりとり':'お客様とのやりとり'):'タップしてトークを開始');
    const sup=suppliers.find(s=>s.name===name);
    const unread=chatUnreadFor(name);
    return `<div class="sup-thread-row" onclick="openTalkPanelThread('${name.replace(/'/g,"\\'")}')">
      <div class="sup-thread-icon">${isInternal?'🏡':isProject?'🏗':isDirect?'👤':isGroup?'👥':isClient?'🏠':'🏪'}</div>
      <div class="sup-thread-info">
        <div class="sup-thread-name">${esc(threadLabel(name))}</div>
        <div class="sup-thread-preview">${preview}</div>
        ${sup?.tel?`<div style="font-size:11px;color:var(--text-muted)">📞 ${sup.tel}</div>`:''}
      </div>
      <div class="sup-thread-meta">
        ${last?`<div>${tsLabel(last.ts)}</div>`:''}
        ${unread?`<div class="sup-thread-unread">${unread}</div>`:''}
        ${!unread&&msgs.length?`<div style="color:var(--accent-t);font-size:11px">${msgs.length}件</div>`:''}
      </div>
    </div>`;
  }).join('');
}

function openTalkPanelThread(supName, opt){
  activeTalkPanelSupplier=supName;
  talkListTab=talkThreadKind(supName);   // 戻ったときに同じ種類の一覧が出るように
  resetChatRenderSignature();   // スレッドを開いたら必ず描き直す
  if(!talkThreads[supName]) talkThreads[supName]=[];
  const sup=suppliers.find(s=>s.name===supName);
  // 発注先の名前をタップすると、登録してある電話番号にかけられる。
  // 全角で登録されていることがあるので、半角に直してから数字だけ取り出す
  const tel=String(sup?.tel||'')
    .replace(/[０-９＋]/g, c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0))
    .replace(/[^\d+]/g,'');
  const titleEl=document.getElementById('talk-panel-title');
  if(tel){
    titleEl.innerHTML=`<a href="tel:${tel}" class="talk-tel" title="${esc(sup.tel)}に電話をかける">${esc(supName)}<span>📞</span></a>`;
  } else {
    titleEl.textContent=threadLabel(supName);
  }
  const metaEl=document.getElementById('talk-panel-meta');
  if(isClientThread(supName)){
    const pid=clientThreadIds[supName];
    const c=clientChatOf(pid);
    const proj=(projects||[]).find(x=>x.id===pid);
    const names=(c?.memberNames||[]).filter(Boolean).join('、')||'—';
    // お客様がお二人以上（ご主人・奥様など）なら、その全員のお名前を出す
    const clientNames=(proj?.clients||[]).map(x=>x.name).filter(Boolean).join('、')
      || (proj?.clientName ? `${proj.clientName} 様` : '');
    metaEl.textContent = isClientUser()
      ? `きよかわ（担当：${names}）とのやりとりです`
      : `お客様${clientNames?`（${clientNames}）`:''}とのやりとり／きよかわ：${names}`;
  } else if(isGroupThread(supName)){
    const g=groupById(groupThreadIds[supName]);
    metaEl.innerHTML=`<button type="button" class="talk-group-meta" onclick="openGroupEditor(${g?g.id:'null'})" title="メンバー・グループ名の変更、退出">
      メンバー：${esc((g?.memberNames||[]).filter(Boolean).join('、')||'—')}<span>変更</span></button>`;
  } else metaEl.textContent=
    isDirectThread(supName) ? 'この2人だけのやりとりです'
    : supName===INTERNAL_THREAD ? '社員メンバーのみ表示されます'
    : isProjectThread(supName) ? (()=>{ const p=projects.find(x=>x.id===projectThreadIds[supName]);
        const ms=(p?.members||[]); return ms.length?('参加：'+ms.join('、')):'参加メンバー未設定（案件情報で選択できます）'; })()
    : (sup?.tel?'📞 '+sup.tel+(sup.email?' · ✉ '+sup.email:''):'');
  document.getElementById('talk-panel-list').style.display='none';
  document.getElementById('talk-panel-detail').style.display='flex';
  cancelQuote(); cancelEditMsg();
  notifyTargets = [];        // スレッドを開くたび通知先はALLに戻す
  updateNotifyLabel();
  setupMsgMenuHandlers();
  updateChatNewMark(false);
  _chatStick = true;
  // 未読の境目は、既読を記録する前にここで決めておく（記録してしまうと数えられない）
  chatSetUnreadMark(supName);
  renderTalkPanelMessages(true);
  // 表示を切り替えた直後は箱の高さが取れないことがある。次のひと呼吸で位置を合わせ直す
  if(chatUnreadMark) requestAnimationFrame(()=>{
    const box=document.getElementById('talk-panel-messages');
    if(box && box.clientHeight && chatUnreadMark?.place && chatScrollToUnread(box)) updateChatNewMark(true);
  });
  // 開いた時刻を既読として記録し、未読バッジを更新する
  dbMarkThreadRead(threadKeyOf(supName)).then(updateChatBadge).catch(()=>{});
  updateChatBadge();
  // 未読から読み始めるときは、キーボードを出さない（画面が縮んで読む位置がずれる）
  // 検索から飛んできたときも出さない（見つけたところを読むのが先）
  if(!chatUnreadMark && !opt?.noFocus) setTimeout(()=>document.getElementById('talk-panel-input').focus(),200);
}

// スレッド名 → 既読管理のキー
function threadKeyOf(name){
  if(name===INTERNAL_THREAD) return 'internal';
  if(isDirectThread(name)) return 'direct:'+(directThreadIds[name]||'?');
  if(isGroupThread(name)) return 'group:'+(groupThreadIds[name]||'?');
  if(isClientThread(name)) return 'client:'+(clientThreadIds[name]||'?');
  if(isProjectThread(name)) return 'project:'+(projectThreadIds[name]||'?');
  return 'supplier:'+(supplierIdByName(name)||'?');
}

// 通知から戻ってくるときの、合い印（threadKeyOf）→ スレッド名。
// スレッド名そのものを持ち回らないのは、個別チャットの名前が
// 見る人によって変わる（相手の名前が入る）ため。番号で持てば、どちらの端末でも引ける
function threadNameOfKey(key){
  const s = String(key||'');
  const i = s.indexOf(':');
  const kind = i<0 ? s : s.slice(0,i);
  const rest = i<0 ? '' : s.slice(i+1);
  const num  = Number(rest);
  if(kind==='internal') return INTERNAL_THREAD;
  if(kind==='direct')   return rest ? directThreadName(rest) : null;
  if(kind==='group')    return groupById(num) ? groupThreadName(num) : null;
  if(kind==='client')   return clientChatOf(num) ? clientThreadName(num) : null;
  if(kind==='project')  return projectThreadName(num);
  if(kind==='supplier') return supplierNameById(num);
  return null;
}

// 通知をタップして、そのスレッドを開く。
// 開けないとき（もう入っていない案件・消えたグループなど）は一覧のまま
function openTalkThreadByKey(key){
  const name = threadNameOfKey(key);
  if(!name || !visibleThreadNames().includes(name)){
    renderTalkPanelList();
    if(name) showToast('そのやりとりは、いまは開けません');
    return;
  }
  openTalkPanelThread(name);
}

// ════ 未読件数（自分が最後にスレッドを開いた時刻より後の、他人のメッセージ） ════

function myLastReadAt(threadName){
  const key=threadKeyOf(threadName);
  const rec=chatReads.find(r=>r.userId===currentUserId && r.thread===key);
  return rec ? rec.lastReadAt : 0;
}

function chatUnreadFor(threadName){
  const last=myLastReadAt(threadName);
  return (talkThreads[threadName]||[]).filter(m=>m.ts>last && m.senderName!==currentUserDisplayName).length;
}

// 自分が見られるスレッドの一覧（未読集計・スレッド一覧で共通に使う）
function visibleThreadNames(){
  const isEmployee = currentUserRole==='staff' || currentUserRole==='carpenter';
  const projNames = projects
    .filter(p=>currentUserRole==='staff' || isMyProjectMember(p.members))
    .map(p=>projectThreadName(p.id));
  const supNames=[...new Set([...suppliers.map(s=>s.name),...Object.keys(talkThreads)])]
    .filter(n=>n!==INTERNAL_THREAD && !isProjectThread(n) && !isDirectThread(n) && !isGroupThread(n) && !isClientThread(n));
  // 個別チャットは、やりとりがあるものだけ出す（作った時点で talkThreads に入る）
  const directNames=Object.keys(talkThreads).filter(isDirectThread);
  // グループは、自分がメンバーのものすべて（やりとりが無くても出す）
  const groupNames=(chatGroups||[]).map(g=>groupThreadName(g.id));
  const clientNames=(clientChats||[]).map(c=>clientThreadName(c.projectId));
  // お客様は、自分の案件のお客様チャットだけ
  if(isClientUser()) return clientNames;
  return [...(isEmployee?[INTERNAL_THREAD]:[]), ...groupNames, ...directNames, ...projNames, ...clientNames, ...supNames];
}

function chatUnreadTotal(){
  return visibleThreadNames().reduce((s,n)=>s+chatUnreadFor(n),0);
}

// ナビの「チャット」ボタンに未読件数を表示し、アプリアイコンのバッジも更新する
function updateChatBadge(){
  const n=chatUnreadTotal();
  const el=document.getElementById('nav-talk-dot');
  if(el){
    el.textContent = n>99 ? '99+' : (n||'');
    el.style.display = n ? 'flex' : 'none';
  }
  setAppBadgeCount(typeof appBadgeTotal==='function' ? appBadgeTotal() : n);
  return n;
}

function closeTalkPanelThread(){
  activeTalkPanelSupplier=null;
  chatUnreadMark=null;   // 閉じたら未読の境目も捨てる（次に開いたとき改めて決める）
  resetChatRenderSignature();
  document.getElementById('talk-panel-list').style.display='flex';
  document.getElementById('talk-panel-detail').style.display='none';
  renderTalkPanelList();
}

// ── メッセージの本文を組み立てる ──
//
// 貼り付けられたURLは、そのままタップで開けるようにする。
// 先に記号を打ち消してから（&・< を実体参照に）、そのあとでリンクにする。
// 順番を逆にすると、本文に書かれたタグがそのまま効いてしまう。
function talkTextHtml(text){
  const safe = String(text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
  // http:// https:// で始まるひとかたまり。日本語や空白、閉じ括弧の手前で切る
  const linked = safe.replace(/https?:\/\/[^\s<>"'）」』、。]+/g, (u)=>{
    // 文末の記号はURLに含めない（「…app/。」のような書き方に備える）
    const m = u.match(/[.,!?:;]+$/);
    const tail = m ? m[0] : '';
    const url = tail ? u.slice(0, -tail.length) : u;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="talk-link">${url}</a>${tail}`;
  });
  return linked.replace(/\n/g,'<br>');
}

// 引用（返信元）・編集済み・ブックマークの補助表示
function replyRefHtml(m){
  if(!m.replyToText) return '';
  return `<div class="quote-ref">${esc(m.replyToSender||'')}：${esc(m.replyToText)}</div>`;
}
// 画面に出すスレッド名。お客様には社内向けの「お客様：」を付けずに案件名だけを見せる
function threadLabel(name){
  return (isClientUser() && isClientThread(name)) ? String(name).slice(CLIENT_THREAD_PREFIX.length) : name;
}

// お客様チャットの既読。お客様が読んだら、きよかわ側の吹き出しに「既読」を出す。
// きよかわ側が読んだことは、お客様には出さない（お客様は自分の既読しか見られない）。
// お客様がお二人以上（ご主人・奥様など）のときは、読んだ方のお名前を出す
function clientReadMark(m){
  const t = activeTalkPanelSupplier;
  if(!isClientThread(t) || isClientUser()) return '';
  if(m.senderName !== currentUserDisplayName) return '';   // 自分が送ったものだけ
  const proj = (projects||[]).find(p=>p.id===clientThreadIds[t]);
  if(!proj) return '';
  const people = (proj.clients||[]).filter(c=>c.userId);
  if(!people.length && proj.clientUserId) people.push({userId:proj.clientUserId, name:''});
  if(!people.length) return '';
  const key = threadKeyOf(t);
  const read = people.filter(c=>{
    const rec = chatReads.find(r=>r.userId===c.userId && r.thread===key);
    return rec && rec.lastReadAt>=m.ts;
  });
  if(!read.length) return '';
  const label = (people.length>1 && read.length<people.length)
    ? `既読 ${read.map(c=>c.name||'お客様').join('、')}` : '既読';
  return `<span class="read-mark">${esc(label)}</span>`;
}

function msgMarks(m){
  const edited = m.editedAt ? '<span class="edited-mark">（編集済み）</span>' : '';
  const bm = (Array.isArray(m.bookmarks)&&m.bookmarks.includes(currentUserDisplayName)) ? '<span class="bm-mark" title="ブックマーク">🔖</span>' : '';
  return edited+bm+clientReadMark(m);
}

// いちばん下まで見ているか（少しの余裕をみて判定する）
const CHAT_BOTTOM_SLACK = 80;   // px
function chatAtBottom(el){
  if(!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= CHAT_BOTTOM_SLACK;
}

// いちばん下に貼り付いているか。写真の読み込みで高さが変わっても、
// 貼り付いている間は下に居続ける（勝手に上へずれないようにするため）
let _chatStick = true;

// ════ 開いたときの位置（未読のいちばん古いところ） ════
//
// スレッドを開いた時点の「ここから未読」の境目。開いている間は作り直さない。
//   ・開いた直後に既読を記録するので、描き直すたびに数え直すと境目が消えてしまう
//   ・Realtime で新着が来ても、読んでいる途中で境目を動かさない
let chatUnreadMark = null;        // {thread, firstId, place, hold}
const CHAT_UNREAD_TOP = 28;       // 未読の1件目を上端からこれだけ下に置く（前の話が少し見える）

function chatSetUnreadMark(threadName){
  chatUnreadMark = null;
  if(chatBookmarkFilter) return;   // ブックマークの絞り込み中は、境目も位置合わせもしない
  const last = myLastReadAt(threadName);
  let first = null;
  for(const m of (talkThreads[threadName]||[])){
    if(m.ts>last && m.senderName!==currentUserDisplayName && (!first || m.ts<first.ts)) first = m;
  }
  if(first) chatUnreadMark = {thread:threadName, firstId:first.id, place:true, hold:false};
}
// いま描く画面で「ここから未読」を出すメッセージID（出さないなら null）
function chatUnreadMarkId(){
  return (chatUnreadMark && !chatBookmarkFilter && chatUnreadMark.thread===activeTalkPanelSupplier)
    ? chatUnreadMark.firstId : null;
}

// 自分（プログラム）で動かしたスクロールと、指で動かしたスクロールを区別する。
// 区別しないと、未読の位置に送ったこと自体を「下まで見た」と取り違える
let _chatProgScroll = 0;
function chatSetScrollTop(el, top){
  _chatProgScroll++;
  el.scrollTop = top;
  requestAnimationFrame(()=>{ if(_chatProgScroll>0) _chatProgScroll--; });
  // 画面が裏に回っているとrequestAnimationFrameが来ない。
  // 戻ってきたときに「ずっと自分で動かしている」状態で固まらないよう、保険で戻す
  setTimeout(()=>{ _chatProgScroll = 0; }, 500);
}

// 箱の中身から見た位置（スクロールしても変わらない座標）
function chatAnchorTop(el, node){
  return el.scrollTop + (node.getBoundingClientRect().top - el.getBoundingClientRect().top) - el.clientTop;
}

// 「ここから未読」を画面の上のほうに置くときの、送り先の位置
function chatUnreadAnchorY(el, sep){
  // 未読より前に吹き出しがあるか。あるなら前の話が少し見えるところに置き、
  // 無いなら（ぜんぶ未読）いちばん上から出す（日付の見出しを欠けさせない）
  for(let p=sep.previousElementSibling; p; p=p.previousElementSibling){
    if(p.classList.contains('talk-bubble')) return Math.max(0, chatAnchorTop(el,sep) - CHAT_UNREAD_TOP);
  }
  return 0;
}

// 「ここから未読」が画面の上のほうに来るところまで送る。
// いちばん下まで送っても境目が見えるなら、今までどおり下へ（戻り値 false）
function chatScrollToUnread(el){
  const mark = chatUnreadMark;
  if(!el || !mark || mark.thread!==activeTalkPanelSupplier) return false;
  const sep = el.querySelector('.talk-unread-sep');
  if(!sep){ mark.place=false; mark.hold=false; return false; }
  const y = chatUnreadAnchorY(el, sep);
  const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
  mark.place = false;
  if(y >= maxTop - 1){ mark.hold=false; return false; }   // 下まで送れば見える
  _chatStick = false;
  mark.hold = true;
  chatSetScrollTop(el, y);
  return true;
}

// 自分でスクロールしたかどうかを見て、貼り付けを入り切りする
function chatWatchScroll(el){
  if(!el || el._chatWatched) return;
  el._chatWatched = true;
  el.addEventListener('scroll', ()=>{
    if(_chatProgScroll) return;   // 自分で動かしたぶんは、指の操作と見なさない
    if(chatUnreadMark) chatUnreadMark.hold = false;   // 指で動かしたら未読位置の保持をやめる
    _chatStick = chatAtBottom(el);
    if(_chatStick) updateChatNewMark(false);
  }, {passive:true});
}

// 写真は描いたあとに読み込まれ、そのぶん高さが増える。
// 何もしないと、増えた高さのぶんだけ画面が上にずれてしまうので、
// 貼り付け中は読み込みが終わるたびにいちばん下へ送り直す
function chatKeepBottomOnLoad(el){
  if(!el) return;
  el.querySelectorAll('img').forEach(img=>{
    if(img.complete) return;
    const fix = ()=>{
      if(_chatStick){ chatSetScrollTop(el, el.scrollHeight); return; }
      // 未読の位置で開いたときは、上にある写真が入って高さが増えても同じ位置に居続ける
      const mark = chatUnreadMark;
      if(mark && mark.hold && mark.thread===activeTalkPanelSupplier){
        const sep = el.querySelector('.talk-unread-sep');
        if(sep) chatSetScrollTop(el, chatUnreadAnchorY(el, sep));
      }
    };
    img.addEventListener('load', fix, {once:true});
    img.addEventListener('error', fix, {once:true});
  });
}
// 上に戻して読んでいる間に新しいメッセージが来たときに出す案内
function updateChatNewMark(show){
  const b=document.getElementById('talk-new-msg');
  if(b) b.style.display = show ? '' : 'none';
}
function chatScrollToBottom(){
  const el=document.getElementById('talk-panel-messages');
  if(!el) return;
  _chatStick = true;
  if(chatUnreadMark) chatUnreadMark.hold = false;
  chatSetScrollTop(el, el.scrollHeight);
  updateChatNewMark(false);
}

// 上に戻して読んでいる途中に描き直しが入っても、勝手に下へ飛ばさない。
// forceBottom＝true のときだけ、いちばん下まで送る（スレッドを開いたとき・自分が送ったとき）
// いま画面に出ている中身の見分け札。
// 描き直しても同じ中身になるなら、そのまま置いておく。
// 毎回 innerHTML を作り直すと写真が読み込み直しになって画面がチカチカするため。
let _chatRenderSig = '';
// ════ もっと前を読む ════
//
// 開いたときに読むのは、スレッドごとの直近だけ（js/data/db.js の CHAT_FIRST_LOAD）。
// 上まで戻ったら、このボタンでその続きを足す。
// 足したぶん中身が上に伸びるので、読んでいたところが動かないように位置を直す。
let _chatLoadingOlder = false;

async function loadOlderChat(){
  const thread = activeTalkPanelSupplier;
  const list = talkThreads[thread] || [];
  if(_chatLoadingOlder || !list.length) return;
  const oldest = list.find(m=>typeof m.id === 'number');   // 送信中（tmp-…）は数字でない
  if(!oldest){ chatOlder[thread] = false; return; }

  _chatLoadingOlder = true;
  const btn = document.querySelector('.talk-more button');
  if(btn){ btn.disabled = true; btn.textContent = '読んでいます…'; }
  const el = document.getElementById('talk-panel-messages');
  const h0 = el ? el.scrollHeight : 0, t0 = el ? el.scrollTop : 0;

  let rows;
  try{ rows = await dbOlderChatRows(oldest.id); }
  catch(_){ _chatLoadingOlder = false; renderTalkPanelMessages(); return; }
  _chatLoadingOlder = false;

  // 返ってきた数が頼んだ数より少なければ、もう前は無い
  if(rows.length < CHAT_MORE_LOAD) chatOlder[thread] = false;
  const have = new Set(list.map(m=>m.id));
  const add = rows.map(chatRowToMsg).filter(m=>!have.has(m.id));
  if(add.length){
    talkThreads[thread] = add.concat(talkThreads[thread]||[]).sort((a,b)=>a.ts-b.ts);
  }
  resetChatRenderSignature();
  renderTalkPanelMessages();
  // 増えた高さのぶんだけ下へ送り、さっきまで読んでいたところに戻す
  if(el) chatSetScrollTop(el, t0 + (el.scrollHeight - h0));
}

function chatMoreHtml(){
  if(chatBookmarkFilter || !chatOlder[activeTalkPanelSupplier]) return '';
  return '<div class="talk-more"><button type="button" class="btn xs" onclick="loadOlderChat()">もっと前を読む</button></div>';
}

function chatRenderSignature(supplier, msgs){
  return supplier + '|' + (chatBookmarkFilter?'bm':'') + '|' + (chatOlder[supplier]?'o':'')
    + '|' + (chatUnreadMarkId()??'') + '|' + msgs.map(m=>[
    m.id, m.ts, m.type, m.text, m.editedAt, m.fileUrl,
    JSON.stringify(m.reactions||{}), (m.bookmarks||[]).join(','),
    m.sending?'s':'', m.failed?'f':''
  ].join('~')).join('|');
}
function resetChatRenderSignature(){ _chatRenderSig = ''; }

function renderTalkPanelMessages(forceBottom){
  const internalThread = isNamedSenderThread(activeTalkPanelSupplier);
  let msgs=talkThreads[activeTalkPanelSupplier]||[];
  if(chatBookmarkFilter) msgs=msgs.filter(m=>Array.isArray(m.bookmarks)&&m.bookmarks.includes(currentUserDisplayName));
  document.getElementById('talk-bm-filter')?.classList.toggle('active',chatBookmarkFilter);
  const el=document.getElementById('talk-panel-messages');

  // 中身が前と同じなら描き直さない（他の人の既読などで呼ばれたとき）
  const sig = chatRenderSignature(activeTalkPanelSupplier, msgs);
  if(forceBottom!==true && sig===_chatRenderSig && el && el.children.length){
    // 中身が同じでも、未読の位置合わせがまだ済んでいないならここでやる
    // （開いた直後は箱の高さが取れず、見送っていることがある）
    if(el.clientHeight && chatUnreadMark?.place) chatScrollToUnread(el);
    return;
  }
  _chatRenderSig = sig;
  // 描き直す前の位置と、いちばん下を見ていたかどうかを覚えておく
  const wasAtBottom = chatAtBottom(el);
  const prevTop = el ? el.scrollTop : 0;
  const prevCount = el ? el.querySelectorAll('.talk-bubble').length : 0;
  if(!msgs.length){
    el.innerHTML = chatBookmarkFilter
      ? '<div class="empty" style="padding:24px">ブックマークしたメッセージはありません。</div>'
      : (internalThread
        ? '<div class="empty" style="padding:24px">まだメッセージがありません。<br>社員メンバーへの連絡・共有に使えます。</div>'
        : '<div class="empty" style="padding:24px">まだメッセージがありません。<br>発注確定するとここに発注書が届きます。</div>');
    return;
  }
  let lastDate='';
  const unreadId = chatUnreadMarkId();
  el.innerHTML=chatMoreHtml()+msgs.map(m=>{
    const dLabel=dateLabel(m.ts);
    const dsep=dLabel!==lastDate?`<div class="talk-date-sep">${dLabel}</div>`:'';
    lastDate=dLabel;
    // 日付 →「ここから未読」→ 吹き出し の順に出す。
    // 吹き出しの手前に付けるものはこの sep にまとめてあり、下の各 return で使っている
    const sep = dsep + (unreadId!=null && m.id===unreadId ? '<div class="talk-unread-sep">ここから未読</div>' : '');
    const time=new Date(m.ts).getHours()+':'+String(new Date(m.ts).getMinutes()).padStart(2,'0');
    if(m.type==='order'){
      const o=m.orderData;
      // 発注のいまの中身は orders 側が正しい（発注先が単価を直すことがあるため）
      const liveOrder = (typeof orderByNo==='function') ? orderByNo(o.no) : null;
      const showItems = liveOrder?.items || o.items;
      const showTotal = liveOrder ? liveOrder.total : o.total;
      const itemRows=showItems.slice(0,4).map(i=>{
        const now=Math.round(Number(i.cost ?? i.price)||0);
        const orig=(i.origPrice===undefined||i.origPrice===null)?now:Math.round(Number(i.origPrice)||0);
        const q=Number(i.qty)||0;
        return `<div class="ocb-row"><span>${i.name}×${q}${i.unit}</span><span>${
          orig!==now ? `<span class="ope-old">¥${fmt(orig*q)}</span> ` : ''}¥${fmt(now*q)}</span></div>`;
      }).join('')
        +(showItems.length>4?`<div style="font-size:11px;color:var(--text-muted);padding:3px 0">他${showItems.length-4}品目…</div>`:'');
      return `${sep}<div class="talk-bubble me" data-mid="${m.id}">
        ${replyRefHtml(m)}
        <div class="order-card-bubble">
          <div class="ocb-head">
            <svg viewBox="0 0 24 24" fill="none" stroke="#d4a96a" width="15" height="15" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <div><div class="ocb-title">発 注 書</div><div class="ocb-no">${o.no}</div></div>
          </div>
          <div class="ocb-body">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">📅 ${o.date}　📦 ${o.project}${
              (liveOrder||o).dueAsap ? '　🚚 <b style="color:var(--accent-t)">最短</b>'
              : (liveOrder||o).dueDate ? '　🚚 '+(liveOrder||o).dueDate : ''}</div>
            ${(liveOrder||o).paymentMethod ? '' : `<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">📍 ${esc(orderDeliveryLabel(liveOrder||o))}</div>`}
            ${itemRows}
            <div class="ocb-total">合計 ¥${fmt(showTotal)}</div>
            ${(typeof orderPriceEditHtml==='function' && liveOrder) ? orderPriceEditHtml(liveOrder) : ''}
          </div>
          <div class="ocb-foot">
            ${o.pdfUrl ? `<button class="btn sm wood" onclick="openPdfViewer('${o.pdfUrl}')" style="flex:1;justify-content:center">
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" width="12" height="12" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              PDFを表示
            </button>` : `<button class="btn sm wood" onclick="downloadOrderPdf(${m.id})" style="flex:1;justify-content:center">
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" width="12" height="12" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              PDF出力
            </button>`}
            ${orderPriceEditBtnHtml(o.no)}
          </div>
          ${orderReceiveHtml(o)}
        </div>
        <div class="ts">${time}${msgMarks(m)}</div>
        ${reactionsHtml(m,true)}
      </div>`;
    }
    // ここまで発注書の吹き出し

    // ── 見積依頼の吹き出し ──
    // 発注書と似た見た目にするが、金額は出さない（まだ決まっていないので）
    if(m.type==='quote'){
      const q=m.orderData||{};
      const live=(quoteRequests||[]).find(x=>x.no===q.no) || q;
      const rows=(q.items||[]).slice(0,5).map(i=>
        `<div class="ocb-row"><span>${esc(i.name||'')}${i.spec?`<span style="color:var(--text-muted)">（${esc(i.spec)}）</span>`:''}</span><span>${i.qty}${esc(i.unit||'')}</span></div>`
      ).join('')
        +((q.items||[]).length>5?`<div style="font-size:11px;color:var(--text-muted);padding:3px 0">他${q.items.length-5}品目…</div>`:'');
      const answered = live.status==='answered';
      return `${sep}<div class="talk-bubble me" data-mid="${m.id}">
        ${replyRefHtml(m)}
        <div class="order-card-bubble quote">
          <div class="ocb-head">
            <svg viewBox="0 0 24 24" fill="none" stroke="#d4a96a" width="15" height="15" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
            <div><div class="ocb-title">見 積 依 頼</div><div class="ocb-no">${esc(q.no||'')}</div></div>
          </div>
          <div class="ocb-body">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">📦 ${esc(q.project||'')}${
              q.replyBy?`　⏱ 回答希望 ${String(q.replyBy).replace(/-/g,'/')}`:''}</div>
            ${rows}
            ${q.note?`<div style="font-size:11px;color:var(--text-muted);margin-top:5px;white-space:pre-wrap">${esc(q.note)}</div>`:''}
            <div class="ocb-total" style="font-size:12px">お見積りをお願いします${answered?'　<b style="color:var(--ok-t)">回答済み</b>':''}</div>
          </div>
          <div class="ocb-foot">
            ${q.pdfUrl ? `<button class="btn sm wood" onclick="openPdfViewer('${q.pdfUrl}')" style="flex:1;justify-content:center">
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" width="12" height="12" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              見積依頼書を表示
            </button>` : ''}
            ${live.id ? `<button class="btn sm" onclick="openQuoteAnswer(${live.id})" title="見積が届いたら単価を入れる">${answered?'回答を見る':'回答を入力'}</button>` : ''}
          </div>
        </div>
        <div class="ts">${time}${msgMarks(m)}</div>
        ${reactionsHtml(m,true)}
      </div>`;
    }

    // 社内チャットは送信者名で自分／他人を判定（全員が社員のためroleでは区別できない）
    const isMe = internalThread ? m.senderName===currentUserDisplayName : m.role==='me';
    if(m.type==='file'){
      const isImage=(m.fileMime||'').startsWith('image/');
      return `${sep}<div class="talk-bubble ${isMe?'me':'them'}" data-mid="${m.id}">
        ${replyRefHtml(m)}
        ${isImage
          ? `<a href="${m.fileUrl}" target="_blank" rel="noopener"><img src="${thumbUrl(m.fileUrl,400)}" alt="${esc(m.fileName||'')}" style="max-width:200px;max-height:200px;border-radius:8px;display:block"></a>`
          : `<a href="${m.fileUrl}" target="_blank" rel="noopener" download class="bbl" style="display:flex;align-items:center;gap:6px;text-decoration:none;color:inherit">
              <span style="font-size:18px">${talkFileIcon(m.fileName, m.fileMime)}</span><span style="word-break:break-all">${esc(m.fileName||'資料')}</span>
            </a>`}
        <div class="ts">${m.senderName||( isMe?'きよかわ':activeTalkPanelSupplier)}　${time}${msgMarks(m)}</div>
        ${reactionsHtml(m,isMe)}
      </div>`;
    }
    const sendMark = m.failed ? '<span class="talk-send-ng">送れませんでした</span>'
                   : m.sending ? '<span class="talk-sending">送信中…</span>' : '';
    return `${sep}<div class="talk-bubble ${isMe?'me':'them'}${m.sending?' sending':''}" data-mid="${m.id}">
      ${replyRefHtml(m)}
      <div class="bbl">${talkTextHtml(m.text)}</div>
      <div class="ts">${m.senderName||( isMe?'きよかわ':activeTalkPanelSupplier)}　${time}${sendMark}${msgMarks(m)}</div>
      ${reactionsHtml(m,isMe)}
    </div>`;
  }).join('');

  chatWatchScroll(el);

  // 画面に出ていないとき（別のページを見ている間の描き直しなど）は、
  // 高さが取れないので位置をいじらない
  if(!el.clientHeight){ chatKeepBottomOnLoad(el); return; }

  // 開いた直後は、未読のいちばん古いところへ送る。
  // 未読が無い／下まで送れば未読も見えるときは、今までどおりいちばん下へ
  if(chatUnreadMark?.place && chatScrollToUnread(el)){
    updateChatNewMark(true);   // 下に新しいぶんが残っているので、飛べる案内を出す
  }
  // いちばん下を見ていたとき、または送信直後だけ下まで送る。
  // それ以外は読んでいた位置に戻す（勝手に下へ飛ばない）
  else if(forceBottom===true || wasAtBottom){
    _chatStick = true;
    if(chatUnreadMark) chatUnreadMark.hold = false;
    chatSetScrollTop(el, el.scrollHeight);
    updateChatNewMark(false);
  } else {
    _chatStick = false;
    chatSetScrollTop(el, prevTop);
    // 上を読んでいる間に増えたぶんがあれば、案内を出す
    if(el.querySelectorAll('.talk-bubble').length > prevCount) updateChatNewMark(true);
  }
  chatKeepBottomOnLoad(el);
}

function sendTalkPanelMsg(){
  const input=document.getElementById('talk-panel-input');
  const text=input.value.trim();
  if(!text||!activeTalkPanelSupplier) return;
  if(!talkThreads[activeTalkPanelSupplier]) talkThreads[activeTalkPanelSupplier]=[];
  // 編集モード：既存メッセージの本文を書き換える
  if(editingMsgId){
    const id=editingMsgId;
    input.value=''; cancelEditMsg();
    dbEditChatMessage(id,text).then(()=>renderTalkPanelMessages(true)).catch(()=>{});
    return;
  }
  const role = (activeTalkPanelSupplier===INTERNAL_THREAD || currentUserRole!=='supplier') ? 'me' : 'them';
  // 引用（返信元）を添付
  const q = quotingMsg;
  const extra = q ? {replyToId:q.id, replyToSender:q.senderName||(activeTalkPanelSupplier===INTERNAL_THREAD?'':'きよかわ'), replyToText:(q.text||(q.type==='file'?'📎 '+(q.fileName||'ファイル'):q.type==='order'?'📋 発注書':'')).slice(0,80)} : {};
  input.value=''; cancelQuote();
  // 通知先の指定を反映（空＝ALL）。社内・案件・発注先のどのスレッドでも効く
  const notify = notifyTargets.length ? {notifyNames:[...notifyTargets]} : {};

  // 送った内容をその場で出す（送り終わるのを待たない）。
  // Supabaseへの登録が終わったら、本物のメッセージに差し替える
  const thread = activeTalkPanelSupplier;
  const temp = {
    id: 'tmp-' + Date.now(), sending: true,
    role, type:'text', text, ts: Date.now(),
    senderName: currentUserDisplayName||'', unread:false, reactions:{}, bookmarks:[],
    replyToText: extra.replyToText||'', replyToSender: extra.replyToSender||''
  };
  if(!talkThreads[thread]) talkThreads[thread]=[];
  talkThreads[thread].push(temp);
  renderTalkPanelMessages(true);

  dbAddChatMessage(thread,{role,type:'text',text,...extra,...notify})
    .then(()=>{
      // dbAddChatMessage が本物を足しているので、仮の1件を外す
      const list = talkThreads[thread]||[];
      const i = list.indexOf(temp);
      if(i>=0) list.splice(i,1);
      // 送り終わるまでに別のチャットへ移っていたら、そちらの位置は動かさない
      if(thread===activeTalkPanelSupplier) renderTalkPanelMessages(true);
    })
    .catch(()=>{
      // 送れなかったときは仮の1件に印を付けて残す（消えると何が送れなかったか分からなくなる）
      temp.sending = false; temp.failed = true;
      if(thread===activeTalkPanelSupplier) renderTalkPanelMessages(true);
    });
}

// 添付の種類ごとのしるし。何の資料かがひと目で分かるようにする
function talkFileIcon(name, mime){
  const ext = String(name||'').toLowerCase().match(/.([a-z0-9]+)$/)?.[1] || '';
  const m = String(mime||'').toLowerCase();
  if(ext==='pdf' || m==='application/pdf')                                  return '📕';
  if(['doc','docx','dot','dotx','rtf'].includes(ext) || m.includes('word')) return '📘';
  if(['xls','xlsx','xlsm','xlsb','csv'].includes(ext)
     || m.includes('excel') || m.includes('spreadsheet') || m==='text/csv') return '📗';
  if(['ppt','pptx'].includes(ext) || m.includes('powerpoint') || m.includes('presentation')) return '📙';
  if(['zip','7z','rar'].includes(ext) || m.includes('zip'))                 return '🗜️';
  if(['txt','md','log'].includes(ext) || m.startsWith('text/'))             return '📝';
  return '📄';
}

// 送る前のひと手間。写真は長辺1600pxのJPEGにしてから送る。
//   ・そのままだと1枚が数MBあり、電波が弱いと送れないことがある
//   ・iPhoneのHEICもJPEGになるので、パソコンやAndroidでも開ける
async function talkPrepareFile(file){
  let body = file, name = file.name || '写真', mime = file.type || '';
  try{
    if(mime.startsWith('image/') && typeof gbCompressImage==='function'){
      const blob = await gbCompressImage(file);
      if(blob && blob !== file && blob.size){
        body = blob;
        mime = blob.type || 'image/jpeg';
        name = name.replace(/\.[^.]+$/,'') + '.jpg';
      }
    }
  }catch(_){ /* 変換できない形式はそのまま送る */ }
  return {body,name,mime};
}

async function sendTalkPanelFile(fileInput){
  const files=[...(fileInput.files||[])];
  fileInput.value='';
  // 送り先は開いたときのスレッドに固定する（送っている間に別のチャットへ移っても迷子にならない）
  const thread = activeTalkPanelSupplier;
  if(!files.length || !thread) return;
  const role = (thread===INTERNAL_THREAD || currentUserRole!=='supplier') ? 'me' : 'them';
  const many = files.length > 1;

  // 選んだ順に並ぶよう1枚ずつ送る。次の1枚の変換は、送っている間に済ませておく
  let next = talkPrepareFile(files[0]);
  const failed = [];
  for(let i=0;i<files.length;i++){
    showToast(many ? `アップロード中… ${i+1}/${files.length}` : 'アップロード中…', 30000);
    const cur = next;
    next = (i+1<files.length) ? talkPrepareFile(files[i+1]) : null;
    try{
      const {body,name,mime} = await cur;
      const fileUrl = await dbUploadChatFile(body, name, mime);
      await dbAddChatMessage(thread,{role,type:'file',fileUrl,fileName:name,fileMime:mime});
      // 自分が送ったので、いちばん下まで送る（1枚ずつ出るので進み具合も分かる）
      if(thread===activeTalkPanelSupplier) renderTalkPanelMessages(true);
    }catch(e){
      failed.push(e);
    }
  }

  if(!failed.length){
    showToast(many ? `${files.length}件送信しました` : '送信しました');
    return;
  }
  // 理由が出ていない落ち方（画像の変換に失敗したときなど）もここで知らせる
  const e = failed[0];
  const why = (e && e.friendly) ? '' : '：'+((e&&e.message)||e||'原因不明');
  if(many) showToast(`${files.length}件のうち${failed.length}件送れませんでした${why}`);
  else if(why) showToast('送れませんでした'+why);
}

async function deleteTalkMessage(msgId){
  if(!confirm('このメッセージを削除しますか？')) return;
  try{
    await dbDeleteChatMessage(activeTalkPanelSupplier,msgId);
  }catch(e){return;}
  renderTalkPanelMessages();
  // 一覧画面のプレビュー文言は、一覧に戻った際に再描画される
}

function downloadOrderPdf(msgId){
  const sup=activeTalkPanelSupplier;
  const msg=(talkThreads[sup]||[]).find(m=>m.id===msgId);
  if(!msg||msg.type!=='order') return;
  // 単価をあとから直していることがあるので、いまの発注の中身で出す
  const live=(typeof orderByNo==='function') ? orderByNo(msg.orderData.no) : null;
  const o=live ? {...msg.orderData, ...live} : msg.orderData;
  printHtml(`発注書 ${o.no}`, buildOrderPdfHtml(o));
}
