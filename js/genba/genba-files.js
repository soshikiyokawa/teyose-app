// ════ ファイルブラウザ（現場写真・図面をフォルダで階層整理して表示） ════
// staff：案件情報のボタンからモーダルで開く／carpenter：現場ページのタブ内に直接表示

// ── 開閉・マウント ──
function openFileBrowser(kind, projectId){
  if(!projectId){ showToast('先に案件を選択してください'); return; }
  fbKind = kind; fbProjectId = projectId; fbFolderId = null; fbContainerId = 'fb-modal-body';
  const p = projects.find(x=>x.id===projectId);
  document.getElementById('fb-modal-title').textContent = kind==='photo' ? '現場写真' : '図面';
  document.getElementById('fb-modal-proj').textContent = p ? p.name : '';
  document.getElementById('fb-modal').classList.add('open');
  renderFB();
}
function closeFileBrowser(){
  document.getElementById('fb-modal').classList.remove('open');
  if(fbContainerId==='fb-modal-body'){ fbKind=null; fbProjectId=null; fbFolderId=null; fbContainerId=null; }
}

// 現場ページ（大工）のタブ内に表示。同じ工事・種類なら開いていたフォルダを維持する
function mountGenbaFB(kind){
  const containerId = kind==='photo' ? 'genba-fb-photos' : 'genba-fb-drawings';
  if(!(fbKind===kind && fbProjectId===genbaProjectId && fbContainerId===containerId)) fbFolderId = null;
  fbKind = kind; fbProjectId = genbaProjectId; fbContainerId = containerId;
  renderFB();
}

// 表示中のブラウザを再描画（保存後・Realtime反映用）
function refreshFB(){
  if(!fbKind || !fbContainerId) return;
  if(fbContainerId==='fb-modal-body' && !document.getElementById('fb-modal')?.classList.contains('open')) return;
  if(fbFolderId && !siteFolders.find(f=>f.id===fbFolderId)) fbFolderId = null; // 表示中フォルダが消された
  renderFB();
}

function fbEnter(folderId){ fbFolderId = folderId; renderFB(); }

// ── フォルダユーティリティ ──
function fbCrumbs(){
  const crumbs = [];
  let f = siteFolders.find(x=>x.id===fbFolderId);
  while(f){ crumbs.unshift(f); f = siteFolders.find(x=>x.id===f.parentId); }
  return crumbs;
}
// フォルダ内（下層含む）のファイル数
function fbCountItems(folderId){
  const items = fbKind==='photo' ? sitePhotos : drawings;
  let n = items.filter(i=>i.folderId===folderId).length;
  siteFolders.filter(f=>f.parentId===folderId).forEach(f=>{ n += fbCountItems(f.id); });
  return n;
}

// ── 描画 ──
function renderFB(){
  const wrap = document.getElementById(fbContainerId);
  if(!wrap) return;
  if(!fbProjectId){ wrap.innerHTML = '<div class="empty">工事を選択してください</div>'; return; }

  const crumbs = fbCrumbs();
  const folders = siteFolders.filter(f=>f.projectId===fbProjectId && f.kind===fbKind && (f.parentId||null)===(fbFolderId||null));
  const addLabel = fbKind==='photo' ? '＋ 写真' : '＋ 図面';
  const inputId = fbKind==='photo' ? 'fb-photo-input' : 'fb-drawing-input';

  let html = `
    <div class="fb-toolbar">
      <div class="fb-crumbs">
        <a onclick="fbEnter(null)" class="${fbFolderId?'':'current'}">📂 すべて</a>
        ${crumbs.map((c,i)=>`<span class="sep">›</span><a onclick="fbEnter(${c.id})" class="${i===crumbs.length-1?'current':''}">${esc(c.name)}</a>`).join('')}
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn xs" onclick="fbNewFolder()">＋ フォルダ</button>
        <button class="btn xs primary" id="fb-add-btn" onclick="document.getElementById('${inputId}').click()">${addLabel}</button>
      </div>
    </div>`;

  // フォルダ一覧
  if(folders.length){
    html += `<div class="card" style="padding:0;overflow:hidden;margin-bottom:10px">` + folders.map(f=>{
      const canEdit = currentUserRole==='staff' || f.createdBy===currentUserId;
      const n = fbCountItems(f.id);
      return `<div class="fb-folder-row">
        <div style="flex:1;min-width:0;display:flex;align-items:center;gap:9px;cursor:pointer" onclick="fbEnter(${f.id})">
          <span style="font-size:17px">📁</span>
          <span style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span>
          <span style="font-size:11px;color:var(--text-muted)">${n?n+(fbKind==='photo'?'枚':'件'):''}</span>
        </div>
        ${canEdit?`
        <button class="btn xs" onclick="fbRenameFolder(${f.id})" title="名前を変更">✏</button>
        <button class="btn xs danger" onclick="fbDeleteFolder(${f.id})" title="フォルダを削除">🗑</button>`:''}
      </div>`;
    }).join('') + `</div>`;
  }

  // ファイル一覧（現在のフォルダ直下）
  html += fbKind==='photo' ? fbPhotoGridHtml() : fbDrawingListHtml();
  wrap.innerHTML = html;
}

// ── フォルダ操作 ──
async function fbNewFolder(){
  const name = (prompt('フォルダ名を入力してください\n（例：着工前、基礎、上棟、完成）')||'').trim();
  if(!name) return;
  await dbAddFolder(fbProjectId, fbKind, fbFolderId, name);
  showToast('フォルダを作成しました');
  await refreshGenba();
}
async function fbRenameFolder(id){
  const f = siteFolders.find(x=>x.id===id);
  if(!f) return;
  const name = (prompt('フォルダ名', f.name)||'').trim();
  if(!name || name===f.name) return;
  await dbRenameFolder(id, name);
  await refreshGenba();
}
async function fbDeleteFolder(id){
  const f = siteFolders.find(x=>x.id===id);
  if(!f) return;
  const n = fbCountItems(id);
  if(!confirm(`フォルダ「${f.name}」を削除しますか？\n${n?`中の${fbKind==='photo'?'写真':'図面'}${n}${fbKind==='photo'?'枚':'件'}は削除されず「すべて」に戻ります。`:''}`)) return;
  await dbDeleteFolder(id);
  showToast('フォルダを削除しました');
  await refreshGenba();
}

// ── アイテムの移動 ──
function openFbMove(kind, id){
  fbMoving = {kind, id};
  const listEl = document.getElementById('fb-move-list');
  // 同じ工事・同じ種類のフォルダを階層順に並べる
  const rows = [{id:null, name:'📂 すべて（フォルダなし）', depth:0}];
  (function walk(parentId, depth){
    siteFolders.filter(f=>f.projectId===fbProjectId && f.kind===kind && (f.parentId||null)===(parentId||null))
      .forEach(f=>{ rows.push({id:f.id, name:'📁 '+f.name, depth}); walk(f.id, depth+1); });
  })(null, 1);
  const item = kind==='photo' ? sitePhotos.find(p=>p.id===id) : drawings.find(d=>d.id===id);
  listEl.innerHTML = rows.map(r=>`
    <button class="fb-move-row${(item?.folderId||null)===(r.id||null)?' current':''}" style="padding-left:${10+r.depth*18}px" onclick="fbMoveTo(${r.id})">
      ${esc(r.name)}${(item?.folderId||null)===(r.id||null)?'<span style="font-size:10px;color:var(--text-muted)">　現在の場所</span>':''}
    </button>`).join('');
  document.getElementById('fb-move-modal').classList.add('open');
}
function closeFbMove(){
  document.getElementById('fb-move-modal').classList.remove('open');
  fbMoving = null;
}
async function fbMoveTo(folderId){
  if(!fbMoving) return;
  await dbMoveItem(fbMoving.kind, fbMoving.id, folderId);
  closeFbMove();
  showToast('移動しました');
  await refreshGenba();
}

// ── 案件情報タブのボタン（件数表示） ──
function renderInfoGenbaSections(){
  const pc = document.getElementById('info-photo-count');
  if(!pc) return;
  const pid = selectedProject?.id || null;
  pc.textContent = pid ? sitePhotos.filter(p=>p.projectId===pid).length+'枚' : '—';
  document.getElementById('info-drawing-count').textContent = pid ? drawings.filter(d=>d.projectId===pid).length+'件' : '—';
}
function openInfoFileBrowser(kind){
  openFileBrowser(kind, selectedProject?.id || null);
}
