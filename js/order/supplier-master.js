// ════ 受発注：発注先マスタ ════

function renderSupplierMaster(){
  const saveBtn=document.getElementById('supplier-order-save-btn');
  if(saveBtn) saveBtn.style.cssText = supplierDirty
    ? 'display:inline-flex;background:var(--wood);border-color:var(--wood)'
    : 'display:none';

  const el=document.getElementById('supplier-master-list');
  if(!suppliers.length){el.innerHTML='<div class="empty">発注先が登録されていません</div>';return;}
  el.innerHTML='';
  suppliers.forEach(s=>{
    const row=document.createElement('div');
    row.className='draggable';
    row.dataset.id=s.id;
    row.style.cssText='display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:0.5px solid var(--border)';
    row.innerHTML=`
      <div class="drag-handle" title="つかんで並び替え">⠿</div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700">${s.name}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${[s.contact,s.tel,s.email].filter(Boolean).join(' · ')}</div>
        ${s.cats?`<div style="font-size:11px;color:var(--accent-t);margin-top:1px">取扱：${s.cats}</div>`:''}
        <div style="font-size:11px;color:var(--text-muted);margin-top:1px">発注書：${orderChannelsOf(s).map(c=>ORDER_CHANNEL_LABEL[c]||c).join('・')}</div>
        ${s.note?`<div style="font-size:11px;color:var(--text-muted);margin-top:1px">${s.note}</div>`:''}
      </div>
      <button style="padding:4px 9px;border-radius:6px;font-size:11px;border:0.5px solid var(--border);background:var(--surface2);cursor:pointer;font-family:inherit;color:var(--text-sub);white-space:nowrap" onclick="openSupplierEdit(${s.id})">編集</button>`;

    el.appendChild(row);
  });

  // 「⠿」をつかんで並び替え（パソコンのマウスでもスマホの指でも動く）
  enableDragSort(el, '.draggable', (fromId, toId)=>{
    const fromIdx = suppliers.findIndex(x=>String(x.id)===String(fromId));
    const toIdx   = suppliers.findIndex(x=>String(x.id)===String(toId));
    if(fromIdx<0||toIdx<0) return;
    const [moved] = suppliers.splice(fromIdx,1);
    suppliers.splice(toIdx,0,moved);
    supplierDirty = true;
    renderSupplierMaster();
  });
}

async function saveSupplierOrder(){
  supplierDirty = false;
  try{
    await dbReorderSuppliers(suppliers);
  }catch(e){return;}
  renderSupplierMaster();
  showToast('並び順を保存しました');
}

function openSupplierEdit(id){
  editingSupplierId=id;
  document.getElementById('supplier-modal-title').textContent=id===-1?'発注先を追加':'発注先を編集';
  if(id===-1){
    ['s-name','s-contact','s-tel','s-email','s-cats','s-note','s-chatwork','s-regno'].forEach(i=>document.getElementById(i).value='');
    document.getElementById('s-closing').value='0';
    setSupplierChannels(['chat']);
  } else {
    const s=suppliers.find(x=>x.id===id);if(!s)return;
    document.getElementById('s-name').value=s.name;document.getElementById('s-contact').value=s.contact;
    document.getElementById('s-tel').value=s.tel;document.getElementById('s-email').value=s.email;
    document.getElementById('s-cats').value=s.cats;document.getElementById('s-note').value=s.note;
    document.getElementById('s-chatwork').value=s.chatworkRoomId||'';
    document.getElementById('s-closing').value=String(s.closingDay||0);
    document.getElementById('s-regno').value=s.invoiceRegNo||'';
    setSupplierChannels(orderChannelsOf(s));
  }
  document.getElementById('supplier-delete-btn').style.display=id===-1?'none':'inline-flex';
  document.getElementById('supplier-modal').classList.add('open');
}
function closeSupplierModal(){document.getElementById('supplier-modal').classList.remove('open');}
async function deleteSupplier(){
  if(editingSupplierId===null||editingSupplierId===-1) return;
  const s=suppliers.find(x=>x.id===editingSupplierId);
  if(!s){showToast('発注先が見つかりません');return;}
  if(!confirm(`「${s.name}」を削除しますか？\n紐づく品目・発注履歴は発注先未設定になります。`)) return;
  try{
    await dbDeleteSupplier(editingSupplierId);
  }catch(e){return;}
  suppliers=suppliers.filter(x=>x.id!==editingSupplierId);
  editingSupplierId=null;
  closeSupplierModal();
  renderSupplierMaster();
  showToast('発注先を削除しました');
}
async function saveSupplier(){
  const item={name:document.getElementById('s-name').value.trim(),contact:document.getElementById('s-contact').value.trim(),tel:document.getElementById('s-tel').value.trim(),email:document.getElementById('s-email').value.trim(),cats:document.getElementById('s-cats').value.trim(),note:document.getElementById('s-note').value.trim(),chatworkRoomId:document.getElementById('s-chatwork').value.trim(),orderChannels:getSupplierChannels(),
    closingDay:Number(document.getElementById('s-closing').value)||0,
    invoiceRegNo:document.getElementById('s-regno').value.trim().toUpperCase()};
  if(!item.name){alert('発注先名を入力してください');return;}
  if(item.invoiceRegNo && !/^Td{13}$/.test(item.invoiceRegNo)){
    alert('登録番号は T のあとに数字13桁で入れてください（例：T1234567890123）');return;
  }
  if(!item.orderChannels.length){alert('発注書の送付先を1つ以上選んでください');return;}
  if(item.orderChannels.includes('chatwork') && !item.chatworkRoomId){alert('ChatWorkに送るには、ルームIDを入れてください');return;}
  if(item.orderChannels.includes('email') && !item.email){alert('メールで送るには、メールアドレスを入れてください');return;}
  try{
    if(editingSupplierId===-1) await dbAddSupplier(item);
    else{
      await dbUpdateSupplier(editingSupplierId,item);
      const s=suppliers.find(x=>x.id===editingSupplierId);if(s)Object.assign(s,item);
    }
  }catch(e){return;}
  closeSupplierModal();renderSupplierMaster();
}

function buildSupplierOptions(selected=''){
  return suppliers.map(s=>`<option${s.name===selected?' selected':''}>${s.name}</option>`).join('');
}


// ── 発注書の送付先（チェックボックス） ──
function getSupplierChannels(){
  return ['chat','chatwork','email'].filter(c=>document.getElementById('s-ch-'+c)?.checked);
}
function setSupplierChannels(list){
  const on = new Set(list||[]);
  ['chat','chatwork','email'].forEach(c=>{
    const el = document.getElementById('s-ch-'+c);
    if(el) el.checked = on.has(c);
  });
}
