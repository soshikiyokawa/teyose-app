// ════ 受発注：発注履歴・原価管理 ════

function renderOrders(){
  const el=document.getElementById('orders-list');
  el.innerHTML=orders.length?orders.map((o,i)=>`
    <div class="order-item">
      <div class="order-hd"><span class="order-no">${o.no}</span><span class="order-name">${o.project}</span>
        <span class="badge ${o.status==='received'?'received':'pending'}">${o.status==='received'?'受領済み':'発注済み'}</span>
      </div>
      <div class="order-meta"><span>📅 ${o.date}</span><span>🏪 ${o.suppliers}</span><span>📦 ${o.items.length}品目</span>${o.costType?`<span>🏷️ ${o.costType}</span>`:''}<span style="font-weight:700;color:var(--wood-t)">¥${fmt(o.total)}</span></div>
      <div class="order-actions">
        <button class="btn sm" onclick="reShowOrder(${i})"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> 発注書</button>
        ${o.status!=='received'?`<button class="btn sm primary" onclick="markReceived(${i})">✓ 受領済み</button>`:''}
        <button class="btn sm danger" onclick="deleteOrderFromHistory(${i})">削除</button>
      </div>
    </div>`).join(''):'<div class="empty">発注履歴はありません</div>';
}

async function deleteOrderFromHistory(i){
  const o=orders[i];
  if(!o) return;
  if(!confirm(`発注「${o.no}」を削除しますか？\n関連する原価データも削除されます。`)) return;
  try{
    await dbDeleteOrder(o.no,o.suppliers);
  }catch(e){return;}
  orders=orders.filter(x=>x.no!==o.no);
  costEntries=costEntries.filter(x=>x.orderNo!==o.no);
  renderOrders();renderCost();
  showToast('発注履歴を削除しました');
}
function reShowOrder(i){
  document.getElementById('order-pdf-body').innerHTML=`<div style="padding:20px;font-size:13px;color:#555;line-height:2"><strong>${orders[i].no}</strong><br>発注日：${orders[i].date}<br>物件：${orders[i].project}<br>発注先：${orders[i].suppliers}<br>合計：¥${fmt(orders[i].total)}<br><br>${orders[i].items.map(it=>`・${it.name} × ${it.qty}${it.unit}　¥${fmt(it.price*it.qty)}`).join('<br>')}</div>`;
  document.getElementById('order-pdf-foot').style.display='none';
  document.getElementById('order-pdf-overlay').classList.add('open');
}
async function markReceived(i){
  try{
    await dbMarkOrderReceived(orders[i].no, orders[i].suppliers);
  }catch(e){return;}
  orders[i].status='received';
  costEntries.filter(e=>e.orderNo===orders[i].no).forEach(e=>e.status='received');
  renderOrders();renderCost();
}

function renderCost(){
  const total=costEntries.reduce((s,e)=>s+e.amount,0);
  const pending=costEntries.filter(e=>e.status==='pending').length;
  document.getElementById('c-total').textContent='¥'+fmt(total);
  document.getElementById('c-count').textContent=costEntries.length+'件';
  document.getElementById('c-pending').textContent=pending+'件';
  const el=document.getElementById('cost-list');
  el.innerHTML=costEntries.length?costEntries.map(e=>`
    <div class="cost-row">
      <div class="cost-row-top"><div class="cost-row-name">${e.name}</div><div class="cost-row-amt">¥${fmt(e.amount)}</div></div>
      <div class="cost-row-meta"><span>${e.date}</span><span>${e.project}</span><span>${e.qty}${e.unit}</span><span>${e.supplier}</span>${e.costType?`<span>🏷️ ${e.costType}</span>`:''}<span class="badge ${e.status==='received'?'received':'pending'}">${e.status==='received'?'受領済み':'発注済み'}</span>
        <button class="btn danger xs" onclick="deleteCostEntry(${e.id})" style="margin-left:auto">削除</button>
      </div>
    </div>`).join(''):'<div class="empty">発注データがありません</div>';
}

async function deleteCostEntry(id){
  const e=costEntries.find(x=>x.id===id);
  if(!e) return;
  if(!confirm(`「${e.name}」の原価データを削除しますか？`)) return;
  try{
    await dbDeleteCostEntry(id);
  }catch(err){return;}
  costEntries=costEntries.filter(x=>x.id!==id);
  renderCost();
  showToast('原価データを削除しました');
}
