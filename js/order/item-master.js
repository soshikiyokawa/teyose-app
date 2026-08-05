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

  // エクレアパーツのときだけ「ホームページの単価を確認」を出す
  if(typeof renderEkreaBar==='function') renderEkreaBar();

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
      row.innerHTML = `
        <div class="drag-handle staff-only" title="つかんで並び替え">⠿</div>
        <div class="mi-info">
          <div class="mi-row">
            <span class="mi-item-name">${n}</span>
            <span class="mi-spec">${s}</span>
          </div>
          <div class="mi-meta">
            <span>原価 ¥${fmt(m.cost)}/${m.unit}</span>
            ${m.makerCode?`<span style="color:var(--text-muted)">品番 ${esc(m.makerCode)}</span>`:''}
            ${(m.webPrice!=null && m.webPrice!==m.cost)
              ? `<span style="color:var(--danger);font-weight:700">HP ¥${fmt(m.webPrice)}</span>` : ''}
          </div>
        </div>
        <button class="mi-edit-btn-sm staff-only" onclick="duplicateMasterItem(${m.id})" title="この品目を複製して次の品目を追加">複製</button>
        <button class="mi-edit-btn-sm" onclick="openMasterEdit(${m.id})">${currentUserRole!=='supplier'?'編集':'単価編集'}</button>`;

      el.appendChild(row);
    });
  });

  // 「⠿」をつかんで並び替え（パソコンのマウスでもスマホの指でも動く）
  if(currentUserRole!=='supplier'){
    enableDragSort(el, '.master-item', (fromId, toId)=>{
      const fromIdx = master.findIndex(x=>String(x.id)===String(fromId));
      const toIdx   = master.findIndex(x=>String(x.id)===String(toId));
      if(fromIdx<0||toIdx<0) return;
      const [moved] = master.splice(fromIdx,1);
      master.splice(toIdx,0,moved);
      masterDirty = true;
      renderMaster();
    });
  }
}

async function saveMasterOrder(){
  masterDirty = false;
  try{
    await dbReorderMasterItems(master);
  }catch(e){return;}
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
  if(editingMasterId===-1){
    ['m-name','m-unit','m-maker-code'].forEach(i=>document.getElementById(i).value='');
    ['m-price','m-cost'].forEach(i=>document.getElementById(i).value='');
    document.getElementById('m-cat').value='木材';
    document.getElementById('m-supplier-sel').value=suppliers[0]?.name||'';
  } else {
    const m=master.find(x=>x.id===editingMasterId);
    if(!m)return;
    document.getElementById('m-cat').value=m.cat;
    document.getElementById('m-name').value=m.name;
    document.getElementById('m-unit').value=m.unit;
    document.getElementById('m-cost').value=m.cost;
    document.getElementById('m-supplier-sel').value=m.supplier;
    document.getElementById('m-maker-code').value=m.makerCode||'';
  }
  masterMakerCodeSync();
  const askBox=document.getElementById('m-ask-price');
  if(askBox) delete askBox.dataset.touched;   // 開くたびに自動判定に戻す
  masterAskSync();
  // 発注先ロールは原価のみ編集可（管理者・一般社員は全項目編集可）
  const supplierOnly = currentUserRole==='supplier';
  ['m-cat','m-name','m-unit','m-supplier-sel','m-maker-code'].forEach(id=>document.getElementById(id).disabled=supplierOnly);
  document.getElementById('master-delete-btn').style.display = (supplierOnly||editingMasterId===-1) ? 'none' : 'inline-flex';
  document.getElementById('master-modal').classList.add('open');
}

// 「単価の入力をお願いする」欄は新規追加のときだけ。
// 原価をこちらで入れた場合は、お願いする必要がないので既定で外す
function masterAskSync(){
  const wrap=document.getElementById('m-ask-wrap');
  if(!wrap) return;
  const isNew = editingMasterId===-1;
  const sup=document.getElementById('m-supplier-sel').value;
  const show = isNew && currentUserRole!=='supplier' && sup && sup!=='在庫分';
  wrap.style.display = show ? 'flex' : 'none';
  if(!show) return;
  const cost=parseInt(document.getElementById('m-cost').value)||0;
  const box=document.getElementById('m-ask-price');
  if(box && !box.dataset.touched) box.checked = cost===0;
}

// 品番欄はエクレアパーツのときだけ出す。空なら品目名から品番らしき文字を拾って案内する
function masterMakerCodeSync(){
  const wrap=document.getElementById('m-maker-code-wrap');
  if(!wrap) return;
  const sup=document.getElementById('m-supplier-sel').value;
  const show=(typeof isEkreaSupplier==='function') ? isEkreaSupplier(sup) : false;
  wrap.style.display = show ? '' : 'none';
  if(!show) return;
  const codeEl=document.getElementById('m-maker-code');
  const hint=document.getElementById('m-maker-code-hint');
  if(codeEl.value.trim()){ hint.textContent='この品番でホームページの単価を取りにいきます'; return; }
  const guess=(document.getElementById('m-name').value.match(/\d{2}-\d{3,5}/)||[])[0];
  hint.innerHTML = guess
    ? `品目名に「${esc(guess)}」が入っています。<button type="button" class="btn xs" onclick="masterUseGuessedCode('${esc(guess)}')">品番に入れる</button>`
    : '空のままだと、この品目は価格の自動取得の対象になりません';
}
function masterUseGuessedCode(code){
  document.getElementById('m-maker-code').value=code;
  masterMakerCodeSync();
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
  document.getElementById('m-cost').value=m.cost;
  document.getElementById('m-supplier-sel').value=m.supplier;
  // 品番は品目ごとに違うので、複製では引き継がない
  document.getElementById('m-maker-code').value='';
  masterMakerCodeSync();
  const dupAskBox=document.getElementById('m-ask-price');
  if(dupAskBox) delete dupAskBox.dataset.touched;
  masterAskSync();
  document.getElementById('master-modal').classList.add('open');
  setTimeout(()=>{
    const nameInput=document.getElementById('m-name');
    nameInput.focus();
    nameInput.select();
  },100);
}

async function deleteMasterItem(){
  if(editingMasterId===null||editingMasterId===-1){
    showToast('削除対象が選択されていません');return;
  }
  const m=master.find(x=>x.id===editingMasterId);
  if(!m){showToast('品目が見つかりません');return;}
  if(!confirm(`「${m.name}」を削除しますか？`)) return;
  try{
    await dbDeleteMasterItem(editingMasterId);
  }catch(e){return;}
  master=master.filter(x=>x.id!==editingMasterId);
  editingMasterId=null;
  closeMasterModal();
  renderMaster();
  showToast('品目を削除しました');
}
function closeMasterModal(){document.getElementById('master-modal').classList.remove('open');}

// 品目を追加したとき、発注先に単価の入力をお願いする（チャット＋通知）
// 在庫分は社内用の枠なので送らない
async function askSupplierForPrice(item){
  if(!item.supplier || item.supplier==='在庫分') return;
  const spec = item.makerCode ? `　品番 ${item.makerCode}` : '';
  const text =
    `【単価入力のお願い】\n`+
    `下記の品目を登録しました。単価のご入力をお願いします。\n`+
    `・${item.cat}　${item.name}（${item.unit}）${spec}\n`+
    `アプリの「受発注 → 品目マスタ」の「単価編集」からご入力ください。`;
  try{
    await dbAddChatMessage(item.supplier, {role:'me', type:'text', text});
    showToast(`${item.supplier}に単価の入力をお願いしました`);
  }catch(_){
    showToast('品目は追加しましたが、依頼の送信に失敗しました');
  }
}
async function saveMasterItem(){
  const item={
    cat: document.getElementById('m-cat').value,
    name: document.getElementById('m-name').value.trim(),
    unit: document.getElementById('m-unit').value.trim()||'式',
    cost: parseInt(document.getElementById('m-cost').value)||0,
    price: parseInt(document.getElementById('m-cost').value)||0,
    supplier: document.getElementById('m-supplier-sel').value,
    makerCode: document.getElementById('m-maker-code').value.trim()
  };
  if(!item.name){alert('品目名を入力してください');return;}

  const btn = document.getElementById('master-save-btn');
  btn.disabled = true;
  btn.innerHTML = '保存中…';

  const isNew = editingMasterId===-1;
  const askPrice = isNew && document.getElementById('m-ask-price')?.checked;

  try{
    if(editingMasterId===-1){
      await dbAddMasterItem(item);
      activeMasterSupplier = item.supplier; // 追加した発注先タブに移動
      if(askPrice) await askSupplierForPrice(item);
    } else {
      await dbUpdateMasterItem(editingMasterId,item);
      const m=master.find(x=>x.id===editingMasterId);
      if(m) Object.assign(m,item);
      activeMasterSupplier = item.supplier;
    }
    closeMasterModal();
    renderMaster();
    showToast(editingMasterId===-1?'品目を追加しました':'品目を保存しました');
  }catch(e){
    // dbAdd/dbUpdate内でトースト表示済み
  }finally{
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14" stroke-width="2.2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>保存して反映';
  }
}
