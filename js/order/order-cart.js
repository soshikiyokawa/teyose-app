// ════ 受発注：発注作成フロー（発注先選択 → 品目選択 → カート） ════

function orderSubTab(t){
  document.querySelectorAll('#page-order .sub-tab-btn').forEach((b,i)=>b.classList.toggle('active',['new','supplier','master','invoice','history','card'][i]===t));
  document.querySelectorAll('#page-order .sub-page').forEach(p=>p.classList.remove('active'));
  document.getElementById('ordersub-'+t).classList.add('active');
  if(t==='new') renderSupplierSelectList();
  if(t==='supplier') renderSupplierMaster();
  if(t==='master') renderMaster();
  if(t==='invoice') renderInvoices();
  if(t==='history') renderOrders();
  if(t==='card') renderCardPage();
}

// ── STEP1: 発注先リスト ──
function renderSupplierSelectList(){
  const el=document.getElementById('supplier-select-list');
  if(!suppliers.length){el.innerHTML='<div class="empty">発注先が登録されていません</div>';return;}
  el.innerHTML=suppliers.map(s=>{
    const isStock=s.name==='在庫分';
    return `
    <div class="supplier-card${selectedSupplier&&selectedSupplier.id===s.id?' selected':''}" onclick="selectSupplier(${s.id})">
      <div class="sup-icon">${isStock?'📦':'🏪'}</div>
      <div class="sup-info">
        <div class="sup-name">${s.name}</div>
        <div class="sup-meta">${isStock?'自社在庫から現場へ出す（原価は使う現場に計上）':s.contact+(s.tel?' · '+s.tel:'')}</div>
        <div class="sup-meta" style="color:var(--accent-t);margin-top:1px">${isStock?'':s.cats||'—'}</div>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" width="16" height="16" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`;
  }).join('');
}

function selectSupplier(id){
  selectedSupplier=suppliers.find(s=>s.id===id);
  activeCat='全て';
  cart=[];
  document.getElementById('order-step1').style.display='none';
  document.getElementById('order-step2').style.display='block';
  document.getElementById('selected-supplier-name').textContent=selectedSupplier.name;
  renderOrderProjectSelect();
  renderCatFilter();
  renderItemSelectList();
  renderCart();
}

// 発注の紐づけ先（案件 or 在庫分）の選択肢。サイドバーで選択中の案件を初期値にする
function renderOrderProjectSelect(){
  const el=document.getElementById('order-project');
  if(!el) return;
  const prev=el.value;
  el.innerHTML='<option value="">選択してください</option>'
    +'<option value="在庫分">在庫分（案件に紐づかない発注）</option>'
    +projects.map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
  el.value = prev || selectedProjectName || '';
  if(el.selectedIndex<0) el.selectedIndex=0;
  updateOrderPreviewBtnState();
}

function backToStep1(){
  document.getElementById('order-step1').style.display='block';
  document.getElementById('order-step2').style.display='none';
  renderSupplierSelectList();
}

// ── STEP2: カテゴリフィルタ ──
function renderCatFilter(){
  if(selectedSupplier?.name==='在庫分'){document.getElementById('cat-filter-wrap').innerHTML='';return;}
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
// 発注先「在庫分」の場合は品目マスタではなく、現在庫がある品目を表示する
let _stockList=[];
function renderStockItemList(){
  _stockList=Object.values(calcStock()).filter(s=>s.qty>0).sort((a,b)=>a.name.localeCompare(b.name,'ja'));
  const el=document.getElementById('item-select-list');
  if(!_stockList.length){el.innerHTML='<div class="empty">現在、在庫がありません。<br>案件「在庫分」で発注すると在庫に入ります。</div>';return;}
  el.innerHTML=_stockList.map((s,i)=>{
    const inCart=cart.find(c=>c.id==='stock:'+s.name);
    const {n, s:spec} = splitNameSpec(s.name);
    return `<div class="item-pick-card${inCart?' in-cart':''}" onclick="openStockQtyModal(${i})">
      <div class="ipc-info">
        <div class="ipc-row">
          <span class="ipc-name">${esc(n)}</span>
          <span class="ipc-spec">${esc(spec)}</span>
        </div>
        <div class="ipc-meta">在庫 ${s.qty}${s.unit}${inCart?` · カート: ${inCart.qty}${s.unit}`:'　／　タップして追加'}</div>
      </div>
      <div class="ipc-price">平均単価 ¥${fmt(s.avgCost)}/${s.unit}</div>
    </div>`;
  }).join('');
}

function renderItemSelectList(){
  if(selectedSupplier?.name==='在庫分'){renderStockItemList();return;}
  const items=master.filter(m=>{
    if(m.supplier!==selectedSupplier.name) return false;
    if(activeCat!=='全て'&&m.cat!==activeCat) return false;
    return true;
  });
  const el=document.getElementById('item-select-list');
  // 大林製材は、造作材をその場で作って入れられるようにする
  const zosakuCard = isZosakuSupplier(selectedSupplier) ? `
    <div class="item-pick-card zosaku-add" onclick="openZosakuModal()">
      <div class="ipc-info">
        <div class="ipc-row"><span class="ipc-name">＋ 造作材を作って入れる</span></div>
        <div class="ipc-meta">材種・等級・寸法を決めて、その場でカートに入れられます</div>
      </div>
    </div>` : '';
  if(!items.length){
    el.innerHTML = zosakuCard ||
      '<div class="empty">この発注先の品目がありません。<br>品目マスタで発注先を設定してください。</div>';
    return;
  }
  el.innerHTML=zosakuCard+items.map(m=>{
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
      <div class="ipc-price">原価 ¥${fmt(itemCurrentCost(m))}/${m.unit}</div>
    </div>`;
  }).join('');
}

// ── 数量モーダル ──
function openQtyModal(itemId){
  const _m=master.find(m=>m.id===itemId);
  if(!_m) return;
  // 発注は「今日の時点で有効な単価」で行う（先の日付で予約された値上げはまだ使わない）
  pendingItem={..._m, cost:itemCurrentCost(_m), price:itemCurrentCost(_m)};
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

// 在庫品目の数量入力（在庫数を上限にする）
function openStockQtyModal(i){
  const s=_stockList[i];
  if(!s) return;
  pendingItem={id:'stock:'+s.name, cat:'在庫', name:s.name, unit:s.unit, cost:Math.round(s.avgCost), price:0, supplier:'在庫分', _stockMax:s.qty};
  const inCart=cart.find(c=>c.id===pendingItem.id);
  document.getElementById('qty-modal-title').textContent=inCart?'数量を変更':'数量を入力';
  document.getElementById('qty-item-name').textContent=s.name;
  document.getElementById('qty-item-meta').textContent=`在庫 ${s.qty}${s.unit}　平均単価 ¥${fmt(s.avgCost)}/${s.unit}`;
  document.getElementById('qty-unit-label').textContent=s.unit;
  document.getElementById('qty-input').value=inCart?inCart.qty:1;
  const quicks=[1,2,3,5,10,20].filter(n=>n<=s.qty);
  document.getElementById('qty-quick-btns').innerHTML=quicks.map(n=>`
    <button class="btn sm" onclick="document.getElementById('qty-input').value=${n}" style="min-width:44px;justify-content:center">${n}${s.unit}</button>`).join('');
  document.getElementById('qty-modal').classList.add('open');
  setTimeout(()=>document.getElementById('qty-input').focus(),100);
}

function closeQtyModal(){document.getElementById('qty-modal').classList.remove('open');pendingItem=null;}

function confirmQty(){
  if(!pendingItem) return;
  const qty=parseFloat(document.getElementById('qty-input').value)||0;
  if(qty<=0){closeQtyModal();return;}
  // 在庫品目は現在庫を超えて出庫できない
  if(pendingItem._stockMax!=null && qty>pendingItem._stockMax){
    alert(`在庫が足りません。「${pendingItem.name}」の現在庫は ${pendingItem._stockMax}${pendingItem.unit} です。`);
    return;
  }
  const ex=cart.find(c=>c.id===pendingItem.id);
  const {_stockMax, ...clean}=pendingItem;
  if(ex) ex.qty=qty; else cart.push({...clean,qty});
  closeQtyModal();
  renderItemSelectList();
  renderCart();
}

// ════ 造作材をその場で作ってカートに入れる（大林製材） ════
//
// 造作材は材種・等級・寸法の組み合わせが多すぎて品目マスタに持てないので、
// 発注のときに作れるようにする。単価は分からないことが多いので空でもよく、
// あとから大林製材が「単価・送料を直す」から入れられる。
const ZOSAKU_SUPPLIER = /大林製材/;
const ZOSAKU_CAT = '造作材';
const ZOSAKU_UNIT = '本';
function isZosakuSupplier(s){ return ZOSAKU_SUPPLIER.test(s?.name || ''); }

function openZosakuModal(){
  ['zs-kind','zs-t','zs-w','zs-l','zs-cost'].forEach(i=>{ const el=document.getElementById(i); if(el) el.value=''; });
  document.getElementById('zs-grade').value='化粧';
  zosakuSync();
  document.getElementById('zosaku-modal').classList.add('open');
  setTimeout(()=>document.getElementById('zs-kind')?.focus(),100);
}
function closeZosakuModal(){ document.getElementById('zosaku-modal').classList.remove('open'); }

const zsVal = id => String(document.getElementById(id)?.value || '').trim();
function zosakuSize(){
  const p=['zs-t','zs-w','zs-l'].map(id=>zsVal(id).replace(/[^\d.]/g,''));
  return p.every(Boolean) ? p.join('×') : '';
}
function zosakuCost(){
  return Math.max(0, parseInt(zsVal('zs-cost').replace(/[^\d]/g,''))||0);
}
function zosakuName(){
  const size=zosakuSize();
  return [zsVal('zs-kind'), zsVal('zs-grade')||document.getElementById('zs-grade')?.value, size]
    .filter(Boolean).join(' ');
}
function zosakuSync(){
  const kind=zsVal('zs-kind'), size=zosakuSize(), cost=zosakuCost();
  const ok=!!(kind && size);
  const pv=document.getElementById('zs-preview');
  if(pv) pv.innerHTML = ok
    ? `<b>${esc(zosakuName())}</b><br>
       <span style="color:var(--text-sub)">${ZOSAKU_CAT}／${ZOSAKU_UNIT}／単価 ${cost?'¥'+fmt(cost):'未定'}</span>`
    : `<span style="color:var(--text-muted)">材種と寸法（3つとも）を入れてください</span>`;
  const btn=document.getElementById('zs-next-btn');
  if(btn) btn.disabled=!ok;
}

// 内容が決まったら、いつもの数量モーダル（クイック選択・直接入力）へ渡す
function zosakuToQty(){
  const name=zosakuName();
  if(!zsVal('zs-kind') || !zosakuSize()){ showToast('材種と寸法を入れてください'); return; }
  const cost=zosakuCost();
  // 同じ内容をもう一度作ったときは、カートの同じ行の本数を変える
  pendingItem={ id:'zosaku:'+name, cat:ZOSAKU_CAT, name, unit:ZOSAKU_UNIT,
    cost, price:cost, supplier:selectedSupplier?.name||'', shipping:0, shippingPer:'order' };
  closeZosakuModal();
  const inCart=cart.find(c=>c.id===pendingItem.id);
  document.getElementById('qty-modal-title').textContent=inCart?'本数を変更':'本数を入力';
  document.getElementById('qty-item-name').textContent=name;
  document.getElementById('qty-item-meta').textContent=
    `${ZOSAKU_CAT}　単価 ${cost?'¥'+fmt(cost):'未定'}/${ZOSAKU_UNIT}　発注先：${pendingItem.supplier}`;
  document.getElementById('qty-unit-label').textContent=ZOSAKU_UNIT;
  document.getElementById('qty-input').value=inCart?inCart.qty:1;
  document.getElementById('qty-quick-btns').innerHTML=[1,2,3,5,10,20].map(n=>`
    <button class="btn sm" onclick="document.getElementById('qty-input').value=${n}" style="min-width:44px;justify-content:center">${n}${ZOSAKU_UNIT}</button>`).join('');
  document.getElementById('qty-modal').classList.add('open');
  setTimeout(()=>document.getElementById('qty-input').focus(),100);
}

// ── メーカー送料 ──
//
// 品目に登録したメーカー送料を、発注のときに足す。
//   1つごとに（unit）… 単価に足し込む
//   1回の発注につき（order）… 「送料」の行としてまとめて1行にする
function cartUnitShipping(c){ return c.shippingPer==='unit' ? (Number(c.shipping)||0) : 0; }
function cartItemCost(c){ return (Number(c.cost)||0) + cartUnitShipping(c); }
// 「1回の発注につき」の送料の合計（品目ごとに1回ずつ）
function cartOrderShipping(){
  return (cart||[]).reduce((s,c)=> s + (c.shippingPer==='unit' ? 0 : (Number(c.shipping)||0)), 0);
}
function cartGrandTotal(){
  return (cart||[]).reduce((s,c)=>s+cartItemCost(c)*c.qty, 0) + cartOrderShipping();
}

// ── カート ──
function renderCart(){
  const card=document.getElementById('cart-card');
  const ci=document.getElementById('cart-items');
  if(!cart.length){card.style.display='none';updateOrderPreviewBtnState();return;}
  card.style.display='block';
  ci.innerHTML=cart.map((c,i)=>`
    <div class="cart-item">
      <div class="cart-name">
        <div style="font-size:13px;font-weight:500">${c.name}</div>
        <div style="font-size:11px;color:var(--text-muted)">¥${fmt(c.cost)}/${c.unit}${
          cartUnitShipping(c) ? `　＋送料 ¥${fmt(cartUnitShipping(c))}/${c.unit}` : ''}${
          (c.shipping && c.shippingPer!=='unit') ? `　＋送料 ¥${fmt(c.shipping)}（1回）` : ''}</div>
      </div>
      <div class="qty-ctrl">
        <button class="qty-btn" onclick="changeQty(${i},-1)">−</button>
        <div class="qty-val">${c.qty}</div>
        <button class="qty-btn" onclick="changeQty(${i},1)">＋</button>
        <span style="font-size:12px;color:var(--text-sub);margin-left:2px">${c.unit}</span>
      </div>
      <div style="font-size:12px;font-weight:600;color:var(--wood-t);min-width:62px;text-align:right">¥${fmt(cartItemCost(c)*c.qty)}</div>
      <button class="btn danger xs" onclick="removeCartItem(${i})" style="margin-left:4px">×</button>
    </div>`).join('');
  // メーカー送料（1回の発注につき）は、まとめて1行として出す
  const ship=cartOrderShipping();
  if(ship){
    ci.innerHTML+=`<div class="cart-item" style="background:var(--surface2)">
      <div class="cart-name"><div style="font-size:13px;font-weight:500">送料（メーカー）</div>
        <div style="font-size:11px;color:var(--text-muted)">発注1回につき</div></div>
      <div style="font-size:12px;font-weight:600;color:var(--wood-t);min-width:62px;text-align:right">¥${fmt(ship)}</div>
    </div>`;
  }
  document.getElementById('cart-total').textContent=fmt(cartGrandTotal());
  updateOrderPreviewBtnState();
}
function changeQty(i,d){
  cart[i].qty=Math.max(1,cart[i].qty+d);
  renderCart();renderItemSelectList();
}
function removeCartItem(i){cart.splice(i,1);renderCart();renderItemSelectList();}
function clearCart(){cart=[];renderCart();renderItemSelectList();}
