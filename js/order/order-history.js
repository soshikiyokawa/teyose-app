// ════ 受発注：発注履歴・原価管理 ════

function renderOrders(){
  const el=document.getElementById('orders-list');
  el.innerHTML=orders.length?orders.map((o,i)=>`
    <div class="order-item">
      <div class="order-hd"><span class="order-no">${o.no}</span><span class="order-name">${o.project}</span>
        <span class="badge ${o.status==='received'?'received':'pending'}">${o.status==='received'?'受領済み':'発注済み'}</span>
      </div>
      <div class="order-meta"><span>📅 ${o.date}</span><span>🏪 ${o.suppliers}</span><span>📦 ${o.items.length}品目</span><span style="font-weight:700;color:var(--wood-t)">¥${fmt(o.total)}</span></div>
      <div class="order-actions">
        <button class="btn sm" onclick="reShowOrder(${i})"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> 発注書</button>
        ${o.status!=='received'?`<button class="btn sm primary" onclick="markReceived(${i})">✓ 受領済み</button>`:''}
      </div>
    </div>`).join(''):'<div class="empty">発注履歴はありません</div>';
}
function reShowOrder(i){
  document.getElementById('order-pdf-body').innerHTML=`<div style="padding:20px;font-size:13px;color:#555;line-height:2"><strong>${orders[i].no}</strong><br>発注日：${orders[i].date}<br>物件：${orders[i].project}<br>発注先：${orders[i].suppliers}<br>合計：¥${fmt(orders[i].total)}<br><br>${orders[i].items.map(it=>`・${it.name} × ${it.qty}${it.unit}　¥${fmt(it.price*it.qty)}`).join('<br>')}</div>`;
  document.getElementById('order-pdf-foot').style.display='none';
  document.getElementById('order-pdf-overlay').classList.add('open');
}
function markReceived(i){
  orders[i].status='received';
  costEntries.filter(e=>e.orderNo===orders[i].no).forEach(e=>e.status='received');
  renderOrders();renderCost();
  scheduleAutosave();
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
      <div class="cost-row-meta"><span>${e.date}</span><span>${e.project}</span><span>${e.qty}${e.unit}</span><span>${e.supplier}</span><span class="badge ${e.status==='received'?'received':'pending'}">${e.status==='received'?'受領済み':'発注済み'}</span></div>
    </div>`).join(''):'<div class="empty">発注データがありません</div>';
}
