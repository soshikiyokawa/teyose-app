// ════ 図面共有（PDF・画像のアップロードと一覧） ════

async function onDrawingFiles(input){
  const files = [...(input.files||[])];
  input.value = '';
  if(!files.length) return;
  if(!genbaProjectId){ showToast('先に工事を選択してください'); return; }
  const btn = document.getElementById('drawing-add-btn');
  if(btn) btn.disabled = true;
  try{
    for(let i=0;i<files.length;i++){
      const f = files[i];
      showToast(`アップロード中…（${i+1}/${files.length}）`, 30000);
      const extMatch = f.name.match(/\.[a-zA-Z0-9]+$/);
      const url = await dbUploadSiteFile('drawings', genbaProjectId, f, extMatch?extMatch[0]:'');
      await dbAddDrawing({projectId:genbaProjectId, fileUrl:url, fileName:f.name, fileMime:f.type||''});
    }
    showToast(files.length+'件の図面を登録しました');
  }finally{
    if(btn) btn.disabled = false;
  }
  await refreshGenba();
}

function renderDrawings(){
  const wrap = document.getElementById('drawing-list');
  if(!wrap) return;
  if(!genbaProjectId){
    wrap.innerHTML = '<div class="empty">工事を選択すると図面が表示されます</div>';
    return;
  }
  const list = drawings.filter(d=>d.projectId===genbaProjectId);
  if(!list.length){
    wrap.innerHTML = '<div class="empty">まだ図面がありません。「＋ 図面を追加」から登録できます（PDF・画像）</div>';
    return;
  }
  wrap.innerHTML = list.map(d=>{
    const isPdf = /pdf/i.test(d.fileMime) || /\.pdf$/i.test(d.fileName);
    const canDelete = currentUserRole==='staff' || d.uploadedBy===currentUserId;
    const date = new Date(d.createdAt);
    return `<div class="drawing-row">
      <div class="drawing-icon">${isPdf?'📄':'🖼'}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.fileName)}</div>
        <div style="font-size:10px;color:var(--text-muted)">${date.getMonth()+1}/${date.getDate()}${d.uploaderName?'　'+esc(d.uploaderName):''}</div>
      </div>
      <a class="btn xs" href="${esc(d.fileUrl)}" target="_blank" rel="noopener">開く</a>
      ${canDelete?`<button class="btn xs danger" onclick="deleteDrawing(${d.id})">削除</button>`:''}
    </div>`;
  }).join('');
}

async function deleteDrawing(id){
  const d = drawings.find(x=>x.id===id);
  if(!d) return;
  if(!confirm(`「${d.fileName}」を削除しますか？`)) return;
  await dbDeleteDrawing(id);
  showToast('図面を削除しました');
  await refreshGenba();
}
