// ════ チャットのリアクション（スタンプ） ════
const REACTION_PALETTE = ['👍','👏','🙏','ありがとうございます','お大事に','お疲れ様です','お願いします','おめでとうございます','ご安全に','承知しました','済','了解です'];
let reactingMsgId = null;

// メッセージ下のリアクション表示（他人の投稿には追加ボタンも出す）
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
  const internalThread = activeTalkPanelSupplier===INTERNAL_THREAD;
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

// ════ やり取りパネル制御 ════

function toggleTalkPanel(){
  talkPanelOpen = !talkPanelOpen;
  document.getElementById('ai-chat-panel').classList.toggle('open', talkPanelOpen);
  document.getElementById('nav-talk').classList.toggle('active', talkPanelOpen);
  if(talkPanelOpen){
    closeTalkPanelThread(); // 一覧から開く
    renderTalkPanelList();
  }
}

function renderTalkPanelList(){
  document.getElementById('talk-panel-list').style.display='flex';
  document.getElementById('talk-panel-detail').style.display='none';
  // 社内チャット（きよかわ社員のみ）を先頭に固定。発注先スレッドはstaffのみ／supplierは自社のみ
  const isEmployee = currentUserRole==='staff' || currentUserRole==='carpenter';
  const supNames=[...new Set([...suppliers.map(s=>s.name),...Object.keys(talkThreads)])].filter(n=>n!==INTERNAL_THREAD);
  const allSups=[...(isEmployee?[INTERNAL_THREAD]:[]), ...supNames];
  const el=document.getElementById('talk-panel-thread-list');
  if(!allSups.length){el.innerHTML='<div class="empty">発注先が登録されていません</div>';return;}
  el.innerHTML=allSups.map(name=>{
    const isInternal=name===INTERNAL_THREAD;
    const msgs=talkThreads[name]||[];
    const last=msgs[msgs.length-1];
    const preview=last?(last.type==='order'?'📋 発注書 '+last.orderData.no:last.type==='file'?'📎 '+last.fileName:last.text):(isInternal?'社員メンバーの連絡用':'タップしてトークを開始');
    const sup=suppliers.find(s=>s.name===name);
    const unread=msgs.filter(m=>m.unread).length;
    return `<div class="sup-thread-row" onclick="openTalkPanelThread('${name.replace(/'/g,"\\'")}')">
      <div class="sup-thread-icon">${isInternal?'🏡':'🏪'}</div>
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
  if(!talkThreads[supName]) talkThreads[supName]=[];
  const sup=suppliers.find(s=>s.name===supName);
  document.getElementById('talk-panel-title').textContent=supName;
  document.getElementById('talk-panel-meta').textContent=
    supName===INTERNAL_THREAD ? '社員メンバーのみ表示されます'
    : (sup?.tel?'📞 '+sup.tel+(sup.email?' · ✉ '+sup.email:''):'');
  document.getElementById('talk-panel-list').style.display='none';
  document.getElementById('talk-panel-detail').style.display='flex';
  // 未読クリア＋引用/編集状態をリセット
  (talkThreads[supName]||[]).forEach(m=>m.unread=false);
  document.getElementById('nav-talk-dot').style.display='none';
  cancelQuote(); cancelEditMsg();
  setupMsgMenuHandlers();
  renderTalkPanelMessages();
  dbMarkThreadRead(threadKeyOf(supName)).catch(()=>{}); // 開いた時刻を既読として記録
  setTimeout(()=>document.getElementById('talk-panel-input').focus(),200);
}

// スレッド名 → 既読管理のキー
function threadKeyOf(name){ return name===INTERNAL_THREAD ? 'internal' : 'supplier:'+(supplierIdByName(name)||'?'); }

function closeTalkPanelThread(){
  activeTalkPanelSupplier=null;
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

function renderTalkPanelMessages(){
  const internalThread = activeTalkPanelSupplier===INTERNAL_THREAD;
  let msgs=talkThreads[activeTalkPanelSupplier]||[];
  if(chatBookmarkFilter) msgs=msgs.filter(m=>Array.isArray(m.bookmarks)&&m.bookmarks.includes(currentUserDisplayName));
  document.getElementById('talk-bm-filter')?.classList.toggle('active',chatBookmarkFilter);
  const el=document.getElementById('talk-panel-messages');
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
      const itemRows=o.items.slice(0,4).map(i=>`<div class="ocb-row"><span>${i.name}×${i.qty}${i.unit}</span><span>¥${fmt(i.price*i.qty)}</span></div>`).join('')
        +(o.items.length>4?`<div style="font-size:11px;color:var(--text-muted);padding:3px 0">他${o.items.length-4}品目…</div>`:'');
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
            <div class="ocb-total">合計 ¥${fmt(o.total)}</div>
          </div>
          <div class="ocb-foot">
            ${o.pdfUrl ? `<button class="btn sm wood" onclick="openPdfViewer('${o.pdfUrl}')" style="flex:1;justify-content:center">
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" width="12" height="12" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              PDFを表示
            </button>` : `<button class="btn sm wood" onclick="downloadOrderPdf(${m.id})" style="flex:1;justify-content:center">
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" width="12" height="12" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              PDF出力
            </button>`}
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
          ? `<a href="${m.fileUrl}" target="_blank" rel="noopener"><img src="${m.fileUrl}" alt="${esc(m.fileName||'')}" style="max-width:200px;max-height:200px;border-radius:8px;display:block"></a>`
          : `<a href="${m.fileUrl}" target="_blank" rel="noopener" download class="bbl" style="display:flex;align-items:center;gap:6px;text-decoration:none;color:inherit">
              <span style="font-size:18px">📄</span><span style="word-break:break-all">${esc(m.fileName||'資料')}</span>
            </a>`}
        <div class="ts">${m.senderName||( isMe?'きよかわ':activeTalkPanelSupplier)}　${time}${msgMarks(m)}</div>
        ${reactionsHtml(m,isMe)}
      </div>`;
    }
    return `${sep}<div class="talk-bubble ${isMe?'me':'them'}" data-mid="${m.id}">
      ${replyRefHtml(m)}
      <div class="bbl">${m.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>
      <div class="ts">${m.senderName||( isMe?'きよかわ':activeTalkPanelSupplier)}　${time}${msgMarks(m)}</div>
      ${reactionsHtml(m,isMe)}
    </div>`;
  }).join('');
  el.scrollTop=el.scrollHeight;
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
    dbEditChatMessage(id,text).then(renderTalkPanelMessages).catch(()=>{});
    return;
  }
  const role = (activeTalkPanelSupplier===INTERNAL_THREAD || currentUserRole!=='supplier') ? 'me' : 'them';
  // 引用（返信元）を添付
  const q = quotingMsg;
  const extra = q ? {replyToId:q.id, replyToSender:q.senderName||(activeTalkPanelSupplier===INTERNAL_THREAD?'':'きよかわ'), replyToText:(q.text||(q.type==='file'?'📎 '+(q.fileName||'ファイル'):q.type==='order'?'📋 発注書':'')).slice(0,80)} : {};
  input.value=''; cancelQuote();
  dbAddChatMessage(activeTalkPanelSupplier,{role,type:'text',text,...extra})
    .then(renderTalkPanelMessages)
    .catch(()=>{});
}

async function sendTalkPanelFile(fileInput){
  const file=fileInput.files[0];
  fileInput.value='';
  if(!file||!activeTalkPanelSupplier) return;
  const role = (activeTalkPanelSupplier===INTERNAL_THREAD || currentUserRole!=='supplier') ? 'me' : 'them';
  showToast('アップロード中…');
  try{
    const fileUrl = await dbUploadChatFile(file);
    await dbAddChatMessage(activeTalkPanelSupplier,{role,type:'file',fileUrl,fileName:file.name,fileMime:file.type});
    renderTalkPanelMessages();
  }catch(e){}
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
  printHtml(`発注書 ${msg.orderData.no}`, buildOrderPdfHtml(msg.orderData));
}
