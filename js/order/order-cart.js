// ════ 受発注：発注作成フロー（発注先選択 → 品目選択 → カート） ════

function orderSubTab(t){
  document.querySelectorAll('#page-order .sub-tab-btn').forEach((b,i)=>b.classList.toggle('active',['new','supplier','master','history'][i]===t));
  document.querySelectorAll('#page-order .sub-page').forEach(p=>p.classList.remove('active'));
  document.getElementById('ordersub-'+t).classList.add('active');
  if(t==='new') renderSupplierSelectList();
  if(t==='supplier') renderSupplierMaster();
  if(t==='master') renderMaster();
  if(t==='history') renderOrders();
}

// ── STEP1: 発注先リスト ──
function renderSupplierSelectList(){
  const el=document.getElementById('supplier-select-list');
  if(!suppliers.length){el.innerHTML='<div class="empty">発注先が登録されていません</div>';return;}
  el.innerHTML=suppliers.map(s=>`
    <div class="supplier-card${selectedSupplier&&selectedSupplier.id===s.id?' selected':''}" onclick="selectSupplier(${s.id})">
      <div class="sup-icon">🏪</div>
      <div class="sup-info">
        <div class="sup-name">${s.name}</div>
        <div class="sup-meta">${s.contact}${s.tel?' · '+s.tel:''}</div>
        <div class="sup-meta" style="color:var(--accent-t);margin-top:1px">${s.cats||'—'}</div>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" width="16" height="16" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`).join('');
}

function selectSupplier(id){
  selectedSupplier=suppliers.find(s=>s.id===id);
  activeCat='全て';
  cart=[];
  document.getElementById('order-step1').style.display='none';
  document.getElementById('order-step2').style.display='block';
  document.getElementById('selected-supplier-name').textContent=selectedSupplier.name;
  renderCatFilter();
  renderItemSelectList();
  renderCart();
}

function backToStep1(){
  document.getElementById('order-step1').style.display='block';
  document.getElementById('order-step2').style.display='none';
  renderSupplierSelectList();
}

// ── STEP2: カテゴリフィルタ ──
function renderCatFilter(){
  const items=master.filter(m=>m.supplier===selectedSupplier.name);
  const cats=['全て',...new Set(items.map(m=>m.cat))];
  document.getElementById('cat-filter-wrap').innerHTML=cats.map(c=>`
    <button class="cat-pill${c===activeCat?' active':''}" onclick="setCat('${c}')">${c}</button>`).join('');
}

function setCat(cat){
  activeCat=cat;
  renderCatFilter();
  renderItemSelectList();
}

// ── STEP2: 品目リスト（選択式） ──
function renderItemSelectList(){
  const items=master.filter(m=>{
    if(m.supplier!==selectedSupplier.name) return false;
    if(activeCat!=='全て'&&m.cat!==activeCat) return false;
    return true;
  });
  const el=document.getElementById('item-select-list');
  if(!items.length){el.innerHTML='<div class="empty">この発注先の品目がありません。<br>品目マスタで発注先を設定してください。</div>';return;}
  el.innerHTML=items.map(m=>{
    const inCart=cart.find(c=>c.id===m.id);
    const {n, s} = splitNameSpec(m.name);
    return `<div class="item-pick-card${inCart?' in-cart':''}" onclick="openQtyModal(${m.id})">
      <div class="ipc-info">
        <div class="ipc-row">
          <span class="ipc-name">${n}</span>
          <span class="ipc-spec">${s}</span>
        </div>
        <div class="ipc-meta">${m.cat}${inCart?` · カート: ${inCart.qty}${m.unit}`:'　／　タップして追加'}</div>
      </div>
      <div class="ipc-price">原価 ¥${fmt(m.cost)}/${m.unit}</div>
    </div>`;
  }).join('');
}

// ── 数量モーダル ──
function openQtyModal(itemId){
  pendingItem=master.find(m=>m.id===itemId);
  if(!pendingItem) return;
  const inCart=cart.find(c=>c.id===itemId);
  document.getElementById('qty-modal-title').textContent=inCart?'数量を変更':'数量を入力';
  document.getElementById('qty-item-name').textContent=pendingItem.name;
  document.getElementById('qty-item-meta').textContent=`原価 ¥${fmt(pendingItem.cost)}/${pendingItem.unit}　発注先：${pendingItem.supplier}`;
  document.getElementById('qty-unit-label').textContent=pendingItem.unit;
  document.getElementById('qty-input').value=inCart?inCart.qty:1;
  // クイック選択ボタン
  const quicks=[1,2,3,5,10,20];
  document.getElementById('qty-quick-btns').innerHTML=quicks.map(n=>`
    <button class="btn sm" onclick="document.getElementById('qty-input').value=${n}" style="min-width:44px;justify-content:center">${n}${pendingItem.unit}</button>`).join('');
  document.getElementById('qty-modal').classList.add('open');
  setTimeout(()=>document.getElementById('qty-input').focus(),100);
}

function closeQtyModal(){document.getElementById('qty-modal').classList.remove('open');pendingItem=null;}

function confirmQty(){
  if(!pendingItem) return;
  const qty=parseFloat(document.getElementById('qty-input').value)||0;
  if(qty<=0){closeQtyModal();return;}
  const ex=cart.find(c=>c.id===pendingItem.id);
  if(ex) ex.qty=qty; else cart.push({...pendingItem,qty});
  closeQtyModal();
  renderItemSelectList();
  renderCart();
}

// ── カート ──
function renderCart(){
  const card=document.getElementById('cart-card');
  const ci=document.getElementById('cart-items');
  if(!cart.length){card.style.display='none';updateOrderPreviewBtnState();return;}
  card.style.display='block';
  ci.innerHTML=cart.map((c,i)=>`
    <div class="cart-item">
      <div style="flex:1">
        <div style="font-size:13px;font-weight:500">${c.name}</div>
        <div style="font-size:11px;color:var(--text-muted)">¥${fmt(c.cost)}/${c.unit}</div>
      </div>
      <div class="qty-ctrl">
        <button class="qty-btn" onclick="changeQty(${i},-1)">−</button>
        <div class="qty-val">${c.qty}</div>
        <button class="qty-btn" onclick="changeQty(${i},1)">＋</button>
        <span style="font-size:12px;color:var(--text-sub);margin-left:2px">${c.unit}</span>
      </div>
      <div style="font-size:12px;font-weight:600;color:var(--wood-t);min-width:62px;text-align:right">¥${fmt(c.cost*c.qty)}</div>
      <button class="btn danger xs" onclick="removeCartItem(${i})" style="margin-left:4px">×</button>
    </div>`).join('');
  document.getElementById('cart-total').textContent=fmt(cart.reduce((s,c)=>s+c.cost*c.qty,0));
  updateOrderPreviewBtnState();
}
function changeQty(i,d){
  cart[i].qty=Math.max(1,cart[i].qty+d);
  renderCart();renderItemSelectList();
}
function removeCartItem(i){cart.splice(i,1);renderCart();renderItemSelectList();}
function clearCart(){cart=[];renderCart();renderItemSelectList();}
