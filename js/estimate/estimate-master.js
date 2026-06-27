// ════ 見積：工種マスタ・工事品目マスタ（ドラッグ並び替え対応） ════

// ── 工種マスタ ──
function renderEstCategoryMaster(){
  const saveBtn=document.getElementById('estcat-order-save-btn');
  if(saveBtn) saveBtn.style.cssText = estCatDirty
    ? 'display:inline-flex;background:var(--wood);border-color:var(--wood)'
    : 'display:none';

  const el=document.getElementById('estcat-master-list');
  if(!estimateCategories.length){el.innerHTML='<div class="empty">工種が登録されていません</div>';return;}
  el.innerHTML='';
  estimateCategories.forEach(c=>{
    const row=document.createElement('div');
    row.className='draggable';
    row.draggable=true;
    row.dataset.id=c.id;
    row.style.cssText='display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:0.5px solid var(--border)';
    row.innerHTML=`
      <div class="drag-handle" title="ドラッグで並び替え">⠿</div>
      <div style="flex:1;font-size:13px;font-weight:700">${esc(c.name)}</div>
      <button style="padding:4px 9px;border-radius:6px;font-size:11px;border:0.5px solid var(--border);background:var(--surface2);cursor:pointer;font-family:inherit;color:var(--text-sub);white-space:nowrap" onclick="openEstCatEdit(${c.id})">編集</button>`;

    row.addEventListener('dragstart', e=>{
      dragSrcEstCatId = c.id;
      setTimeout(()=>row.classList.add('dragging'),0);
      e.dataTransfer.effectAllowed='move';
    });
    row.addEventListener('dragend', ()=>{
      row.classList.remove('dragging');
      document.querySelectorAll('#estcat-master-list .draggable').forEach(r=>r.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', e=>{
      e.preventDefault();
      if(dragSrcEstCatId !== c.id){
        document.querySelectorAll('#estcat-master-list .draggable').forEach(r=>r.classList.remove('drag-over'));
        row.classList.add('drag-over');
      }
    });
    row.addEventListener('dragleave', ()=>row.classList.remove('drag-over'));
    row.addEventListener('drop', e=>{
      e.preventDefault();
      if(dragSrcEstCatId === c.id) return;
      const fromIdx = estimateCategories.findIndex(x=>x.id===dragSrcEstCatId);
      const toIdx   = estimateCategories.findIndex(x=>x.id===c.id);
      if(fromIdx<0||toIdx<0) return;
      const [moved] = estimateCategories.splice(fromIdx,1);
      estimateCategories.splice(toIdx,0,moved);
      estCatDirty = true;
      renderEstCategoryMaster();
    });

    el.appendChild(row);
  });
}

async function saveEstCatOrder(){
  estCatDirty = false;
  try{ await dbReorderEstCategories(estimateCategories); }catch(e){return;}
  renderEstCategoryMaster();
  showToast('並び順を保存しました');
}

function openEstCatEdit(id){
  editingEstCatId=id;
  document.getElementById('estcat-modal-title').textContent=id===-1?'工種を追加':'工種を編集';
  document.getElementById('estcat-name').value = id===-1 ? '' : (estimateCategories.find(x=>x.id===id)?.name||'');
  document.getElementById('estcat-delete-btn').style.display=id===-1?'none':'inline-flex';
  document.getElementById('estcat-modal').classList.add('open');
}
function closeEstCatModal(){document.getElementById('estcat-modal').classList.remove('open');}
async function saveEstCat(){
  const name=document.getElementById('estcat-name').value.trim();
  if(!name){alert('工種名を入力してください');return;}
  try{
    if(editingEstCatId===-1){
      const id=await dbAddEstCategory(name);
      estimateCategories.push({id,name,sortOrder:estimateCategories.length});
    } else {
      await dbUpdateEstCategory(editingEstCatId,name);
      const c=estimateCategories.find(x=>x.id===editingEstCatId);
      if(c) c.name=name;
    }
  }catch(e){return;}
  closeEstCatModal();
  renderEstCategoryMaster();
  renderPresetDatalists();
}
async function deleteEstCat(){
  if(editingEstCatId===null||editingEstCatId===-1) return;
  const c=estimateCategories.find(x=>x.id===editingEstCatId);
  if(!c) return;
  if(!confirm(`「${c.name}」を削除しますか？\nこの工種に登録された工事品目リストはそのまま残ります（工種名のみの削除です）。`)) return;
  try{ await dbDeleteEstCategory(editingEstCatId); }catch(e){return;}
  estimateCategories=estimateCategories.filter(x=>x.id!==editingEstCatId);
  editingEstCatId=null;
  closeEstCatModal();
  renderEstCategoryMaster();
  renderPresetDatalists();
  showToast('工種を削除しました');
}

// ── 工事品目マスタ ──
function buildEstCatOptions(selected=''){
  return estimateCategories.map(c=>`<option${c.name===selected?' selected':''}>${esc(c.name)}</option>`).join('');
}

function renderEstPresetMaster(){
  const catNames=[...new Set(estimatePresets.map(p=>p.cat))];
  if(!activeEstPresetCat || !catNames.includes(activeEstPresetCat)){
    activeEstPresetCat = catNames[0] || null;
  }

  const tabWrap=document.getElementById('estpreset-cat-tabs');
  tabWrap.innerHTML = ['全て',...catNames].map(name=>`
    <button class="cat-pill${(name==='全て'?activeEstPresetCat===null:activeEstPresetCat===name)?' active':''}"
      onclick="setEstPresetCat(${name==='全て'?'null':`'${name}'`})">${esc(name)}</button>`
  ).join('');

  const saveBtn=document.getElementById('estpreset-order-save-btn');
  if(saveBtn) saveBtn.style.cssText = estPresetDirty
    ? 'display:inline-flex;background:var(--wood);border-color:var(--wood)'
    : 'display:none';

  const items = activeEstPresetCat
    ? estimatePresets.filter(p=>p.cat===activeEstPresetCat)
    : estimatePresets;

  const el=document.getElementById('estpreset-master-list');
  el.innerHTML='';
  if(!items.length){el.innerHTML='<div class="empty">工事品目がありません</div>';return;}

  items.forEach(p=>{
    const row=document.createElement('div');
    row.className='draggable';
    row.draggable=true;
    row.dataset.id=p.id;
    row.style.cssText='display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:0.5px solid var(--border)';
    row.innerHTML=`
      <div class="drag-handle" title="ドラッグで並び替え">⠿</div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700">${esc(p.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(p.cat)}　単位：${esc(p.unit)}　原価：¥${fmt(p.cost)}</div>
      </div>
      <button style="padding:4px 9px;border-radius:6px;font-size:11px;border:0.5px solid var(--border);background:var(--surface2);cursor:pointer;font-family:inherit;color:var(--text-sub);white-space:nowrap" onclick="openEstPresetEdit(${p.id})">編集</button>`;

    row.addEventListener('dragstart', e=>{
      dragSrcEstPresetId = p.id;
      setTimeout(()=>row.classList.add('dragging'),0);
      e.dataTransfer.effectAllowed='move';
    });
    row.addEventListener('dragend', ()=>{
      row.classList.remove('dragging');
      document.querySelectorAll('#estpreset-master-list .draggable').forEach(r=>r.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', e=>{
      e.preventDefault();
      if(dragSrcEstPresetId !== p.id){
        document.querySelectorAll('#estpreset-master-list .draggable').forEach(r=>r.classList.remove('drag-over'));
        row.classList.add('drag-over');
      }
    });
    row.addEventListener('dragleave', ()=>row.classList.remove('drag-over'));
    row.addEventListener('drop', e=>{
      e.preventDefault();
      if(dragSrcEstPresetId === p.id) return;
      const fromIdx = estimatePresets.findIndex(x=>x.id===dragSrcEstPresetId);
      const toIdx   = estimatePresets.findIndex(x=>x.id===p.id);
      if(fromIdx<0||toIdx<0) return;
      const [moved] = estimatePresets.splice(fromIdx,1);
      estimatePresets.splice(toIdx,0,moved);
      estPresetDirty = true;
      renderEstPresetMaster();
    });

    el.appendChild(row);
  });
}

function setEstPresetCat(name){
  activeEstPresetCat = name;
  renderEstPresetMaster();
}

async function saveEstPresetOrder(){
  estPresetDirty = false;
  try{ await dbReorderEstPresets(estimatePresets); }catch(e){return;}
  renderEstPresetMaster();
  showToast('並び順を保存しました');
}

function openEstPresetEdit(id){
  editingEstPresetId = (id===-1||id==='-1') ? -1 : Number(id);
  document.getElementById('ep-cat-sel').innerHTML=buildEstCatOptions();
  document.getElementById('estpreset-modal-title').textContent=editingEstPresetId===-1?'工事品目を追加':'工事品目を編集';
  if(editingEstPresetId===-1){
    document.getElementById('ep-name').value='';
    document.getElementById('ep-unit').value='式';
    document.getElementById('ep-cost').value='';
    document.getElementById('ep-cat-sel').value = activeEstPresetCat || (estimateCategories[0]?.name||'');
  } else {
    const p=estimatePresets.find(x=>x.id===editingEstPresetId);
    if(!p)return;
    document.getElementById('ep-name').value=p.name;
    document.getElementById('ep-unit').value=p.unit;
    document.getElementById('ep-cost').value=p.cost;
    document.getElementById('ep-cat-sel').value=p.cat;
  }
  document.getElementById('estpreset-delete-btn').style.display=editingEstPresetId===-1?'none':'inline-flex';
  document.getElementById('estpreset-modal').classList.add('open');
}
function closeEstPresetModal(){document.getElementById('estpreset-modal').classList.remove('open');}
async function saveEstPreset(){
  const item={
    cat: document.getElementById('ep-cat-sel').value,
    name: document.getElementById('ep-name').value.trim(),
    unit: document.getElementById('ep-unit').value.trim()||'式',
    cost: parseInt(document.getElementById('ep-cost').value)||0
  };
  if(!item.name){alert('品目名を入力してください');return;}
  if(!item.cat){alert('先に工種マスタで工種を登録してください');return;}
  try{
    if(editingEstPresetId===-1){
      const id=await dbAddEstPreset(item);
      estimatePresets.push({id,...item,sortOrder:estimatePresets.length});
      activeEstPresetCat = item.cat;
    } else {
      await dbUpdateEstPreset(editingEstPresetId,item);
      const p=estimatePresets.find(x=>x.id===editingEstPresetId);
      if(p) Object.assign(p,item);
      activeEstPresetCat = item.cat;
    }
    closeEstPresetModal();
    renderEstPresetMaster();
    showToast(editingEstPresetId===-1?'工事品目を追加しました':'工事品目を保存しました');
  }catch(e){}
}
async function deleteEstPreset(){
  if(editingEstPresetId===null||editingEstPresetId===-1) return;
  const p=estimatePresets.find(x=>x.id===editingEstPresetId);
  if(!p) return;
  if(!confirm(`「${p.name}」を削除しますか？`)) return;
  try{ await dbDeleteEstPreset(editingEstPresetId); }catch(e){return;}
  estimatePresets=estimatePresets.filter(x=>x.id!==editingEstPresetId);
  editingEstPresetId=null;
  closeEstPresetModal();
  renderEstPresetMaster();
  showToast('工事品目を削除しました');
}
