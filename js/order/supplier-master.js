// ════ 受発注：発注先マスタ ════

function renderSupplierMaster(){
  const el=document.getElementById('supplier-master-list');
  el.innerHTML=suppliers.length?suppliers.map(s=>`
    <div style="display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:0.5px solid var(--border)">
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700">${s.name}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${[s.contact,s.tel,s.email].filter(Boolean).join(' · ')}</div>
        ${s.cats?`<div style="font-size:11px;color:var(--accent-t);margin-top:1px">取扱：${s.cats}</div>`:''}
        ${s.note?`<div style="font-size:11px;color:var(--text-muted);margin-top:1px">${s.note}</div>`:''}
      </div>
      <button style="padding:4px 9px;border-radius:6px;font-size:11px;border:0.5px solid var(--border);background:var(--surface2);cursor:pointer;font-family:inherit;color:var(--text-sub);white-space:nowrap" onclick="openSupplierEdit(${s.id})">編集</button>
    </div>`).join(''):'<div class="empty">発注先が登録されていません</div>';
}

function openSupplierEdit(id){
  editingSupplierId=id;
  document.getElementById('supplier-modal-title').textContent=id===-1?'発注先を追加':'発注先を編集';
  if(id===-1){['s-name','s-contact','s-tel','s-email','s-cats','s-note'].forEach(i=>document.getElementById(i).value='');}
  else{const s=suppliers.find(x=>x.id===id);if(!s)return;document.getElementById('s-name').value=s.name;document.getElementById('s-contact').value=s.contact;document.getElementById('s-tel').value=s.tel;document.getElementById('s-email').value=s.email;document.getElementById('s-cats').value=s.cats;document.getElementById('s-note').value=s.note;}
  document.getElementById('supplier-modal').classList.add('open');
}
function closeSupplierModal(){document.getElementById('supplier-modal').classList.remove('open');}
function saveSupplier(){
  const item={name:document.getElementById('s-name').value.trim(),contact:document.getElementById('s-contact').value.trim(),tel:document.getElementById('s-tel').value.trim(),email:document.getElementById('s-email').value.trim(),cats:document.getElementById('s-cats').value.trim(),note:document.getElementById('s-note').value.trim()};
  if(!item.name){alert('発注先名を入力してください');return;}
  if(editingSupplierId===-1) suppliers.push({id:supplierIdSeq++,...item});
  else{const s=suppliers.find(x=>x.id===editingSupplierId);if(s)Object.assign(s,item);}
  closeSupplierModal();renderSupplierMaster();
}

function buildSupplierOptions(selected=''){
  return suppliers.map(s=>`<option${s.name===selected?' selected':''}>${s.name}</option>`).join('');
}
