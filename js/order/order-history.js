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

const COST_TYPES=['材料費','外注費','労務費','諸経費'];

// 原価管理は選択中の案件単位で表示する（全体表示はしない）
// 「在庫分を表示」ボタンで、案件に紐づかない発注（在庫分）に切り替えられる
let costViewStock=false;
function toggleCostStock(){ costViewStock=!costViewStock; renderCost(); }

const fmtNinku=v=>{const r=Math.round(v*100)/100;return Number.isInteger(r)?r.toFixed(1):String(r);};

function renderCost(){
  const target = costViewStock ? '在庫分' : (selectedProject?.name||null);
  document.getElementById('cost-proj-name').textContent = target||'（案件未選択）';
  document.getElementById('cost-stock-btn').classList.toggle('active', costViewStock);

  if(!target){
    document.getElementById('c-total').textContent='¥0';
    document.getElementById('c-count').textContent='0件';
    document.getElementById('c-pending').textContent='0件';
    document.getElementById('c-ninku').textContent='—';
    const msg='<div class="empty">左の案件一覧から案件を選択してください</div>';
    ['cost-by-project','cost-by-supplier','cost-list'].forEach(id=>document.getElementById(id).innerHTML=msg);
    return;
  }

  const entries=costEntries.filter(e=>(e.project||'')===target);
  const total=entries.reduce((s,e)=>s+e.amount,0);
  const pending=entries.filter(e=>e.status==='pending').length;
  document.getElementById('c-total').textContent='¥'+fmt(total);
  document.getElementById('c-count').textContent=entries.length+'件';
  document.getElementById('c-pending').textContent=pending+'件';

  // 人工（日報の実働から累計。日報の追加・修正はRealtimeで即時反映される）
  const ninku=dailyReports.filter(n=>n.projectName===target).reduce((s,n)=>s+n.workMinutes/480,0);
  document.getElementById('c-ninku').textContent=ninku?fmtNinku(ninku)+'人工':'—';

  renderCostByType(entries);
  renderCostBySupplier(entries);

  const el=document.getElementById('cost-list');
  el.innerHTML=entries.length?entries.map(e=>`
    <div class="cost-row">
      <div class="cost-row-top"><div class="cost-row-name">${e.name}</div><div class="cost-row-amt">¥${fmt(e.amount)}</div></div>
      <div class="cost-row-meta"><span>${e.date}</span><span>${e.qty}${e.unit}</span><span>${e.supplier}</span>${e.costType?`<span>🏷️ ${e.costType}</span>`:''}<span class="badge ${e.status==='received'?'received':'pending'}">${e.status==='received'?'受領済み':'発注済み'}</span>
        <button class="btn danger xs" onclick="deleteCostEntry(${e.id})" style="margin-left:auto">削除</button>
      </div>
    </div>`).join(''):'<div class="empty">この案件の発注データはありません</div>';
}

// 選択中の案件の費目区分（材料費／外注費／労務費／諸経費）別の合計
function renderCostByType(entries){
  const el=document.getElementById('cost-by-project');
  if(!entries.length){el.innerHTML='<div class="empty">この案件の発注データはありません</div>';return;}
  const byType={};
  entries.forEach(e=>{
    const t=e.costType||'未分類';
    byType[t]=(byType[t]||0)+e.amount;
  });
  const types=[...COST_TYPES.filter(t=>byType[t]), ...Object.keys(byType).filter(t=>!COST_TYPES.includes(t))];
  const total=entries.reduce((s,e)=>s+e.amount,0);
  el.innerHTML=`<table class="items-table" style="width:100%">
    <thead><tr><th>費目区分</th><th class="r">金額</th><th class="r">構成比</th></tr></thead>
    <tbody>
      ${types.map(t=>`<tr><td>${t}</td><td class="num">¥${fmt(byType[t])}</td><td class="num">${total?Math.round(byType[t]/total*100):0}%</td></tr>`).join('')}
      <tr style="background:var(--surface2)"><td style="font-weight:700">合計</td><td class="num" style="font-weight:800;color:var(--wood-t)">¥${fmt(total)}</td><td class="num">100%</td></tr>
    </tbody>
  </table>`;
}

// 選択中の案件内での、発注先（業者）ごとの発注金額の合計
function renderCostBySupplier(entries){
  const el=document.getElementById('cost-by-supplier');
  if(!entries.length){el.innerHTML='<div class="empty">この案件の発注データはありません</div>';return;}
  const bySupplier={};
  entries.forEach(e=>{
    const s=e.supplier||'（発注先未設定）';
    bySupplier[s]=(bySupplier[s]||0)+e.amount;
  });
  const rows=Object.entries(bySupplier).sort((a,b)=>b[1]-a[1]);
  const total=rows.reduce((s,[,v])=>s+v,0);
  el.innerHTML=rows.map(([name,amount])=>`
    <div class="cost-row">
      <div class="cost-row-top"><div class="cost-row-name">🏪 ${name}</div><div class="cost-row-amt">¥${fmt(amount)}</div></div>
    </div>`).join('')+`
    <div class="cost-row" style="background:var(--surface2)">
      <div class="cost-row-top"><div class="cost-row-name" style="font-weight:700">合計</div><div class="cost-row-amt" style="font-weight:800;color:var(--wood-t)">¥${fmt(total)}</div></div>
    </div>`;
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
