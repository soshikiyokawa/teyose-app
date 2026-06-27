// ════ 受発注：品目マスタ（発注先タブ＋カテゴリ別＋ドラッグ並び替え） ════

function renderMaster(){
  const supNames = [...new Set(master.map(m=>m.supplier))];
  if(!activeMasterSupplier || !supNames.includes(activeMasterSupplier)){
    activeMasterSupplier = supNames[0] || null;
  }

  // 発注先タブ
  const tabWrap = document.getElementById('master-supplier-tabs');
  tabWrap.innerHTML = ['全て',...supNames].map(name=>`
    <button class="cat-pill${(name==='全て'?activeMasterSupplier===null:activeMasterSupplier===name)?' active':''}"
      onclick="setMasterSupplier(${name==='全て'?'null':`'${name}'`})">${name}</button>`
  ).join('');

  // 並び保存ボタン
  const saveOrderBtn = document.getElementById('master-order-save-btn');
  if(saveOrderBtn) saveOrderBtn.style.cssText = masterDirty
    ? 'display:inline-flex;background:var(--wood);border-color:var(--wood)'
    : 'display:none';

  const items = activeMasterSupplier
    ? master.filter(m=>m.supplier===activeMasterSupplier)
    : master;

  const el = document.getElementById('master-list');
  el.innerHTML = '';
  if(!items.length){el.innerHTML='<div class="empty">品目がありません</div>';return;}

  const cats = [...new Set(items.map(m=>m.cat))];
  cats.forEach(cat=>{
    const head = document.createElement('div');
    head.className = 'cat-head';
    head.textContent = cat;
    el.appendChild(head);

    items.filter(m=>m.cat===cat).forEach(m=>{
      const {n, s} = splitNameSpec(m.name);
      const row = document.createElement('div');
      row.className = 'master-item draggable';
      row.dataset.id = m.id;
      row.draggable = true;
      row.innerHTML = `
        <div class="drag-handle" title="ドラッグで並び替え">⠿</div>
        <div class="mi-info">
          <div class="mi-row">
            <span class="mi-item-name">${n}</span>
            <span class="mi-spec">${s}</span>
          </div>
          <div class="mi-meta">
            <span>単価 ¥${fmt(m.price)}/${m.unit}</span>
            <span>原価 ¥${fmt(m.cost)}</span>
          </div>
        </div>
        <button class="mi-edit-btn-sm" onclick="duplicateMasterItem(${m.id})" title="この品目を複製して次の品目を追加">複製</button>
        <button class="mi-edit-btn-sm" onclick="openMasterEdit(${m.id})">編集</button>`;

      row.addEventListener('dragstart', e=>{
        dragSrcId = m.id;
        setTimeout(()=>row.classList.add('dragging'),0);
        e.dataTransfer.effectAllowed='move';
      });
      row.addEventListener('dragend', ()=>{
        row.classList.remove('dragging');
        document.querySelectorAll('.master-item').forEach(r=>r.classList.remove('drag-over'));
      });
      row.addEventListener('dragover', e=>{
        e.preventDefault();
        if(dragSrcId !== m.id){
          document.querySelectorAll('.master-item').forEach(r=>r.classList.remove('drag-over'));
          row.classList.add('drag-over');
        }
      });
      row.addEventListener('dragleave', ()=>row.classList.remove('drag-over'));
      row.addEventListener('drop', e=>{
        e.preventDefault();
        if(dragSrcId === m.id) return;
        const fromIdx = master.findIndex(x=>x.id===dragSrcId);
        const toIdx   = master.findIndex(x=>x.id===m.id);
        if(fromIdx<0||toIdx<0) return;
        const [moved] = master.splice(fromIdx,1);
        master.splice(toIdx,0,moved);
        masterDirty = true;
        renderMaster();
      });

      el.appendChild(row);
    });
  });
}

function saveMasterOrder(){
  masterDirty = false;
  renderMaster();
  showToast('並び順を保存しました');
}

function setMasterSupplier(name){
  activeMasterSupplier = name;
  renderMaster();
}

function openMasterEdit(id){
  editingMasterId = (id===-1||id==='-1') ? -1 : Number(id);
  // 発注先セレクトを最新状態に更新
  document.getElementById('m-supplier-sel').innerHTML=buildSupplierOptions();
  document.getElementById('master-modal-title').textContent=editingMasterId===-1?'品目を追加':'品目を編集';
  // 削除ボタンは編集時のみ表示
  document.getElementById('master-delete-btn').style.display=editingMasterId===-1?'none':'inline-flex';
  if(editingMasterId===-1){
    ['m-name','m-unit'].forEach(i=>document.getElementById(i).value='');
    ['m-price','m-cost'].forEach(i=>document.getElementById(i).value='');
    document.getElementById('m-cat').value='木材';
    document.getElementById('m-supplier-sel').value=suppliers[0]?.name||'';
  } else {
    const m=master.find(x=>x.id===editingMasterId);
    if(!m)return;
    document.getElementById('m-cat').value=m.cat;
    document.getElementById('m-name').value=m.name;
    document.getElementById('m-unit').value=m.unit;
    document.getElementById('m-price').value=m.price;
    document.getElementById('m-cost').value=m.cost;
    document.getElementById('m-supplier-sel').value=m.supplier;
  }
  document.getElementById('master-modal').classList.add('open');
}

function duplicateMasterItem(id){
  const m=master.find(x=>x.id===id);
  if(!m)return;
  editingMasterId=-1;
  document.getElementById('m-supplier-sel').innerHTML=buildSupplierOptions();
  document.getElementById('master-modal-title').textContent='品目を追加（複製）';
  document.getElementById('master-delete-btn').style.display='none';
  document.getElementById('m-cat').value=m.cat;
  document.getElementById('m-name').value=m.name;
  document.getElementById('m-unit').value=m.unit;
  document.getElementById('m-price').value=m.price;
  document.getElementById('m-cost').value=m.cost;
  document.getElementById('m-supplier-sel').value=m.supplier;
  document.getElementById('master-modal').classList.add('open');
  setTimeout(()=>{
    const nameInput=document.getElementById('m-name');
    nameInput.focus();
    nameInput.select();
  },100);
}

function deleteMasterItem(){
  if(editingMasterId===null||editingMasterId===-1){
    showToast('削除対象が選択されていません');return;
  }
  const m=master.find(x=>x.id===editingMasterId);
  if(!m){showToast('品目が見つかりません');return;}
  if(!confirm(`「${m.name}」を削除しますか？`)) return;
  master=master.filter(x=>x.id!==editingMasterId);
  editingMasterId=null;
  closeMasterModal();
  renderMaster();
  showToast('品目を削除しました');
}
function closeMasterModal(){document.getElementById('master-modal').classList.remove('open');}
function saveMasterItem(){
  const item={
    cat: document.getElementById('m-cat').value,
    name: document.getElementById('m-name').value.trim(),
    unit: document.getElementById('m-unit').value.trim()||'式',
    price: parseInt(document.getElementById('m-price').value)||0,
    cost: parseInt(document.getElementById('m-cost').value)||0,
    supplier: document.getElementById('m-supplier-sel').value
  };
  if(!item.name){alert('品目名を入力してください');return;}

  const btn = document.getElementById('master-save-btn');
  btn.disabled = true;
  btn.innerHTML = '保存中…';

  setTimeout(()=>{
    if(editingMasterId===-1){
      master.push({id:masterIdSeq++,...item});
      activeMasterSupplier = item.supplier; // 追加した発注先タブに移動
    } else {
      const m=master.find(x=>x.id===editingMasterId);
      if(m) Object.assign(m,item);
      activeMasterSupplier = item.supplier;
    }
    closeMasterModal();
    renderMaster();
    // 保存完了トースト表示
    showToast(editingMasterId===-1?'品目を追加しました':'品目を保存しました');
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14" stroke-width="2.2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>保存して反映';
  }, 300);
}
