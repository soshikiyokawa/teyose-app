// ════ 発注済みの単価を、発注先があとから直す ════
//
// 単価が決まらないまま発注することがあるので、あとから発注先に入れてもらう。
//   ・変更すると、変更前と変更後の単価が発注に残る（誰が・いつ・いくらから いくらへ）
//   ・原価管理の金額も同時に直る
//   ・きよかわの社員に通知が飛び、チャットにも記録が残る
//
// 書き換えそのものは Edge Function（update-order-price）が行う。
// 発注先にデータベースを直接いじらせると、品目や数量まで変えられてしまうため。
// きよかわの社員も同じ画面から直せる（発注先に代わって入れる場合）。

let opeOrderNo = '';    // いま直している発注番号
let opeItems = [];      // {index, name, qty, unit, before, after}

// その発注に単価変更があったか
function orderHasPriceEdit(o){ return Array.isArray(o?.priceEdits) && o.priceEdits.length > 0; }

// 品目の当初の単価（直していなければ今の単価）
function itemOrigPrice(it){
  const v = (it.origPrice === undefined || it.origPrice === null) ? (it.cost ?? it.price) : it.origPrice;
  return Math.round(Number(v) || 0);
}
function itemNowPrice(it){ return Math.round(Number(it.cost ?? it.price) || 0); }

// 発注番号から発注を探す
function orderByNo(no){ return (orders || []).find(o => o.no === no) || null; }

// ── 画面を開く ──
function openOrderPriceEdit(orderNo){
  const o = orderByNo(orderNo);
  if(!o){ showToast('発注が見つかりません'); return; }
  const canEdit = currentUserRole === 'supplier' || currentUserRole === 'staff';
  if(!canEdit){ showToast('単価を直せるのは発注先ときよかわの管理者だけです'); return; }

  opeOrderNo = orderNo;
  opeItems = (o.items || []).map((it, index) => ({
    index,
    name: it.name || '',
    qty: Number(it.qty) || 0,
    unit: it.unit || '式',
    orig: itemOrigPrice(it),
    before: itemNowPrice(it),
    after: itemNowPrice(it),
  }));
  document.getElementById('ope-title').textContent = `単価を直す（${orderNo}）`;
  document.getElementById('ope-meta').textContent = `${o.date}　${o.project}　${o.suppliers}`;
  document.getElementById('ope-note').value = '';
  renderOrderPriceEdit();
  document.getElementById('ope-modal').classList.add('open');
}
function closeOrderPriceEdit(){ document.getElementById('ope-modal').classList.remove('open'); }

function setOpePrice(i, v){
  const n = Math.max(0, Math.round(parseFloat(String(v).replace(/,/g,'')) || 0));
  opeItems[i].after = n;
  renderOrderPriceEdit();
}

function renderOrderPriceEdit(){
  const wrap = document.getElementById('ope-list');
  if(!wrap) return;
  wrap.innerHTML = opeItems.map((it, i) => {
    const changed = it.after !== it.before;
    return `
    <div class="ope-row${changed ? ' changed' : ''}">
      <div class="ope-name">${esc(it.name)}<span>${it.qty}${esc(it.unit)}</span></div>
      <div class="ope-price">
        <div class="ope-before">
          <span>いまの単価</span>
          <b>¥${fmt(it.before)}</b>
        </div>
        <div class="ope-arrow">→</div>
        <div class="ope-after">
          <span>直した単価</span>
          <input type="number" min="0" step="1" value="${it.after}"
                 oninput="setOpePrice(${i}, this.value)">
        </div>
      </div>
      <div class="ope-amt">${changed
        ? `<span class="old">¥${fmt(it.before * it.qty)}</span> <b>¥${fmt(it.after * it.qty)}</b>`
        : `<b>¥${fmt(it.after * it.qty)}</b>`}</div>
    </div>`;
  }).join('');

  const subBefore = opeItems.reduce((s,it)=>s + it.before*it.qty, 0);
  const subAfter  = opeItems.reduce((s,it)=>s + it.after*it.qty, 0);
  const totBefore = subBefore + Math.round(subBefore*0.1);
  const totAfter  = subAfter  + Math.round(subAfter*0.1);
  const n = opeItems.filter(it=>it.after!==it.before).length;
  document.getElementById('ope-total').innerHTML = n
    ? `<div class="ope-sum-line">小計 <span class="old">¥${fmt(subBefore)}</span> → <b>¥${fmt(subAfter)}</b></div>
       <div class="ope-sum-line big">合計 <span class="old">¥${fmt(totBefore)}</span> → <b>¥${fmt(totAfter)}</b></div>
       <div class="ope-sum-note">${n}品目の単価を直します</div>`
    : `<div class="ope-sum-line big">合計 <b>¥${fmt(totAfter)}</b></div>
       <div class="ope-sum-note">単価を直すと、ここに変更後の金額が出ます</div>`;
  const btn = document.getElementById('ope-save-btn');
  if(btn) btn.disabled = !n;
}

// ── 保存 ──
async function saveOrderPriceEdit(){
  const changed = opeItems.filter(it => it.after !== it.before);
  if(!changed.length){ showToast('単価が変わっていません'); return; }
  const o = orderByNo(opeOrderNo);
  const note = document.getElementById('ope-note').value.trim();

  const lines = changed.map(it => `${it.name}　¥${fmt(it.before)} → ¥${fmt(it.after)}`).join('\n');
  if(!confirm(`次の単価を直します。\n\n${lines}\n\nきよかわの社員に通知され、原価管理の金額も変わります。よろしいですか？`)) return;

  const btn = document.getElementById('ope-save-btn');
  if(btn){ btn.disabled = true; btn.textContent = '保存中…'; }
  try{
    const { data, error } = await sb.functions.invoke('update-order-price', {
      body: { orderNo: opeOrderNo, note, prices: changed.map(it=>({ index: it.index, price: it.after })) }
    });
    if(error || data?.error) throw new Error(await opeErrorText(error, data));

    closeOrderPriceEdit();
    showToast(`${changed.length}品目の単価を直しました`);
    // 通知とチャットへの記録（失敗しても単価の変更自体は成立している）
    notifyOrderPriceEdit(o, changed, data).catch(()=>{});
    await refetchOrdersAndCost();
  }catch(e){
    showToast('単価の変更に失敗しました：' + e.message);
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = 'この内容で直す'; }
  }
}

async function opeErrorText(error, data){
  if(data?.error) return data.error;
  if(error?.context && typeof error.context.json === 'function'){
    try{ const j = await error.context.json(); if(j?.error) return j.error; }catch(_){}
  }
  return error?.message || '不明なエラー';
}

// きよかわの社員へ通知し、その発注先とのチャットにも記録を残す
async function notifyOrderPriceEdit(order, changed, data){
  const who = currentUserDisplayName || '';
  const lines = changed.map(it => `・${it.name}　¥${fmt(it.before)} → ¥${fmt(it.after)}`).join('\n');
  const body = `${order.no}（${order.project}）の単価が変わりました\n${lines}\n合計 ¥${fmt(order.total)} → ¥${fmt(data.total)}`;

  // 社員全員（管理者＋一般社員）へ。自分が社員の場合は自分を除く
  await dbSendPush('employee', null, `単価の変更：${order.suppliers}`, body, currentUserId, 'order/history')
    .catch(()=>{});
  // その発注先とのチャットにも残す（通知はもう送ったので silent）
  await dbAddChatMessage(order.suppliers, {
    role: currentUserRole === 'supplier' ? 'them' : 'me',
    type: 'text', silent: true,
    text: `【単価の変更】${order.no}\n${lines}\n合計 ¥${fmt(order.total)} → ¥${fmt(data.total)}${
      document.getElementById('ope-note')?.value ? '\n' + document.getElementById('ope-note').value : ''}`
  }).catch(()=>{});
}

// 発注と原価を取り直して、開いている画面に反映する
async function refetchOrdersAndCost(){
  try{
    const { data: rows } = await sb.from('orders').select('*').order('created_at',{ascending:false});
    if(rows) orders = rows.map(r=>({id:r.id,no:r.no,project:r.project,date:r.date,dueDate:r.due_date,
      costType:r.cost_type,paymentMethod:r.payment_method||'',suppliers:supplierNameById(r.supplier_id),
      items:r.items,subtotal:Number(r.subtotal),tax:Number(r.tax),total:Number(r.total),
      status:r.status,receivedAt:r.received_at||'',priceEdits:r.price_edits||[]}));
    if(currentUserRole==='staff' || currentUserRole==='carpenter'){
      const { data: cr } = await sb.from('cost_entries').select('*').order('created_at',{ascending:false});
      if(cr) costEntries = cr.map(r=>({id:r.id,date:r.date,project:r.project,name:r.name,qty:Number(r.qty),
        unit:r.unit,amount:Number(r.amount),supplier:supplierNameById(r.supplier_id),
        orderNo:r.order_no,costType:r.cost_type,status:r.status}));
    }
  }catch(e){ console.warn('発注の取り直しに失敗', e); }
  if(typeof renderOrders==='function') try{ renderOrders(); }catch(_){}
  if(typeof renderCost==='function') try{ renderCost(); }catch(_){}
  if(typeof renderTalkPanelMessages==='function' && typeof activeTalkPanelSupplier!=='undefined' && activeTalkPanelSupplier){
    try{ resetChatRenderSignature(); renderTalkPanelMessages(); }catch(_){}
  }
}

// ── 変更履歴の表示（きよかわ側・発注先側の両方で使う） ──
function orderPriceEditHtml(o){
  if(!orderHasPriceEdit(o)) return '';
  const rows = o.priceEdits.map(e=>{
    const when = String(e.at||'').slice(0,16).replace('T',' ').replace(/-/g,'/');
    const ch = (e.changes||[]).map(c=>
      `<div class="ope-hist-row"><span>${esc(c.name)}</span>
        <span><span class="old">¥${fmt(c.before)}</span> → <b>¥${fmt(c.after)}</b></span></div>`).join('');
    return `<div class="ope-hist">
      <div class="ope-hist-head">${when}　${esc(e.byName||'')}${e.byRole==='supplier'?'（発注先）':''}が変更</div>
      ${ch}
      <div class="ope-hist-total">合計 <span class="old">¥${fmt(e.total?.before)}</span> → <b>¥${fmt(e.total?.after)}</b></div>
      ${e.note?`<div class="ope-hist-note">${esc(e.note)}</div>`:''}
    </div>`;
  }).join('');
  return `<div class="ope-hist-wrap"><div class="ope-hist-title">単価の変更（${o.priceEdits.length}回）</div>${rows}</div>`;
}
