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
  // 未読クリア
  (talkThreads[supName]||[]).forEach(m=>m.unread=false);
  document.getElementById('nav-talk-dot').style.display='none';
  renderTalkPanelMessages();
  setTimeout(()=>document.getElementById('talk-panel-input').focus(),200);
}

function closeTalkPanelThread(){
  activeTalkPanelSupplier=null;
  document.getElementById('talk-panel-list').style.display='flex';
  document.getElementById('talk-panel-detail').style.display='none';
  renderTalkPanelList();
}

function renderTalkPanelMessages(){
  const internalThread = activeTalkPanelSupplier===INTERNAL_THREAD;
  const msgs=talkThreads[activeTalkPanelSupplier]||[];
  const el=document.getElementById('talk-panel-messages');
  if(!msgs.length){
    el.innerHTML = internalThread
      ? '<div class="empty" style="padding:24px">まだメッセージがありません。<br>社員メンバーへの連絡・共有に使えます。</div>'
      : '<div class="empty" style="padding:24px">まだメッセージがありません。<br>発注確定するとここに発注書が届きます。</div>';
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
      return `${sep}<div class="talk-bubble me">
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
        <div class="ts">${time}<button onclick="deleteTalkMessage(${m.id})" title="削除" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:11px;margin-left:6px;padding:0">🗑</button></div>
        ${reactionsHtml(m,true)}
      </div>`;
    }
    // 社内チャットは送信者名で自分／他人を判定（全員が社員のためroleでは区別できない）
    const isMe = internalThread ? m.senderName===currentUserDisplayName : m.role==='me';
    if(m.type==='file'){
      const isImage=(m.fileMime||'').startsWith('image/');
      return `${sep}<div class="talk-bubble ${isMe?'me':'them'}">
        ${isImage
          ? `<a href="${m.fileUrl}" target="_blank" rel="noopener"><img src="${m.fileUrl}" alt="${esc(m.fileName||'')}" style="max-width:200px;max-height:200px;border-radius:8px;display:block"></a>`
          : `<a href="${m.fileUrl}" target="_blank" rel="noopener" download class="bbl" style="display:flex;align-items:center;gap:6px;text-decoration:none;color:inherit">
              <span style="font-size:18px">📄</span><span style="word-break:break-all">${esc(m.fileName||'資料')}</span>
            </a>`}
        <div class="ts">${m.senderName||( isMe?'きよかわ':activeTalkPanelSupplier)}　${time}<button onclick="deleteTalkMessage(${m.id})" title="削除" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:11px;margin-left:6px;padding:0">🗑</button></div>
        ${reactionsHtml(m,isMe)}
      </div>`;
    }
    return `${sep}<div class="talk-bubble ${isMe?'me':'them'}">
      <div class="bbl">${m.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>
      <div class="ts">${m.senderName||( isMe?'きよかわ':activeTalkPanelSupplier)}　${time}<button onclick="deleteTalkMessage(${m.id})" title="削除" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:11px;margin-left:6px;padding:0">🗑</button></div>
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
  const role = (activeTalkPanelSupplier===INTERNAL_THREAD || currentUserRole!=='supplier') ? 'me' : 'them';
  input.value='';
  dbAddChatMessage(activeTalkPanelSupplier,{role,type:'text',text})
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
