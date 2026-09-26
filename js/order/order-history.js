// ════ 受発注：発注履歴・原価管理 ════

function renderOrders(){
  const el=document.getElementById('orders-list');
  el.innerHTML=orders.length?orders.map((o,i)=>`
    <div class="order-item">
      <div class="order-hd"><span class="order-no">${o.no}</span><span class="order-name">${o.project}</span>
        <span class="badge ${o.status==='received'?'received':'pending'}">${o.status==='received'?'受領済み':'発注済み'}</span>
        ${orderHasPriceEdit(o)?'<span class="badge price-edited">単価変更あり</span>':''}
      </div>
      <div class="order-meta"><span>📅 ${o.date}</span><span>🏪 ${o.suppliers}</span><span>📦 ${o.items.length}品目</span>${o.costType?`<span>🏷️ ${o.costType}</span>`:''}${
        o.dueAsap?'<span style="color:var(--accent-t);font-weight:700">🚚 最短</span>':(o.dueDate?`<span>🚚 ${o.dueDate}</span>`:'')}<span style="font-weight:700;color:var(--wood-t)">¥${fmt(o.total)}</span></div>
      <div class="order-actions">
        <button class="btn sm" onclick="reShowOrder(${i})"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> 発注書</button>
        ${o.status!=='received'?`<button class="btn sm primary" onclick="markReceived(${i})">✓ 受領済み</button>`:''}
        <button class="btn sm" onclick="openOrderPriceEdit('${esc(o.no)}')">単価・送料を直す</button>
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
  const o=orders[i];
  const rows=o.items.map(it=>{
    const now=itemNowPrice(it), orig=itemOrigPrice(it), q=Number(it.qty)||0;
    return `・${esc(it.name)} × ${q}${esc(it.unit||'')}　${
      orig!==now ? `<span style="color:#999;text-decoration:line-through">¥${fmt(orig*q)}</span> ` : ''}¥${fmt(now*q)}`;
  }).join('<br>');
  document.getElementById('order-pdf-body').innerHTML=`<div style="padding:20px;font-size:13px;color:#555;line-height:2"><strong>${o.no}</strong><br>発注日：${o.date}<br>納品希望日：${orderDueLabel(o)}<br>${o.paymentMethod?'':`納品場所：${esc(orderDeliveryLabel(o))}<br>`}物件：${o.project}<br>発注先：${o.suppliers}<br>合計：¥${fmt(o.total)}<br><br>${rows}${orderPriceEditHtml(o)}</div>`;
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
function toggleCostStock(){ costViewStock=!costViewStock; if(costViewStock) costViewExpense=false; renderCost(); }

// 「経費を表示」：案件「経費」で登録した明細を、勘定科目ごと・月ごとに見る
// costExpenseMonth … 'YYYY-MM'。'' はすべての期間。null はまだ開いていない（開いたら今月にする）
let costViewExpense=false;
let costExpenseMonth=null;
function thisMonthStr(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
function toggleCostExpense(){
  costViewExpense=!costViewExpense;
  if(costViewExpense){ costViewStock=false; if(costExpenseMonth===null) costExpenseMonth=thisMonthStr(); }
  renderCost();
}
function setExpenseMonth(m){ costExpenseMonth=m||''; renderCost(); }

const fmtNinku=v=>{const r=Math.round(v*100)/100;return Number.isInteger(r)?r.toFixed(1):String(r);};

// ── 在庫計算（原価データから常に導出。別テーブルは持たない） ──
// 入庫＝案件「在庫分」で発注した明細／出庫＝発注先「在庫分」で現場向けに発注した明細
// 現在庫 ＝ 入庫数量 − 出庫数量。出庫単価は入庫の平均単価を使う
function calcStock(){
  const stock={}; // 品目名 -> {name, unit, inQty, inAmount, outQty, qty, avgCost}
  costEntries.forEach(e=>{
    const get=()=>stock[e.name]=stock[e.name]||{name:e.name,unit:e.unit,inQty:0,inAmount:0,outQty:0};
    if(e.project==='在庫分' && e.supplier!=='在庫分'){
      const s=get(); s.inQty+=e.qty; s.inAmount+=e.amount;
    }
    if(e.supplier==='在庫分' && e.project!=='在庫分'){
      const s=get(); s.outQty+=e.qty;
    }
  });
  Object.values(stock).forEach(s=>{
    s.qty=Math.round((s.inQty-s.outQty)*100)/100;
    s.avgCost=s.inQty ? s.inAmount/s.inQty : 0;
  });
  return stock;
}

// 在庫一覧（原価管理の「在庫分を表示」時のみ）
function renderStockInventory(){
  const el=document.getElementById('stock-inventory');
  const list=Object.values(calcStock()).sort((a,b)=>a.name.localeCompare(b.name,'ja'));
  if(!list.length){el.innerHTML='<div class="empty">在庫の記録がありません。<br>案件「在庫分」で発注すると入庫、発注先「在庫分」で現場向けに発注すると出庫されます</div>';return;}
  let totalValue=0;
  const rows=list.map(s=>{
    const value=Math.max(0,s.qty*s.avgCost);
    totalValue+=value;
    return `<tr${s.qty<=0?' style="color:var(--text-muted)"':''}>
      <td>${esc(s.name)}</td>
      <td style="text-align:center">${s.unit}</td>
      <td class="num">${s.inQty}</td>
      <td class="num">${s.outQty||'—'}</td>
      <td class="num" style="font-weight:800;${s.qty>0?'color:var(--accent-t)':s.qty<0?'color:var(--danger)':''}">${s.qty}</td>
      <td class="num">¥${fmt(s.avgCost)}</td>
      <td class="num">¥${fmt(value)}</td>
    </tr>`;
  }).join('');
  el.innerHTML=`<table class="items-table" style="width:100%;min-width:560px">
    <thead><tr><th>品目</th><th>単位</th><th class="r">入庫計</th><th class="r">出庫計</th><th class="r">現在庫</th><th class="r">平均単価</th><th class="r">在庫金額</th></tr></thead>
    <tbody>${rows}
      <tr style="background:var(--surface2)"><td colspan="6" style="font-weight:700;text-align:right">在庫金額 合計</td><td class="num" style="font-weight:800;color:var(--wood-t)">¥${fmt(totalValue)}</td></tr>
    </tbody>
  </table>`;
}

function renderCost(){
  const target = costViewStock ? '在庫分' : costViewExpense ? EXPENSE_PROJECT : (selectedProject?.name||null);
  document.getElementById('cost-proj-name').textContent = target||'（案件未選択）';
  document.getElementById('cost-stock-btn').classList.toggle('active', costViewStock);
  document.getElementById('cost-expense-btn')?.classList.toggle('active', costViewExpense);
  applyCostViewLabels();

  // 在庫一覧は「在庫分を表示」のときだけ出す
  document.getElementById('stock-inventory-wrap').style.display = costViewStock ? '' : 'none';
  if(costViewStock) renderStockInventory();
  // 月別の表は「経費を表示」のときだけ出す
  document.getElementById('expense-wrap').style.display = costViewExpense ? '' : 'none';

  if(costViewExpense){ renderExpenseView(); return; }

  if(!target){
    document.getElementById('c-total').textContent='¥0';
    document.getElementById('c-count').textContent='0件';
    document.getElementById('c-pending').textContent='0件';
    document.getElementById('c-ninku').textContent='—';
    document.getElementById('c-ninku-breakdown').style.display='none';
    const msg='<div class="empty">左の案件一覧から案件を選択してください</div>';
    ['cost-by-project','cost-by-supplier','cost-list'].forEach(id=>document.getElementById(id).innerHTML=msg);
    renderCostBudget && renderCostBudget();
    renderEstVsOrder && renderEstVsOrder();
    return;
  }

  const entries=costEntries.filter(e=>(e.project||'')===target);
  const total=entries.reduce((s,e)=>s+e.amount,0);
  const pending=entries.filter(e=>e.status==='pending').length;
  document.getElementById('c-total').textContent='¥'+fmt(total);
  document.getElementById('c-count').textContent=entries.length+'件';
  document.getElementById('c-pending').textContent=pending+'件';

  // 人工（日報の実働から累計。日報の追加・修正はRealtimeで即時反映される）
  const targetReports=dailyReports.filter(n=>n.projectName===target);
  const ninku=targetReports.reduce((s,n)=>s+nippoNinku(n),0);
  document.getElementById('c-ninku').textContent=ninku?fmtNinku(ninku)+'人工':'—';

  // 作業種別（新築：木工事／上棟／墨付け刻み）ごとの人工内訳
  const kindMin={};
  targetReports.forEach(n=>{ const k=n.workKind||''; kindMin[k]=(kindMin[k]||0)+nippoNinku(n); });
  const bd=document.getElementById('c-ninku-breakdown');
  const parts=['木工事','上棟','墨付け刻み'].filter(k=>kindMin[k]).map(k=>`${k} <b>${fmtNinku(kindMin[k])}</b>`);
  if(kindMin['']&&parts.length) parts.push(`種別なし <b>${fmtNinku(kindMin[''])}</b>`);
  bd.innerHTML = parts.length ? '人工内訳：'+parts.join('　／　') : '';
  bd.style.display = parts.length ? '' : 'none';

  renderCostBudget && renderCostBudget();
    renderEstVsOrder && renderEstVsOrder();
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
  // 3列だけなので、スマホでも横スクロールなしで収める（items-tableは幅800px固定のため使わない）
  el.innerHTML=`<table class="cost-type-table">
    <thead><tr><th>費目区分</th><th class="r">金額</th><th class="r">構成比</th></tr></thead>
    <tbody>
      ${types.map(t=>`<tr><td>${t}</td><td class="r">¥${fmt(byType[t])}</td><td class="r">${total?Math.round(byType[t]/total*100):0}%</td></tr>`).join('')}
      <tr class="total"><td>合計</td><td class="r">¥${fmt(total)}</td><td class="r">100%</td></tr>
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

// ════ 経費を表示 ════

// 見出しと数字の名前を、案件の原価用／経費用で切り替える
function applyCostViewLabels(){
  const ex = costViewExpense;
  const set = (id, t) => { const el=document.getElementById(id); if(el) el.textContent=t; };
  set('c-total-lbl',   ex ? '経費合計（税抜）' : '発注総額（原価）');
  set('c-count-lbl',   ex ? '明細の件数' : '発注件数');
  set('cost-type-lbl', ex ? '勘定科目別 集計' : '費目別 原価集計');
  set('cost-sup-lbl',  ex ? '支払先別 集計' : '発注先別 発注金額集計');
  set('cost-list-lbl', ex ? '経費の明細' : '発注明細（原価転記済み）');
  // 未受領・人工は経費には関係ないので出さない
  ['c-pending-box','c-ninku-box'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display = ex ? 'none' : ''; });
  const monthSel = document.getElementById('expense-month');
  if(monthSel) monthSel.hidden = !ex;
  if(ex) document.getElementById('c-ninku-breakdown').style.display='none';
}

const monthLabel = m => { const [y,mo]=String(m).split('-'); return `${y}年${Number(mo)}月`; };

function renderExpenseView(){
  // 予実・見積と実績は案件のためのものなので隠す（中で経費表示中かを見て隠れる）
  renderCostBudget && renderCostBudget();
  renderEstVsOrder && renderEstVsOrder();
  const all = costEntries.filter(e=>(e.project||'')===EXPENSE_PROJECT);
  const month = costExpenseMonth || '';

  // 期間の選択肢：経費がある月＋今月（新しい順）と、すべての期間
  const months = [...new Set([thisMonthStr(), ...all.map(e=>String(e.date||'').slice(0,7)).filter(Boolean)])].sort().reverse();
  const sel = document.getElementById('expense-month');
  sel.innerHTML = months.map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join('')
    + '<option value="">すべての期間</option>';
  sel.value = month;

  const entries = month ? all.filter(e=>String(e.date||'').slice(0,7)===month) : all;
  const total = entries.reduce((s,e)=>s+(Number(e.amount)||0),0);
  document.getElementById('c-total').textContent='¥'+fmt(total);
  document.getElementById('c-count').textContent=entries.length+'件';

  renderExpenseMonthly(all);

  const period = month ? monthLabel(month) : 'これまで';
  const empty = `<div class="empty">${period}の経費はまだありません。受発注でレシートを読み込み、案件で「経費」を選ぶと登録できます</div>`;
  if(!entries.length){
    ['cost-by-project','cost-by-supplier','cost-list'].forEach(id=>document.getElementById(id).innerHTML=empty);
    return;
  }
  renderExpenseByAccount(entries);
  renderCostBySupplier(entries);
  renderExpenseList(entries);
}

// 勘定科目ごとの合計。科目は決まった順に並べ、登録のない科目は出さない
function renderExpenseByAccount(entries){
  const by = {};
  entries.forEach(e=>{
    const k = e.costType || '未分類';
    (by[k] = by[k] || {amount:0, n:0});
    by[k].amount += Number(e.amount)||0; by[k].n++;
  });
  const order = EXPENSE_ACCOUNTS.map(a=>a.name);
  const keys = [...order.filter(k=>by[k]), ...Object.keys(by).filter(k=>!order.includes(k))];
  const total = entries.reduce((s,e)=>s+(Number(e.amount)||0),0);
  document.getElementById('cost-by-project').innerHTML = `<table class="cost-type-table">
    <thead><tr><th>勘定科目</th><th class="r">件数</th><th class="r">金額</th><th class="r">構成比</th></tr></thead>
    <tbody>
      ${keys.map(k=>`<tr><td title="${esc(EXPENSE_ACCOUNTS.find(a=>a.name===k)?.desc||'')}">${esc(k)}</td>
        <td class="r">${by[k].n}</td><td class="r">¥${fmt(by[k].amount)}</td>
        <td class="r">${total?Math.round(by[k].amount/total*100):0}%</td></tr>`).join('')}
      <tr class="total"><td>合計</td><td class="r">${entries.length}</td><td class="r">¥${fmt(total)}</td><td class="r">100%</td></tr>
    </tbody>
  </table>`;
}

// 月ごと × 勘定科目の表（期間の選択に関係なく、直近12か月ぶん）。
// 新しい月を左に置く（スマホで横に送らなくても最近の月が見えるように）。月の見出しを押すとその月に絞る
function renderExpenseMonthly(all){
  const el = document.getElementById('expense-monthly');
  if(!all.length){ el.innerHTML='<div class="empty">経費の登録はまだありません</div>'; return; }
  const months = [...new Set(all.map(e=>String(e.date||'').slice(0,7)).filter(Boolean))].sort().reverse().slice(0,12);
  const cell = {}, colTotal = {}, rowTotal = {};
  all.forEach(e=>{
    const m = String(e.date||'').slice(0,7);
    if(!months.includes(m)) return;
    const k = e.costType || '未分類', a = Number(e.amount)||0;
    cell[k+'|'+m] = (cell[k+'|'+m]||0) + a;
    colTotal[m] = (colTotal[m]||0) + a;
    rowTotal[k] = (rowTotal[k]||0) + a;
  });
  const order = EXPENSE_ACCOUNTS.map(a=>a.name);
  const keys = [...order.filter(k=>rowTotal[k]), ...Object.keys(rowTotal).filter(k=>!order.includes(k))];
  const grand = Object.values(rowTotal).reduce((s,v)=>s+v,0);
  const yen = v => v ? '¥'+fmt(v) : '<span class="muted">—</span>';
  el.innerHTML = `<table class="expense-matrix">
    <thead><tr><th class="acct">勘定科目</th>
      ${months.map(m=>`<th class="r"><button type="button" class="em-month${m===costExpenseMonth?' on':''}" onclick="setExpenseMonth('${m}')">${monthLabel(m).replace(/^\d+年/, s=>s.slice(2))}</button></th>`).join('')}
      <th class="r sum">合計</th></tr></thead>
    <tbody>
      ${keys.map(k=>`<tr><td class="acct">${esc(k)}</td>${months.map(m=>`<td class="r">${yen(cell[k+'|'+m])}</td>`).join('')}<td class="r sum">¥${fmt(rowTotal[k])}</td></tr>`).join('')}
      <tr class="total"><td class="acct">合計</td>${months.map(m=>`<td class="r">${yen(colTotal[m])}</td>`).join('')}<td class="r sum">¥${fmt(grand)}</td></tr>
    </tbody>
  </table>`;
}

// 経費の明細。支払方法は発注の側に持っているので、発注番号から引く
function renderExpenseList(entries){
  const payOf = no => (orders||[]).find(o=>o.no===no)?.paymentMethod || '';
  const rows = [...entries].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  document.getElementById('cost-list').innerHTML = rows.map(e=>{
    const pay = payOf(e.orderNo);
    return `<div class="cost-row">
      <div class="cost-row-top"><div class="cost-row-name">${esc(e.name)}</div><div class="cost-row-amt">¥${fmt(e.amount)}</div></div>
      <div class="cost-row-meta"><span>${e.date}</span><span>${e.qty}${esc(e.unit||'')}</span><span>${esc(e.supplier||'')}</span>
        ${e.costType?`<span>🏷️ ${esc(e.costType)}</span>`:''}${pay?`<span>${esc(pay)}</span>`:''}
        <button class="btn danger xs" onclick="deleteCostEntry(${e.id})" style="margin-left:auto">削除</button>
      </div>
    </div>`;
  }).join('');
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
