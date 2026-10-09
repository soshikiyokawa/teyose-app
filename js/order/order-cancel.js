// ════ 発注のキャンセル（発注したあとで、やめる品目が出たとき） ════
//
// きよかわの管理者が、発注履歴の「キャンセル」から行う。
//   ・品目ごとに選べる（ぜんぶ選べば、発注まるごとのキャンセル）
//   ・キャンセルした品目は、業者さんの「納品」タブと、受領のときの納品予定日の入力から消える
//   ・原価管理からも、その品目の金額が消える
//   ・その業者さんとのチャットに1通入り、通知も行く
//
// 品目そのもの（items）は消さずに残し、「どれをキャンセルしたか」を別の列に持つ
// （orders.cancelled_items。migration-genba96.sql）。発注書に何を頼んでいたかが、あとから分かるように。
// すでに「納品完了」になっている品目は、キャンセルできない（先に納品完了を取り消す）。
//
// キャンセルの取り消しは無い。まちがえたときは、その品目を発注し直す。

let orderCxl = null;   // {no, rows:[{i,name,qty,unit,state:''|'cancelled'|'delivered', sel}]}

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
  if(!st) return '';
  const c = orderCancelCount(o);
  return st==='all' ? '<span class="badge cancelled">キャンセル</span>'
                    : `<span class="badge cancelled">一部キャンセル ${c.cancelled}/${c.all}</span>`;
}
// 合計の書き方。キャンセルがあれば、もとの合計に線を引いて添える
function orderTotalHtml(o){
  if(!orderCancelState(o)) return `¥${fmt(o.total)}`;
  return `<span class="ope-old">¥${fmt(o.total)}</span> ¥${fmt(orderLiveTotal(o))}`;
}

// ── 開く ──

function openOrderCancel(orderNo){
  const o = (orders||[]).find(x=>x.no===orderNo);
  if(!o){ showToast('発注が見つかりません。画面を更新してからお試しください'); return; }
  if(currentUserRole!=='staff'){ showToast('キャンセルできるのは、きよかわの管理者だけです'); return; }
  const rows = (o.items||[]).map((it,i)=>({it,i})).filter(x=>!x.it.isShipping).map(({it,i})=>({
    i, name: it.name||'', qty: it.qty, unit: it.unit||'',
    state: orderItemCancelled(o, i) ? 'cancelled'
         : (typeof orderDeliveredOf==='function' && orderDeliveredOf(o, i)) ? 'delivered' : '',
    sel: false }));
  orderCxl = { no: orderNo, rows };
  document.getElementById('ordcxl-sub').textContent = `${o.no}　${o.project||''}　${o.suppliers||''}`;
  document.getElementById('ordcxl-reason').value = '';
  orderCxlRender();
  document.getElementById('ordcxl-modal').classList.add('open');
}
function closeOrderCancel(){
  document.getElementById('ordcxl-modal').classList.remove('open');
  orderCxl = null;
}

function orderCxlRender(){
  const st = orderCxl; if(!st) return;
  document.getElementById('ordcxl-list').innerHTML = st.rows.map((r,k)=>{
    const off = !!r.state;
    return `<div class="orv-row${r.sel?' sel':''}${r.state==='cancelled'?' cxl':''}">
      <input type="checkbox" class="orv-ck" ${r.sel?'checked':''} ${off?'disabled':''}
        onchange="orderCxlSelect(${k}, this.checked)" aria-label="この品目をキャンセルする">
      <div class="orv-main" ${off?'':`onclick="orderCxlSelect(${k})"`}>
        <div class="orv-name">${esc(r.name)}</div>
        <div class="orv-meta">${esc(String(r.qty??''))}${esc(r.unit)}${
          r.state==='cancelled' ? '<span class="orv-late">キャンセル済み</span>'
          : r.state==='delivered' ? '<span class="orv-late">納品済み（キャンセルできません）</span>' : ''}</div>
      </div>
    </div>`;
  }).join('') || '<div class="empty" style="padding:18px">キャンセルできる品目がありません</div>';

  const can  = st.rows.filter(r=>!r.state);
  const nSel = can.filter(r=>r.sel).length;
  const all = document.getElementById('ordcxl-all');
  all.checked = can.length>0 && nSel===can.length;
  all.indeterminate = nSel>0 && nSel<can.length;
  all.disabled = !can.length;
  // 残っている品目をぜんぶ選んだら、発注まるごとのキャンセルになる
  const whole = nSel>0 && nSel===can.length && !st.rows.some(r=>r.state==='delivered');
  document.getElementById('ordcxl-note').textContent =
    !nSel ? 'キャンセルする品目を選んでください'
    : whole ? 'この発注は、すべてキャンセルになります（送料もなくなります）'
    : `${nSel}品目をキャンセルします。残りの品目は、そのまま発注が続きます`;
  const btn = document.getElementById('ordcxl-save');
  btn.disabled = !nSel;
  btn.textContent = nSel ? `キャンセルする（${nSel}品目）` : 'キャンセルする';
}
function orderCxlSelect(k, on){
  const r = orderCxl?.rows[k]; if(!r || r.state) return;
  r.sel = (on===undefined) ? !r.sel : !!on;
  orderCxlRender();
}
function orderCxlSelectAll(on){
  if(!orderCxl) return;
  orderCxl.rows.forEach(r=>{ if(!r.state) r.sel = !!on; });
  orderCxlRender();
}

// ── 保存 ──

async function saveOrderCancel(){
  const st = orderCxl; if(!st) return;
  const o = (orders||[]).find(x=>x.no===st.no);
  if(!o){ closeOrderCancel(); return; }
  const picked = st.rows.filter(r=>r.sel && !r.state);
  if(!picked.length){ showToast('キャンセルする品目を選んでください'); return; }
  const reason = document.getElementById('ordcxl-reason').value.trim();
  const left = st.rows.filter(r=>!r.state && !r.sel).length + st.rows.filter(r=>r.state==='delivered').length;
  const whole = left===0;
  if(!confirm(`${o.suppliers||''} への発注 ${o.no} の、次の品目をキャンセルします。\n\n`
    + picked.map(r=>`・${r.name} × ${r.qty??''}${r.unit}`).join('\n')
    + `\n\n${whole?'この発注は、すべてキャンセルになります。':'残りの品目は、そのまま発注が続きます。'}`
    + `\n業者さんのチャットに伝わり、原価管理からも金額が消えます。元には戻せません。よろしいですか？`)) return;

  // まるごとキャンセルのときは、送料の行もいっしょにキャンセルする（原価からも消すため）
  const items = picked.map(r=>({ i:r.i, name:r.name }));
  if(whole){
    (o.items||[]).forEach((it,i)=>{ if(it.isShipping && !orderItemCancelled(o, i)) items.push({ i, name: it.name||'' }); });
  }

  const btn = document.getElementById('ordcxl-save');
  btn.disabled = true;
  const { data, error } = await sb.rpc('app_cancel_order_items',
    { p_order_id: o.id, p_items: items, p_reason: reason });
  if(error){
    btn.disabled = false;
    const code = String(error.code||''), msg = String(error.message||'');
    showToast((code==='PGRST202' || code==='42883' || /app_cancel_order_items|cancelled_items/.test(msg) && /find|exist|schema cache/i.test(msg))
      ? 'データベースの準備が必要です。supabase/migration-genba96.sql を実行してください'
      : 'キャンセルできませんでした：'+msg, 7000);
    return;
  }
  if(Array.isArray(data?.cancelled_items)) o.cancelledItems = data.cancelled_items;
  const changed = Array.isArray(data?.changed) ? data.changed : [];
  // 今回あらたにキャンセルになった品目だけを知らせる（ほかの人が先にキャンセルしていた分は入れない）
  const told = picked.filter(r=>changed.some(c=>Number(c.i)===r.i));
  closeOrderCancel();
  // 原価は消えているので、取り直して画面に反映する
  if(typeof refetchOrdersAndCost==='function') await refetchOrdersAndCost();
  if(typeof orderRecvRefresh==='function') orderRecvRefresh();
  if(!told.length){ showToast('選んだ品目は、もうキャンセルになっていました'); return; }

  const now = (orders||[]).find(x=>x.no===o.no) || o;
  const lines = [`【キャンセル】発注書 ${o.no}（${o.project||''}）`,
    '次の品目をキャンセルします。',
    ...told.map(r=>`・${r.name} × ${r.qty??''}${r.unit}`)];
  if(reason) lines.push(`理由：${reason}`);
  lines.push(orderCancelState(now)==='all'
    ? 'この発注は、すべてキャンセルです。'
    : `残り ${orderDeliverableItems(now).length}品目は、そのままお願いします。`);
  let sent = true;
  try{ await dbAddChatMessage(o.suppliers, { role:'me', type:'text', text: lines.join('\n') }); }
  catch(_){ sent = false; }
  showToast(sent ? `${told.length}品目をキャンセルしました。業者さんに伝わります`
                 : `${told.length}品目をキャンセルしましたが、チャットに送れませんでした。業者さんへ直接お伝えください`, sent?3000:8000);
}
