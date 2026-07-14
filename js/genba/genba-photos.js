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

// 表示中フォルダ直下の写真グリッド（撮影日ごとにグループ表示）
function fbPhotoGridHtml(){
  const list = sitePhotos.filter(p=>p.projectId===fbProjectId && (p.folderId||null)===(fbFolderId||null));
  if(!list.length) return '<div class="empty">このフォルダに写真はありません。「＋ 写真」から登録できます</div>';
  const byDate = {};
  list.forEach(p=>{ (byDate[p.shotDate] = byDate[p.shotDate]||[]).push(p); });
  return Object.keys(byDate).sort().reverse().map(date=>`
    <div class="photo-date-lbl">${gbDateLabel(date)}<span style="font-weight:400;color:var(--text-muted)">　${byDate[date].length}枚</span></div>
    <div class="photo-grid">
      ${byDate[date].map(p=>`
        <div class="photo-cell" onclick="openPhotoViewer(${p.id})">
          <img src="${esc(p.url)}" loading="lazy" alt="">
          ${p.caption ? `<div class="photo-cap">${esc(p.caption)}</div>` : ''}
        </div>`).join('')}
    </div>`).join('');
}

// ── ビューア ──
function openPhotoViewer(id){
  const p = sitePhotos.find(x=>x.id===id);
  if(!p) return;
  viewingPhotoId = id;
  document.getElementById('photo-viewer-img').src = p.url;
  document.getElementById('photo-viewer-meta').textContent =
    gbDateLabel(p.shotDate) + (p.uploaderName ? '　'+p.uploaderName : '');
  document.getElementById('photo-viewer-caption').value = p.caption||'';
  const canDelete = currentUserRole==='staff' || p.uploadedBy===currentUserId;
  document.getElementById('photo-viewer-delete').style.display = canDelete ? '' : 'none';
  document.getElementById('photo-viewer').classList.add('open');
}
function closePhotoViewer(){
  document.getElementById('photo-viewer').classList.remove('open');
  document.getElementById('photo-viewer-img').src = '';
  viewingPhotoId = null;
}
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
  await dbDeleteSitePhoto(viewingPhotoId);
  closePhotoViewer();
  showToast('写真を削除しました');
  await refreshGenba();
}
