// ════ 社内チャットの通知先（ALL＝全員／個別指定） ════
let notifyTargets = [];   // 空＝ALL（全員）。表示名の配列

// 社員（発注先ではない人）の表示名。自分は除く。
// 発注先チャットは管理者も一般社員も見られて書き込めるので、どちらも候補に出す
function _staffNames(){
  return (typeof allProfiles!=='undefined' ? allProfiles : [])
    .filter(p=>p.role!=='supplier' && p.displayName && p.displayName!==currentUserDisplayName)
    .map(p=>p.displayName);
}
// その発注先のアカウント（担当者）の表示名。自分は除く
function _supplierNames(supName){
  const sid = supplierIdByName(supName);
  if(!sid) return [];
  return (typeof allProfiles!=='undefined' ? allProfiles : [])
    .filter(p=>p.role==='supplier' && p.supplierId===sid && p.displayName && p.displayName!==currentUserDisplayName)
    .map(p=>p.displayName);
}

// 通知先の候補。まとまりごとに分けて返す
//   社内チャット … 社員全員
//   案件チャット … 参加メンバー
//   発注先チャット … その発注先の担当者と、きよかわの社員
//     （発注先の人から見れば自分の会社の同僚は候補に出ない。自分は常に除く）
function notifyGroups(){
  const t = activeTalkPanelSupplier;
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
  if(received){
    return `<div style="padding:6px 10px 8px;font-size:11px;color:var(--ok-t);font-weight:700;text-align:center">
      ✓ 受領済み${ord?.receivedAt?`（${String(ord.receivedAt).slice(0,10).replace(/-/g,'/')}）`:''}</div>`;
  }
  if(currentUserRole!=='supplier') return '';
  return `<div style="padding:4px 10px 10px">
    <button class="btn sm primary" style="width:100%;justify-content:center" onclick="receiveOrderFromChat('${esc(o.no)}')">
      受領しました
    </button>
  </div>`;
}

// 発注先が発注書を受領する
async function receiveOrderFromChat(orderNo){
  const ord=(orders||[]).find(x=>x.no===orderNo);
  if(!confirm(`発注書 ${orderNo} を受領しましたと伝えます。よろしいですか？`)) return;
  try{
    await dbMarkOrderReceived(orderNo, ord?.suppliers || currentUserDisplayName);
    if(ord){ ord.status='received'; ord.receivedAt=new Date().toISOString(); }
    renderTalkPanelMessages();
    showToast('受領しました。きよかわに伝わります');
    // 社内へ通知＋チャットにも残す
    dbSendPushToRole('staff', '発注書が受領されました',
      `${currentUserDisplayName||''} ${orderNo}`, 'order/history').catch(()=>{});
    dbAddChatMessage(activeTalkPanelSupplier, {role:'them', type:'text',
      text:`発注書 ${orderNo} を受領しました`}).catch(()=>{});
  }catch(_){}
}

// 発注書の吹き出しに出す「単価を直す」。発注先ときよかわの管理者だけ
function orderPriceEditBtnHtml(orderNo){
  if(typeof openOrderPriceEdit!=='function') return '';
  if(currentUserRole!=='supplier' && currentUserRole!=='staff') return '';
  if(typeof orderByNo==='function' && !orderByNo(orderNo)) return '';   // 発注が見つからないときは出さない
  return `<button class="btn sm" onclick="openOrderPriceEdit('${esc(orderNo)}')" style="flex:1;justify-content:center">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="12" height="12" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
    単価を直す
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
  const internalThread = activeTalkPanelSupplier===INTERNAL_THREAD || isProjectThread(activeTalkPanelSupplier);
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
  html+=item('✓✓','既読メンバー','menuReadMembers()');
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

// 入力欄が画面下に収まるよう、チャット領域の高さを実際の位置から計算する
function fitTalkPage(){
  const wrap = document.getElementById('talk-page-wrap');
  if(!wrap || !document.getElementById('page-talk')?.classList.contains('active')) return;
  window.scrollTo(0,0);   // ページ先頭を基準に測る
  const nav = document.getElementById('app-nav');
  const navH = nav && nav.style.display!=='none' ? nav.offsetHeight : 0;
  const top = wrap.getBoundingClientRect().top;   // 画面上端からの位置
  const margin = parseFloat(getComputedStyle(wrap).marginBottom)||0;
  let h = Math.max(320, window.innerHeight - top - navH - margin - 4);
  wrap.style.height = h + 'px';
  // 余白の分だけページがスクロールしてしまう場合は、その分だけ縮める
  const excess = document.documentElement.scrollHeight - window.innerHeight;
  if(excess > 0 && h - excess >= 320) wrap.style.height = (h - excess) + 'px';
}
window.addEventListener('resize', fitTalkPage);

function renderTalkPanelList(){
  document.getElementById('talk-panel-list').style.display='flex';
  document.getElementById('talk-panel-detail').style.display='none';
  // 案件チャット：管理者は全案件、それ以外（一般社員・業者）は参加している案件のみ
  const names=visibleThreadNames();
  const el=document.getElementById('talk-panel-thread-list');
  if(!names.length){el.innerHTML='<div class="empty">発注先が登録されていません</div>';return;}
  updateChatBadge();
  // 最新の書き込みがあるスレッドを上に。書き込みが無いスレッドは下に元の順で並べる
  const lastTs=n=>{ const l=(talkThreads[n]||[]); return l.length ? l[l.length-1].ts : 0; };
  const allSups=names.map((n,i)=>({n,i,ts:lastTs(n)}))
    .sort((a,b)=> b.ts-a.ts || a.i-b.i)
    .map(x=>x.n);
  el.innerHTML=allSups.map(name=>{
    const isInternal=name===INTERNAL_THREAD;
    const isProject=isProjectThread(name);
    const msgs=talkThreads[name]||[];
    const last=msgs[msgs.length-1];
    const preview=last?(last.type==='order'?'📋 発注書 '+last.orderData.no:last.type==='file'?'📎 '+last.fileName:last.text)
      :(isInternal?'社員メンバーの連絡用':isProject?'この案件のメンバーで連絡':'タップしてトークを開始');
    const sup=suppliers.find(s=>s.name===name);
    const unread=chatUnreadFor(name);
    return `<div class="sup-thread-row" onclick="openTalkPanelThread('${name.replace(/'/g,"\\'")}')">
      <div class="sup-thread-icon">${isInternal?'🏡':isProject?'🏗':'🏪'}</div>
      <div class="sup-thread-info">
        <div class="sup-thread-name">${name}</div>
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

function openTalkPanelThread(supName){
  activeTalkPanelSupplier=supName;
  resetChatRenderSignature();   // スレッドを開いたら必ず描き直す
  if(!talkThreads[supName]) talkThreads[supName]=[];
  const sup=suppliers.find(s=>s.name===supName);
  document.getElementById('talk-panel-title').textContent=supName;
  document.getElementById('talk-panel-meta').textContent=
    supName===INTERNAL_THREAD ? '社員メンバーのみ表示されます'
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
  renderTalkPanelMessages(true);
  // 開いた時刻を既読として記録し、未読バッジを更新する
  dbMarkThreadRead(threadKeyOf(supName)).then(updateChatBadge).catch(()=>{});
  updateChatBadge();
  setTimeout(()=>document.getElementById('talk-panel-input').focus(),200);
}

// スレッド名 → 既読管理のキー
function threadKeyOf(name){
  if(name===INTERNAL_THREAD) return 'internal';
  if(isProjectThread(name)) return 'project:'+(projectThreadIds[name]||'?');
  return 'supplier:'+(supplierIdByName(name)||'?');
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
    .filter(n=>n!==INTERNAL_THREAD && !isProjectThread(n));
  return [...(isEmployee?[INTERNAL_THREAD]:[]), ...projNames, ...supNames];
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
  resetChatRenderSignature();
  document.getElementById('talk-panel-list').style.display='flex';
  document.getElementById('talk-panel-detail').style.display='none';
  renderTalkPanelList();
}

// 引用（返信元）・編集済み・ブックマークの補助表示
function replyRefHtml(m){
  if(!m.replyToText) return '';
  return `<div class="quote-ref">${esc(m.replyToSender||'')}：${esc(m.replyToText)}</div>`;
}
function msgMarks(m){
  const edited = m.editedAt ? '<span class="edited-mark">（編集済み）</span>' : '';
  const bm = (Array.isArray(m.bookmarks)&&m.bookmarks.includes(currentUserDisplayName)) ? '<span class="bm-mark" title="ブックマーク">🔖</span>' : '';
  return edited+bm;
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

// 自分でスクロールしたかどうかを見て、貼り付けを入り切りする
function chatWatchScroll(el){
  if(!el || el._chatWatched) return;
  el._chatWatched = true;
  el.addEventListener('scroll', ()=>{
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
    const fix = ()=>{ if(_chatStick) el.scrollTop = el.scrollHeight; };
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
  el.scrollTop=el.scrollHeight;
  updateChatNewMark(false);
}

// 上に戻して読んでいる途中に描き直しが入っても、勝手に下へ飛ばさない。
// forceBottom＝true のときだけ、いちばん下まで送る（スレッドを開いたとき・自分が送ったとき）
// いま画面に出ている中身の見分け札。
// 描き直しても同じ中身になるなら、そのまま置いておく。
// 毎回 innerHTML を作り直すと写真が読み込み直しになって画面がチカチカするため。
let _chatRenderSig = '';
function chatRenderSignature(supplier, msgs){
  return supplier + '|' + (chatBookmarkFilter?'bm':'') + '|' + msgs.map(m=>[
    m.id, m.ts, m.type, m.text, m.editedAt, m.fileUrl,
    JSON.stringify(m.reactions||{}), (m.bookmarks||[]).join(','),
    m.sending?'s':'', m.failed?'f':''
  ].join('~')).join('|');
}
function resetChatRenderSignature(){ _chatRenderSig = ''; }

function renderTalkPanelMessages(forceBottom){
  const internalThread = activeTalkPanelSupplier===INTERNAL_THREAD || isProjectThread(activeTalkPanelSupplier);
  let msgs=talkThreads[activeTalkPanelSupplier]||[];
  if(chatBookmarkFilter) msgs=msgs.filter(m=>Array.isArray(m.bookmarks)&&m.bookmarks.includes(currentUserDisplayName));
  document.getElementById('talk-bm-filter')?.classList.toggle('active',chatBookmarkFilter);
  const el=document.getElementById('talk-panel-messages');

  // 中身が前と同じなら描き直さない（他の人の既読などで呼ばれたとき）
  const sig = chatRenderSignature(activeTalkPanelSupplier, msgs);
  if(forceBottom!==true && sig===_chatRenderSig && el && el.children.length) return;
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
  el.innerHTML=msgs.map(m=>{
    const dLabel=dateLabel(m.ts);
    const sep=dLabel!==lastDate?`<div class="talk-date-sep">${dLabel}</div>`:'';
    lastDate=dLabel;
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
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">📅 ${o.date}　📦 ${o.project}</div>
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

    // 社内チャットは送信者名で自分／他人を判定（全員が社員のためroleでは区別できない）
    const isMe = internalThread ? m.senderName===currentUserDisplayName : m.role==='me';
    if(m.type==='file'){
      const isImage=(m.fileMime||'').startsWith('image/');
      return `${sep}<div class="talk-bubble ${isMe?'me':'them'}" data-mid="${m.id}">
        ${replyRefHtml(m)}
        ${isImage
          ? `<a href="${m.fileUrl}" target="_blank" rel="noopener"><img src="${m.fileUrl}" alt="${esc(m.fileName||'')}" style="max-width:200px;max-height:200px;border-radius:8px;display:block"></a>`
          : `<a href="${m.fileUrl}" target="_blank" rel="noopener" download class="bbl" style="display:flex;align-items:center;gap:6px;text-decoration:none;color:inherit">
              <span style="font-size:18px">📄</span><span style="word-break:break-all">${esc(m.fileName||'資料')}</span>
            </a>`}
        <div class="ts">${m.senderName||( isMe?'きよかわ':activeTalkPanelSupplier)}　${time}${msgMarks(m)}</div>
        ${reactionsHtml(m,isMe)}
      </div>`;
    }
    const sendMark = m.failed ? '<span class="talk-send-ng">送れませんでした</span>'
                   : m.sending ? '<span class="talk-sending">送信中…</span>' : '';
    return `${sep}<div class="talk-bubble ${isMe?'me':'them'}${m.sending?' sending':''}" data-mid="${m.id}">
      ${replyRefHtml(m)}
      <div class="bbl">${m.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>
      <div class="ts">${m.senderName||( isMe?'きよかわ':activeTalkPanelSupplier)}　${time}${sendMark}${msgMarks(m)}</div>
      ${reactionsHtml(m,isMe)}
    </div>`;
  }).join('');

  chatWatchScroll(el);

  // 画面に出ていないとき（別のページを見ている間の描き直しなど）は、
  // 高さが取れないので位置をいじらない
  if(!el.clientHeight){ chatKeepBottomOnLoad(el); return; }

  // いちばん下を見ていたとき、または送信直後だけ下まで送る。
  // それ以外は読んでいた位置に戻す（勝手に下へ飛ばない）
  if(forceBottom===true || wasAtBottom){
    _chatStick = true;
    el.scrollTop=el.scrollHeight;
    updateChatNewMark(false);
  } else {
    _chatStick = false;
    el.scrollTop=prevTop;
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
      renderTalkPanelMessages(true);
    })
    .catch(()=>{
      // 送れなかったときは仮の1件に印を付けて残す（消えると何が送れなかったか分からなくなる）
      temp.sending = false; temp.failed = true;
      renderTalkPanelMessages(true);
    });
}

async function sendTalkPanelFile(fileInput){
  const file=fileInput.files[0];
  fileInput.value='';
  if(!file||!activeTalkPanelSupplier) return;
  const role = (activeTalkPanelSupplier===INTERNAL_THREAD || currentUserRole!=='supplier') ? 'me' : 'them';
  showToast('アップロード中…', 30000);
  try{
    // 写真は長辺1600pxのJPEGにしてから送る。
    //   ・そのままだと1枚が数MBあり、電波が弱いと送れないことがある
    //   ・iPhoneのHEICもJPEGになるので、パソコンやAndroidでも開ける
    let body = file, name = file.name || '写真', mime = file.type || '';
    if(mime.startsWith('image/') && typeof gbCompressImage==='function'){
      const blob = await gbCompressImage(file);
      if(blob && blob !== file && blob.size){
        body = blob;
        mime = blob.type || 'image/jpeg';
        name = name.replace(/\.[^.]+$/,'') + '.jpg';
      }
    }
    const fileUrl = await dbUploadChatFile(body, name, mime);
    await dbAddChatMessage(activeTalkPanelSupplier,{role,type:'file',fileUrl,fileName:name,fileMime:mime});
    showToast('送信しました');
    renderTalkPanelMessages(true);   // 自分が送ったので、いちばん下まで送る
  }catch(e){
    // 理由が出ていない落ち方（画像の変換に失敗したときなど）もここで知らせる
    if(!e || !e.friendly) showToast('送れませんでした：'+((e&&e.message)||e||'原因不明'));
  }
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
