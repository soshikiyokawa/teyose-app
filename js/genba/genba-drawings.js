// ════ 図面共有（アップロード・フォルダ内一覧・閲覧記録） ════

// ファイルブラウザの「＋ 図面」から。表示中のフォルダに登録される
async function onFbDrawingInput(input){
  const files = [...(input.files||[])];
  input.value = '';
  if(!files.length) return;
  if(!fbProjectId){ showToast('先に工事（案件）を選択してください'); return; }
  const projectId = fbProjectId, folderId = fbFolderId;
  const btn = document.getElementById('fb-add-btn');
  if(btn) btn.disabled = true;
  try{
    for(let i=0;i<files.length;i++){
      const f = files[i];
      showToast(`アップロード中…（${i+1}/${files.length}）`, 30000);
      const extMatch = f.name.match(/\.[a-zA-Z0-9]+$/);
      const url = await dbUploadSiteFile('drawings', projectId, f, extMatch?extMatch[0]:'');
      await dbAddDrawing({projectId, folderId, fileUrl:url, fileName:f.name, fileMime:f.type||''});
    }
    showToast(files.length+'件の図面を登録しました');
  }finally{
    if(btn) btn.disabled = false;
  }
  await refreshGenba();
}

// 閲覧記録のラベル（最新閲覧が先頭。3人まで表示、残りは人数で省略）
function drawingViewsLabel(id){
  const vs = drawingViews.filter(v=>v.drawingId===id);
  if(!vs.length) return '<span style="color:var(--text-muted)">閲覧：まだ誰も開いていません</span>';
  const fmtV = v=>{
    const d = new Date(v.viewedAt);
    return esc(v.userName||'？')+' '+(d.getMonth()+1)+'/'+d.getDate();
  };
  const shown = vs.slice(0,3).map(fmtV).join('・');
  const rest = vs.length>3 ? `　他${vs.length-3}人` : '';
  return `<span style="color:var(--accent-t)">閲覧：${shown}${rest}</span>`;
}

// 表示中フォルダ直下の図面一覧
function fbDrawingListHtml(){
  const list = drawings.filter(d=>d.projectId===fbProjectId && (d.folderId||null)===(fbFolderId||null));
  if(!list.length) return '<div class="empty">このフォルダに図面はありません。「＋ 図面」から登録できます（PDF・画像）</div>';
  return `<div class="card" style="padding:0;overflow:hidden">` + list.map(d=>{
    const isPdf = /pdf/i.test(d.fileMime) || /\.pdf$/i.test(d.fileName);
    const canDelete = currentUserRole==='staff' || d.uploadedBy===currentUserId;
    const date = new Date(d.createdAt);
    return `<div class="drawing-row">
      <div class="drawing-icon">${isPdf?'📄':'🖼'}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.fileName)}</div>
        <div style="font-size:10px;color:var(--text-muted)">${date.getMonth()+1}/${date.getDate()}${d.uploaderName?'　'+esc(d.uploaderName):''}</div>
        <div style="font-size:10px;margin-top:2px">${drawingViewsLabel(d.id)}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
        <button class="btn xs primary" onclick="viewDrawing(${d.id})">開く</button>
        <div style="display:flex;gap:4px">
          <button class="btn xs" onclick="openFbMove('drawing',${d.id})" title="フォルダへ移動">移動</button>
          ${canDelete?`<button class="btn xs danger" onclick="deleteDrawing(${d.id})">削除</button>`:''}
        </div>
      </div>
    </div>`;
  }).join('') + `</div>`;
}

// 図面を開く（閲覧記録を残してから新しいタブで表示）
function viewDrawing(id){
  const d = drawings.find(x=>x.id===id);
  if(!d) return;
  window.open(d.fileUrl, '_blank'); // ポップアップブロック回避のため先に開く
  // 手元の表示を即時更新してからサーバーに記録
  drawingViews = drawingViews.filter(v=>!(v.drawingId===id && v.userId===currentUserId));
  drawingViews.unshift({id:0, drawingId:id, userId:currentUserId, userName:currentUserDisplayName||'', viewedAt:new Date().toISOString()});
  refreshFB();
  dbRecordDrawingView(id);
}

async function deleteDrawing(id){
  const d = drawings.find(x=>x.id===id);
  if(!d) return;
  if(!confirm(`「${d.fileName}」を削除しますか？`)) return;
  await dbDeleteDrawing(id);
  showToast('図面を削除しました');
  await refreshGenba();
}
