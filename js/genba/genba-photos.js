// ════ 現場写真（アップロード・フォルダ内グリッド・ビューア） ════

// 画像を長辺1600pxのJPEGに圧縮してから上げる（通信量とストレージの節約）
async function gbCompressImage(file){
  try{
    let bmp;
    try{
      bmp = await createImageBitmap(file);
    }catch(_){
      // createImageBitmapが失敗した場合（古い端末など）はImage経由でデコード
      bmp = await new Promise((res,rej)=>{
        const img = new Image();
        img.onload = ()=>res(img);
        img.onerror = rej;
        img.src = URL.createObjectURL(file);
      });
    }
    const w = bmp.width||bmp.naturalWidth, h = bmp.height||bmp.naturalHeight;
    const scale = Math.min(1, 1600/Math.max(w,h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w*scale); canvas.height = Math.round(h*scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(res=>canvas.toBlob(res,'image/jpeg',0.85));
    return blob || file;
  }catch(e){
    return file; // 圧縮できない形式はそのままアップロード
  }
}

// ファイルブラウザの「＋ 写真」から。表示中のフォルダに登録される
async function onFbPhotoInput(input){
  const files = [...(input.files||[])];
  input.value = '';
  if(!files.length) return;
  if(!fbProjectId){ showToast('先に工事（案件）を選択してください'); return; }
  const projectId = fbProjectId, folderId = fbFolderId;
  const btn = document.getElementById('fb-add-btn');
  if(btn) btn.disabled = true;
  try{
    for(let i=0;i<files.length;i++){
      showToast(`アップロード中…（${i+1}/${files.length}）`, 30000);
      const blob = await gbCompressImage(files[i]);
      const url = await dbUploadSiteFile('photos', projectId, blob, '.jpg');
      await dbAddSitePhoto({projectId, folderId, url, caption:'', shotDate:gbToday()});
    }
    showToast(files.length+'枚の写真を登録しました');
  }finally{
    if(btn) btn.disabled = false;
  }
  await refreshGenba();
}

// ── 複数選択（一括で移動・削除） ──
let photoSelectMode = false;
let selectedPhotoIds = new Set();

function togglePhotoSelectMode(){
  photoSelectMode = !photoSelectMode;
  selectedPhotoIds.clear();
  refreshFB();
}
function togglePhotoSelect(id){
  if(selectedPhotoIds.has(id)) selectedPhotoIds.delete(id);
  else selectedPhotoIds.add(id);
  refreshFB();
}
function selectAllPhotos(){
  const ids = _currentPhotoList();
  const allSelected = ids.length && ids.every(id=>selectedPhotoIds.has(id));
  selectedPhotoIds = allSelected ? new Set() : new Set(ids);
  refreshFB();
}

// 選択した写真をまとめてフォルダ移動
function openBulkMovePhotos(){
  if(!selectedPhotoIds.size){ showToast('写真を選択してください'); return; }
  fbMoving = {kind:'photo', bulk:[...selectedPhotoIds]};
  const listEl = document.getElementById('fb-move-list');
  const rows = [{id:null, name:'📂 すべて（フォルダなし）', depth:0}];
  (function walk(parentId, depth){
    siteFolders.filter(f=>f.projectId===fbProjectId && f.kind==='photo' && (f.parentId||null)===(parentId||null))
      .forEach(f=>{ rows.push({id:f.id, name:'📁 '+f.name, depth}); walk(f.id, depth+1); });
  })(null, 1);
  listEl.innerHTML = `<div style="font-size:11px;color:var(--text-muted);padding:4px 10px">選択中の${selectedPhotoIds.size}枚を移動します</div>`
    + rows.map(r=>`<button class="fb-move-row" style="padding-left:${10+r.depth*18}px" onclick="fbMoveTo(${r.id})">${esc(r.name)}</button>`).join('');
  document.getElementById('fb-move-modal').classList.add('open');
}

// 選択した写真をまとめて削除
async function bulkDeletePhotos(){
  const ids = [...selectedPhotoIds];
  if(!ids.length){ showToast('写真を選択してください'); return; }
  if(!confirm(`選択した${ids.length}枚の写真を削除しますか？\nこの操作は元に戻せません。`)) return;
  for(const id of ids){
    try{ await dbDeleteSitePhoto(id); }catch(e){ return; }
  }
  selectedPhotoIds.clear();
  photoSelectMode = false;
  showToast(`${ids.length}枚を削除しました`);
  await refreshGenba();
}

// 表示中フォルダ直下の写真グリッド（撮影日ごとにグループ表示）
function fbPhotoGridHtml(){
  const list = sitePhotos.filter(p=>p.projectId===fbProjectId && (p.folderId||null)===(fbFolderId||null));
  if(!list.length) return '<div class="empty">このフォルダに写真はありません。「＋ 写真」から登録できます</div>';

  // 選択モードの操作バー
  const bar = photoSelectMode
    ? `<div class="photo-sel-bar">
        <button class="btn xs" onclick="selectAllPhotos()">全選択/解除</button>
        <span style="flex:1;font-size:12px;font-weight:700;color:var(--accent-t)">${selectedPhotoIds.size}枚を選択中</span>
        <button class="btn xs" onclick="openBulkMovePhotos()" ${selectedPhotoIds.size?'':'disabled'}>移動</button>
        <button class="btn xs danger" onclick="bulkDeletePhotos()" ${selectedPhotoIds.size?'':'disabled'}>削除</button>
        <button class="btn xs" onclick="togglePhotoSelectMode()">終了</button>
      </div>`
    : `<div class="photo-sel-bar"><span style="flex:1;font-size:11px;color:var(--text-muted)">タップで拡大表示</span>
        <button class="btn xs" onclick="togglePhotoSelectMode()">選択</button></div>`;

  const byDate = {};
  list.forEach(p=>{ (byDate[p.shotDate] = byDate[p.shotDate]||[]).push(p); });
  return bar + Object.keys(byDate).sort().reverse().map(date=>`
    <div class="photo-date-lbl">${gbDateLabel(date)}<span style="font-weight:400;color:var(--text-muted)">　${byDate[date].length}枚</span></div>
    <div class="photo-grid">
      ${byDate[date].map(p=>{
        const sel = selectedPhotoIds.has(p.id);
        const onClick = photoSelectMode ? `togglePhotoSelect(${p.id})` : `openPhotoViewer(${p.id})`;
        return `<div class="photo-cell${sel?' photo-selected':''}" onclick="${onClick}">
          <img src="${esc(p.url)}" loading="lazy" alt="">
          ${photoSelectMode ? `<div class="photo-check">${sel?'✓':''}</div>` : ''}
          ${p.caption ? `<div class="photo-cap">${esc(p.caption)}</div>` : ''}
        </div>`;
      }).join('')}
    </div>`).join('');
}

// ── ビューア（スワイプ・矢印で前後の写真へ送れる） ──
let _viewerList = [];   // 表示中フォルダの写真ID一覧（グリッドと同じ並び）

// 今開いているフォルダの写真を、画面と同じ順（撮影日の新しい順→同日内は表示順）で返す
function _currentPhotoList(){
  const list = sitePhotos.filter(p=>p.projectId===fbProjectId && (p.folderId||null)===(fbFolderId||null));
  const byDate = {};
  list.forEach(p=>{ (byDate[p.shotDate] = byDate[p.shotDate]||[]).push(p); });
  return Object.keys(byDate).sort().reverse().flatMap(d=>byDate[d]).map(p=>p.id);
}

function openPhotoViewer(id){
  const p = sitePhotos.find(x=>x.id===id);
  if(!p) return;
  _viewerList = _currentPhotoList();
  if(!_viewerList.includes(id)) _viewerList = [id];
  _showPhotoInViewer(id);
  document.getElementById('photo-viewer').classList.add('open');
}

function _showPhotoInViewer(id){
  const p = sitePhotos.find(x=>x.id===id);
  if(!p) return;
  viewingPhotoId = id;
  document.getElementById('photo-viewer-img').src = p.url;
  const idx = _viewerList.indexOf(id);
  const counter = _viewerList.length>1 ? `　（${idx+1}/${_viewerList.length}）` : '';
  document.getElementById('photo-viewer-meta').textContent =
    gbDateLabel(p.shotDate) + (p.uploaderName ? '　'+p.uploaderName : '') + counter;
  document.getElementById('photo-viewer-caption').value = p.caption||'';
  const canDelete = currentUserRole==='staff' || p.uploadedBy===currentUserId;
  document.getElementById('photo-viewer-delete').style.display = canDelete ? '' : 'none';
  // 前後ボタンの表示（1枚だけなら隠す）
  const multi = _viewerList.length>1;
  const prev=document.getElementById('photo-viewer-prev'), next=document.getElementById('photo-viewer-next');
  if(prev) prev.style.display = multi ? '' : 'none';
  if(next) next.style.display = multi ? '' : 'none';
}

// step: -1=前へ / +1=次へ（端で止まる）
function stepPhoto(step){
  if(_viewerList.length<2) return;
  const i = _viewerList.indexOf(viewingPhotoId);
  const ni = i + step;
  if(i<0 || ni<0 || ni>=_viewerList.length) return;
  _showPhotoInViewer(_viewerList[ni]);
}

function closePhotoViewer(){
  document.getElementById('photo-viewer').classList.remove('open');
  document.getElementById('photo-viewer-img').src = '';
  viewingPhotoId = null;
  _viewerList = [];
}

// スワイプ（横）とキーボード（←→・Esc）で送る
(function initPhotoViewerNav(){
  document.addEventListener('DOMContentLoaded', ()=>{
    const wrap = document.getElementById('photo-viewer-img-wrap');
    if(wrap){
      let sx=0, sy=0, moved=false;
      wrap.addEventListener('touchstart', e=>{ const t=e.changedTouches[0]; sx=t.clientX; sy=t.clientY; moved=false; }, {passive:true});
      wrap.addEventListener('touchmove', ()=>{ moved=true; }, {passive:true});
      wrap.addEventListener('touchend', e=>{
        if(!moved) return;
        const t=e.changedTouches[0], dx=t.clientX-sx, dy=t.clientY-sy;
        if(Math.abs(dx)>50 && Math.abs(dx)>Math.abs(dy)) stepPhoto(dx<0 ? 1 : -1); // 左スワイプ＝次へ
      }, {passive:true});
    }
    document.addEventListener('keydown', e=>{
      if(!document.getElementById('photo-viewer')?.classList.contains('open')) return;
      if(e.key==='ArrowRight') stepPhoto(1);
      else if(e.key==='ArrowLeft') stepPhoto(-1);
      else if(e.key==='Escape') closePhotoViewer();
    });
  });
})();
async function savePhotoCaption(){
  const p = sitePhotos.find(x=>x.id===viewingPhotoId);
  if(!p) return;
  const caption = document.getElementById('photo-viewer-caption').value.trim();
  if(caption===p.caption) return;
  await dbUpdateSitePhotoCaption(p.id, caption);
  p.caption = caption;
  refreshFB();
  showToast('メモを保存しました');
}
function moveViewingPhoto(){
  const id = viewingPhotoId;
  if(id==null) return;
  closePhotoViewer();
  openFbMove('photo', id);
}
async function deleteViewingPhoto(){
  if(viewingPhotoId==null) return;
  if(!confirm('この写真を削除しますか？')) return;
  const deletedId = viewingPhotoId;
  await dbDeleteSitePhoto(deletedId);
  // 削除後は同じフォルダの次（無ければ前）の写真へ。最後の1枚なら閉じる
  const i = _viewerList.indexOf(deletedId);
  _viewerList = _viewerList.filter(x=>x!==deletedId);
  sitePhotos = sitePhotos.filter(p=>p.id!==deletedId);
  if(_viewerList.length){
    _showPhotoInViewer(_viewerList[Math.min(i, _viewerList.length-1)]);
  } else {
    closePhotoViewer();
  }
  showToast('写真を削除しました');
  await refreshGenba();
}
