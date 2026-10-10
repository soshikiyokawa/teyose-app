// ════ 発注のキャンセル（発注したあとで、やめる品目が出たとき） ════
//
// 流れ：
//   1. きよかわが、電話などで業者さんにキャンセルを伝える
//   2. 業者さんが「納品」タブで、その品目を「キャンセル品」に指定する（js/order/order-delivery.js）
//   3. きよかわの社員（管理者・一般社員）が、発注履歴の「キャンセル品を確認」から承認する（このファイル）
//      → 承認して、はじめてキャンセルになる。ちがっていれば差し戻す
//
// キャンセルになった品目は、
//   ・業者さんの「納品」タブと、受領のときの納品予定日の入力から消える
//   ・原価管理からも、その品目の金額が消える
//
// 品目そのもの（items）は消さずに残し、別の列に持つ（migration-genba96.sql）。
//   orders.cancel_requests … 業者さんが指定して、確認を待っているもの
//   orders.cancelled_items … 承認して、キャンセルになったもの
// 発注書に何を頼んでいたかが、あとから分かるように。
//
// 承認したキャンセルの取り消しは無い。まちがえたときは、その品目を発注し直す。

let orderCxl = null;   // {no, rows:[{i,name,qty,unit,by,sel}]}

// ── 読み出し ──

// キャンセルした品目の数と、もとの品目の数（送料の行は除く）
function orderCancelCount(o){
  const all = (o?.items||[]).map((it,i)=>({it,i})).filter(x=>!x.it.isShipping);
  return { cancelled: all.filter(x=>orderItemCancelled(o, x.i)).length, all: all.length };
}
// 'all' … まるごとキャンセル／'part' … 一部／'' … キャンセルなし
function orderCancelState(o){
  const c = orderCancelCount(o);
  if(!c.cancelled) return '';
  return c.cancelled >= c.all ? 'all' : 'part';
}
// 業者さんが「キャンセル品」に指定して、確認を待っている品目
function orderCancelPending(o){
  return (o?.items||[]).map((it,i)=>({it,i}))
    .filter(x=>!x.it.isShipping && !orderItemCancelled(o, x.i) && orderCancelRequested(o, x.i));
}
// 確認待ちが1つでもある発注の数（社員に知らせるのに使う）
function orderCancelPendingTotal(){
  return (orders||[]).filter(o=>orderCancelPending(o).length).length;
}
// いまも生きている品目。まるごとキャンセルなら、送料の行も数えない
function orderLiveItems(o){
  const st = orderCancelState(o);
  if(!st) return o?.items||[];
  if(st==='all') return [];
  return (o.items||[]).filter((it,i)=>!orderItemCancelled(o, i));
}
// キャンセルを除いた合計（税込）。キャンセルが無ければ、発注のときの合計そのまま
function orderLiveTotal(o){
  if(!orderCancelState(o)) return Number(o?.total)||0;
  return orderTaxBreakdown(orderLiveItems(o)).total;
}
// 一覧に出す札
function orderCancelBadge(o){
  const st = orderCancelState(o);
  const c = orderCancelCount(o);
  const wait = orderCancelPending(o).length;
  return (st==='all' ? '<span class="badge cancelled">キャンセル</span>'
        : st==='part' ? `<span class="badge cancelled">一部キャンセル ${c.cancelled}/${c.all}</span>` : '')
       + (wait ? `<span class="badge cancel-wait">キャンセル品の確認待ち ${wait}</span>` : '');
}
// 合計の書き方。キャンセルがあれば、もとの合計に線を引いて添える
function orderTotalHtml(o){
  if(!orderCancelState(o)) return `¥${fmt(o.total)}`;
  return `<span class="ope-old">¥${fmt(o.total)}</span> ¥${fmt(orderLiveTotal(o))}`;
}

// ── 開く（業者さんが指定したキャンセル品を確認する） ──

function openOrderCancel(orderNo){
  const o = (orders||[]).find(x=>x.no===orderNo);
  if(!o){ showToast('発注が見つかりません。画面を更新してからお試しください'); return; }
  if(currentUserRole!=='staff' && currentUserRole!=='carpenter'){ showToast('キャンセル品を確認できるのは、きよかわの社員だけです'); return; }
  const rows = orderCancelPending(o).map(({it,i})=>{
    const req = orderCancelRequestOf(o, i);
    return { i, name: it.name||'', qty: it.qty, unit: it.unit||'', by: req?.by||'', at: req?.at||'', sel: true };
  });
  if(!rows.length){ showToast('確認を待っているキャンセル品はありません'); if(typeof renderOrders==='function') renderOrders(); return; }
  orderCxl = { no: orderNo, rows };
  document.getElementById('ordcxl-sub').textContent = `${o.no}　${o.project||''}　${o.suppliers||''}`;
  orderCxlRender();
  document.getElementById('ordcxl-modal').classList.add('open');
}
function closeOrderCancel(){
  document.getElementById('ordcxl-modal').classList.remove('open');
  orderCxl = null;
}

function orderCxlRender(){
  const st = orderCxl; if(!st) return;
  document.getElementById('ordcxl-list').innerHTML = st.rows.map((r,k)=>`
    <div class="orv-row${r.sel?' sel':''}">
      <input type="checkbox" class="orv-ck" ${r.sel?'checked':''}
        onchange="orderCxlSelect(${k}, this.checked)" aria-label="この品目を選ぶ">
      <div class="orv-main" onclick="orderCxlSelect(${k})">
        <div class="orv-name">${esc(r.name)}</div>
        <div class="orv-meta">${esc(String(r.qty??''))}${esc(r.unit)}${r.by?`　指定：${esc(r.by)}`:''}${
          r.at?`（${esc(String(r.at).slice(5,10).replace('-','/'))}）`:''}</div>
      </div>
    </div>`).join('');
  const nSel = st.rows.filter(r=>r.sel).length;
  const all = document.getElementById('ordcxl-all');
  all.checked = nSel===st.rows.length;
  all.indeterminate = nSel>0 && nSel<st.rows.length;
  document.getElementById('ordcxl-note').textContent = nSel
    ? `${nSel}品目を選んでいます。承認するとキャンセルになり、原価管理からも金額が消えます`
    : '品目を選んでください';
  document.getElementById('ordcxl-save').disabled = !nSel;
  document.getElementById('ordcxl-reject').disabled = !nSel;
  document.getElementById('ordcxl-save').textContent = nSel ? `承認する（${nSel}品目をキャンセル）` : '承認する';
}
function orderCxlSelect(k, on){
  const r = orderCxl?.rows[k]; if(!r) return;
  r.sel = (on===undefined) ? !r.sel : !!on;
  orderCxlRender();
}
function orderCxlSelectAll(on){
  if(!orderCxl) return;
  orderCxl.rows.forEach(r=>{ r.sel = !!on; });
  orderCxlRender();
}

function orderCxlNotReady(error){
  const code = String(error?.code||''), msg = String(error?.message||'');
  return code==='PGRST202' || code==='42883'
    || /app_cancel_order_items|app_withdraw_cancel|app_request_cancel|cancelled_items|cancel_requests/.test(msg) && /find|exist|schema cache/i.test(msg);
}
function orderCxlFail(error, what){
  showToast(orderCxlNotReady(error)
    ? 'データベースの準備が必要です。supabase/migration-genba96.sql を実行してください'
    : `${what}：${error?.message||'通信できませんでした'}`, 7000);
}
function orderCxlButtons(off){
  ['ordcxl-save','ordcxl-reject'].forEach(id=>{ const b=document.getElementById(id); if(b) b.disabled = off; });
}

// ── 承認する（キャンセルにする） ──

async function saveOrderCancel(){
  const st = orderCxl; if(!st) return;
  const o = (orders||[]).find(x=>x.no===st.no);
  if(!o){ closeOrderCancel(); return; }
  const picked = st.rows.filter(r=>r.sel);
  if(!picked.length){ showToast('品目を選んでください'); return; }
  // 承認すると、生きている品目がひとつも残らないか（＝発注まるごとのキャンセル）
  const left = orderDeliverableItems(o).filter(x=>!picked.some(r=>r.i===x.i)).length;
  const whole = left===0;
  if(!confirm(`${o.suppliers||''} への発注 ${o.no} の、次の品目をキャンセルにします。\n\n`
    + picked.map(r=>`・${r.name} × ${r.qty??''}${r.unit}`).join('\n')
    + `\n\n${whole?'この発注は、すべてキャンセルになります（送料もなくなります）。':'残りの品目は、そのまま発注が続きます。'}`
    + `\n原価管理からも金額が消えます。元には戻せません。よろしいですか？`)) return;

  // まるごとキャンセルのときは、送料の行もいっしょにキャンセルする（原価からも消すため）
  const items = picked.map(r=>({ i:r.i, name:r.name }));
  if(whole){
    (o.items||[]).forEach((it,i)=>{ if(it.isShipping && !orderItemCancelled(o, i)) items.push({ i, name: it.name||'' }); });
  }

  orderCxlButtons(true);
  const { data, error } = await sb.rpc('app_cancel_order_items', { p_order_id: o.id, p_items: items, p_reason: '' });
  if(error){ orderCxlButtons(false); orderCxlFail(error, '承認できませんでした'); return; }
  if(Array.isArray(data?.cancelled_items)) o.cancelledItems = data.cancelled_items;
  const changed = Array.isArray(data?.changed) ? data.changed : [];
  // 今回あらたにキャンセルになった品目だけを知らせる（ほかの人が先に承認していた分は入れない）
  const told = picked.filter(r=>changed.some(c=>Number(c.i)===r.i));
  closeOrderCancel();
  // 原価は消えているので、取り直して画面に反映する
  if(typeof refetchOrdersAndCost==='function') await refetchOrdersAndCost();
  if(typeof orderRecvRefresh==='function') orderRecvRefresh();
  if(!told.length){ showToast('選んだ品目は、もうキャンセルになっていました'); return; }

  const now = (orders||[]).find(x=>x.no===o.no) || o;
  const lines = [`【キャンセル確定】発注書 ${o.no}（${o.project||''}）`,
    'キャンセル品のご指定を確認しました。次の品目はキャンセルです。',
    ...told.map(r=>`・${r.name} × ${r.qty??''}${r.unit}`)];
  lines.push(orderCancelState(now)==='all'
    ? 'この発注は、すべてキャンセルです。'
    : `残り ${orderDeliverableItems(now).length}品目は、そのままお願いします。`);
  let sent = true;
  try{ await dbAddChatMessage(o.suppliers, { role:'me', type:'text', text: lines.join('\n') }); }
  catch(_){ sent = false; }
  showToast(sent ? `${told.length}品目をキャンセルにしました。業者さんに伝わります`
                 : `${told.length}品目をキャンセルにしましたが、チャットに送れませんでした`, sent?3000:8000);
}

// ── 差し戻す（キャンセルではない。納品してもらう） ──

async function rejectOrderCancel(){
  const st = orderCxl; if(!st) return;
  const o = (orders||[]).find(x=>x.no===st.no);
  if(!o){ closeOrderCancel(); return; }
  const picked = st.rows.filter(r=>r.sel);
  if(!picked.length){ showToast('品目を選んでください'); return; }
  if(!confirm(`次の品目は、キャンセルにしません（業者さんの指定を差し戻します）。\n\n`
    + picked.map(r=>`・${r.name} × ${r.qty??''}${r.unit}`).join('\n')
    + `\n\n業者さんのチャットに伝わります。よろしいですか？`)) return;

  orderCxlButtons(true);
  const told = [];
  let failed = null;
  for(const r of picked){
    const { data, error } = await sb.rpc('app_withdraw_cancel', { p_order_id: o.id, p_i: r.i, p_name: r.name });
    if(error){ failed = error; break; }
    if(Array.isArray(data?.cancel_requests)) o.cancelRequests = data.cancel_requests;
    if(data?.changed) told.push(r);
  }
  closeOrderCancel();
  if(typeof orderRecvRefresh==='function') orderRecvRefresh();
  if(failed) orderCxlFail(failed, '差し戻せませんでした');
  if(!told.length) return;
  let sent = true;
  try{
    await dbAddChatMessage(o.suppliers, { role:'me', type:'text', text:
      [`【キャンセル品の差し戻し】発注書 ${o.no}（${o.project||''}）`,
       '次の品目は、キャンセルではありません。そのまま納品をお願いします。',
       ...told.map(r=>`・${r.name} × ${r.qty??''}${r.unit}`)].join('\n') });
  }catch(_){ sent = false; }
  showToast(sent ? `${told.length}品目を差し戻しました。業者さんに伝わります`
                 : `${told.length}品目を差し戻しましたが、チャットに送れませんでした`, sent?3000:8000);
}
