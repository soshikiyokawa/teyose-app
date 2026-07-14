// ════ 図面共有（PDF・画像のアップロードと一覧） ════

// 現場ページ・案件情報タブ共通のアップロード処理
async function uploadDrawings(input, projectId, btnId){
  const files = [...(input.files||[])];
  input.value = '';
  if(!files.length) return;
  if(!projectId){ showToast('先に工事（案件）を選択してください'); return; }
  const btn = document.getElementById(btnId);
  if(btn) btn.disabled = true;
  try{
    for(let i=0;i<files.length;i++){
      const f = files[i];
      showToast(`アップロード中…（${i+1}/${files.length}）`, 30000);
      const extMatch = f.name.match(/\.[a-zA-Z0-9]+$/);
      const url = await dbUploadSiteFile('drawings', projectId, f, extMatch?extMatch[0]:'');
      await dbAddDrawing({projectId, fileUrl:url, fileName:f.name, fileMime:f.type||''});
    }
    showToast(files.length+'件の図面を登録しました');
  }finally{
    if(btn) btn.disabled = false;
  }
  await refreshGenba();
}
function onDrawingFiles(input){ uploadDrawings(input, genbaProjectId, 'drawing-add-btn'); }
function onInfoDrawingFiles(input){ uploadDrawings(input, selectedProject?.id, 'info-drawing-add-btn'); }

function renderDrawings(){
  renderDrawingListInto('drawing-list', genbaProjectId, '工事を選択すると図面が表示されます');
}
function renderDrawingListInto(containerId, projectId, noProjectMsg){
  const wrap = document.getElementById(containerId);
  if(!wrap) return;
  if(!projectId){
    wrap.innerHTML = `<div class="empty">${noProjectMsg}</div>`;
    return;
  }
  const list = drawings.filter(d=>d.projectId===projectId);
  if(!list.length){
    wrap.innerHTML = '<div class="empty">まだ図面がありません。「＋ 図面」から登録できます（PDF・画像）</div>';
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
