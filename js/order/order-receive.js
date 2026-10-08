// ════ 発注書の受領と、品目ごとの納品予定日 ════
//
// 業者さんが発注書を受領するときに、「いつ納めるか」を品目ごとに入れてもらう（必須）。
// きよかわが頼んだ「納品希望日」に対する、業者さんからの答えにあたる。
//
//   ・1品目ずつ日付を入れられる
//   ・いくつか選んで、まとめて同じ日を入れられる（たいていは全部同じ日なので、開いたときは全部選んである）
//   ・すべての品目に日付が入るまで、受領はできない
//   ・受領したあとでも、日付は変えられる（変えたらきよかわに伝わる）
//
// 送料の行には日付を付けない。
// 日付は品目（items）とは別の列に持つ（migration-genba95.sql）。

let orderRecv = null;   // {no, mode:'receive'|'change', rows:[{i,name,qty,unit,on,sel}]}

// ── 読み出し ──

// 日付を入れる品目（送料の行は除く）。i は発注の品目の並び順
function orderDeliverableItems(o){
  return (o?.items||[]).map((it,i)=>({it,i})).filter(x=>!x.it.isShipping);
}
// その品目の納品予定日（無ければ ''）。
// 並び順と品目名の両方が合うものを使う。あとから送料の行が足されるなどして
// 並びがずれていたら、品目名で探す
function orderDeliveryOf(o, i){
  const list = Array.isArray(o?.deliveryDates) ? o.deliveryDates : [];
  const name = o?.items?.[i]?.name;
  const hit = list.find(d=>d && d.i===i && d.name===name) || list.find(d=>d && d.name===name);
  return (hit && /^\d{4}-\d{2}-\d{2}$/.test(hit.on||'')) ? hit.on : '';
}
// 入っている納品予定日（重なりを除いて、早い順）
function orderDeliveryDays(o){
  const days = orderDeliverableItems(o).map(x=>orderDeliveryOf(o, x.i)).filter(Boolean);
  if(!days.length && o?.deliveryOn) return [o.deliveryOn];
  return [...new Set(days)].sort();
}
// すべての品目に入っているか
function orderDeliveryComplete(o){
  const items = orderDeliverableItems(o);
  return items.length>0 && items.every(x=>orderDeliveryOf(o, x.i));
}
function orderMd(ymd){ const p=String(ymd||'').split('-'); return p.length===3 ? `${Number(p[1])}/${Number(p[2])}` : ''; }
// 一覧に出す短い書き方。「10/14」または「10/14〜10/16」
function orderDeliveryLabel(o){
  const days = orderDeliveryDays(o);
  if(!days.length) return '';
  return days.length===1 ? orderMd(days[0]) : `${orderMd(days[0])}〜${orderMd(days[days.length-1])}`;
}
// きよかわの希望日より遅い品目があるか（「最短」で頼んだものは比べない）
function orderDeliveryLate(o){
  if(!o || o.dueAsap || !o.dueDate) return false;
  return orderDeliveryDays(o).some(d=>d > o.dueDate);
}
// チャットや通知に書く形。「10/14」／「10/14（3品目）・10/16（1品目）」
function orderDeliveryText(rows){
  const by = {};
  rows.forEach(r=>{ if(r.on) by[r.on] = (by[r.on]||0) + 1; });
  const days = Object.keys(by).sort();
  if(!days.length) return '';
  if(days.length===1) return orderMd(days[0]);
  return days.map(d=>`${orderMd(d)}（${by[d]}品目）`).join('・');
}

// ── 開く ──

// mode：'receive' … 受領する（日付を入れて受領）／'change' … 受領済みの日付を見る・変える
function openOrderReceive(orderNo, mode){
  const o = (orders||[]).find(x=>x.no===orderNo);
  if(!o){ showToast('発注が見つかりません。画面を更新してからお試しください'); return; }
  const items = orderDeliverableItems(o);
  const rows = items.map(({it,i})=>({ i, name: it.name||'', qty: it.qty, unit: it.unit||'',
                                      on: orderDeliveryOf(o, i), sel: false }));
  // たいていは全部同じ日に納めるので、まだ日付の無い品目をはじめから選んでおく。
  // 日付を1つ選んで「選んだ品目に入れる」を押すだけで済む
  rows.forEach(r=>{ r.sel = !r.on; });
  orderRecv = { no: orderNo, mode: mode==='change' ? 'change' : 'receive', rows };

  const want = o.dueAsap ? '最短' : (o.dueDate ? orderMd(o.dueDate) : '指定なし');
  document.getElementById('ordrecv-title').textContent =
    orderRecv.mode==='change' ? '納品予定日' : '発注書を受領する';
  document.getElementById('ordrecv-sub').innerHTML =
    `${esc(o.no)}　${esc(o.project||'')}<br>きよかわの納品希望日：<b>${esc(want)}</b>`;
  const bulk = document.getElementById('ordrecv-bulk');
  bulk.value = '';
  bulk.min = o.date || '';
  // 希望日が決まっているときだけ「希望日どおり」を出す
  const wantBtn = document.getElementById('ordrecv-want');
  wantBtn.style.display = (!o.dueAsap && o.dueDate) ? '' : 'none';
  wantBtn.textContent = `希望日どおり（${orderMd(o.dueDate)}）`;

  const canEdit = orderRecvCanEdit(o);
  document.getElementById('ordrecv-tools').style.display = canEdit ? '' : 'none';
  const save = document.getElementById('ordrecv-save');
  save.style.display = canEdit ? '' : 'none';
  save.textContent = orderRecv.mode==='change' ? '納品予定日を保存' : '受領しました';
  // きよかわの社員だけ：日付が分からないまま受領済みにする道を残す（店で受け取った、など）
  const skip = document.getElementById('ordrecv-skip');
  skip.style.display = (orderRecv.mode==='receive' && currentUserRole!=='supplier') ? '' : 'none';

  orderRecvRender();
  document.getElementById('ordrecv-modal').classList.add('open');
}
function closeOrderReceive(){
  document.getElementById('ordrecv-modal').classList.remove('open');
  orderRecv = null;
}
// 日付を入れられるのは、その発注の業者さんと、きよかわの社員
function orderRecvCanEdit(o){
  return currentUserRole==='staff' || currentUserRole==='carpenter' || currentUserRole==='supplier';
}

// ── 描く ──

function orderRecvRender(){
  const st = orderRecv; if(!st) return;
  const o = (orders||[]).find(x=>x.no===st.no);
  const canEdit = orderRecvCanEdit(o);
  const lateOf = d => !!(d && o && !o.dueAsap && o.dueDate && d > o.dueDate);

  document.getElementById('ordrecv-list').innerHTML = st.rows.map((r,k)=>`
    <div class="orv-row${r.on?'':' need'}${r.sel?' sel':''}">
      ${canEdit ? `<input type="checkbox" class="orv-ck" ${r.sel?'checked':''}
          onchange="orderRecvSelect(${k}, this.checked)" aria-label="この品目を選ぶ">` : ''}
      <div class="orv-main" ${canEdit?`onclick="orderRecvSelect(${k})"`:''}>
        <div class="orv-name">${esc(r.name)}</div>
        <div class="orv-meta">${esc(String(r.qty??''))}${esc(r.unit)}${
          lateOf(r.on) ? '<span class="orv-late">希望日より後</span>' : ''}</div>
      </div>
      <input type="date" class="orv-date" value="${esc(r.on)}" min="${esc(o?.date||'')}"
        ${canEdit?'':'disabled'} onchange="orderRecvSetDate(${k}, this.value)" aria-label="納品予定日">
    </div>`).join('') || '<div class="empty" style="padding:18px">日付を入れる品目がありません</div>';

  const nSel  = st.rows.filter(r=>r.sel).length;
  const nNeed = st.rows.filter(r=>!r.on).length;
  const all = document.getElementById('ordrecv-all');
  all.checked = st.rows.length>0 && nSel===st.rows.length;
  all.indeterminate = nSel>0 && nSel<st.rows.length;
  document.getElementById('ordrecv-selcount').textContent = nSel ? `${nSel}品目を選択中` : '品目を選んでください';

  const note = document.getElementById('ordrecv-note');
  note.textContent = nNeed
    ? `あと${nNeed}品目、納品予定日が入っていません`
    : (st.rows.length ? 'すべての品目に入りました' : '');
  note.classList.toggle('need', nNeed>0);
  // 受領のときは、すべて入るまで押せないようにしておく（押せない理由は上に出ている）
  const save = document.getElementById('ordrecv-save');
  save.disabled = nNeed>0 && st.rows.length>0;
}

// ── 選ぶ・入れる ──

function orderRecvSelect(k, on){
  const r = orderRecv?.rows[k]; if(!r) return;
  r.sel = (on===undefined) ? !r.sel : !!on;
  orderRecvRender();
}
function orderRecvSelectAll(on){
  if(!orderRecv) return;
  orderRecv.rows.forEach(r=>{ r.sel = !!on; });
  orderRecvRender();
}
function orderRecvSetDate(k, ymd){
  const r = orderRecv?.rows[k]; if(!r) return;
  r.on = /^\d{4}-\d{2}-\d{2}$/.test(ymd||'') ? ymd : '';
  orderRecvRender();
}
// 選んだ品目に、まとめて同じ日を入れる
function orderRecvApply(ymd){
  if(!orderRecv) return;
  const day = ymd || document.getElementById('ordrecv-bulk').value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day||'')){ showToast('まとめて入れる日付を選んでください'); return; }
  const picked = orderRecv.rows.filter(r=>r.sel);
  if(!picked.length){ showToast('日付を入れる品目を選んでください'); return; }
  picked.forEach(r=>{ r.on = day; r.sel = false; });
  // 続けて残りを入れやすいよう、まだ日付の無い品目を選んでおく
  orderRecv.rows.forEach(r=>{ if(!r.on) r.sel = true; });
  document.getElementById('ordrecv-bulk').value = '';
  orderRecvRender();
}
// 「希望日どおり」：選んだ品目に、きよかわの希望日を入れる
function orderRecvApplyWant(){
  const o = (orders||[]).find(x=>x.no===orderRecv?.no);
  if(o?.dueDate) orderRecvApply(o.dueDate);
}

// ── 保存 ──

async function saveOrderReceive(skipDates){
  const st = orderRecv; if(!st) return;
  const o = (orders||[]).find(x=>x.no===st.no);
  if(!o){ closeOrderReceive(); return; }
  const supplier = currentUserRole==='supplier';

  let dates = [], last = '';
  if(!skipDates){
    const missing = st.rows.filter(r=>!r.on);
    if(missing.length){
      showToast(`あと${missing.length}品目、納品予定日が入っていません`);
      return;
    }
    // 発注日より前の日付は、打ち間違いとみなす
    const early = o.date ? st.rows.find(r=>r.on < o.date) : null;
    if(early){ showToast(`「${early.name}」の日付が、発注日（${orderMd(o.date)}）より前になっています`); return; }
    dates = st.rows.map(r=>({ i:r.i, name:r.name, on:r.on }));
    last  = dates.map(d=>d.on).sort().pop() || '';
  } else if(supplier){
    return;   // 業者さんには、日付なしの受領は無い
  }

  const btn = document.getElementById('ordrecv-save');
  btn.disabled = true;
  const before = orderDeliveryLabel(o);
  try{
    if(st.mode==='receive'){
      await dbMarkOrderReceived(o.no, o.suppliers, skipDates ? null : { deliveryOn:last, deliveryDates:dates });
      o.status = 'received';
      o.receivedAt = new Date().toISOString();
      (costEntries||[]).filter(e=>e.orderNo===o.no).forEach(e=>{ e.status='received'; });
    } else {
      await dbSetOrderDelivery(o.no, o.suppliers, { deliveryOn:last, deliveryDates:dates });
    }
  }catch(_){ btn.disabled = false; return; }
  if(!skipDates){ o.deliveryOn = last; o.deliveryDates = dates; }

  const rows = st.rows.slice();
  const mode = st.mode;
  closeOrderReceive();
  orderRecvRefresh();

  const text = orderDeliveryText(rows);
  if(mode==='receive'){
    showToast(supplier ? '受領しました。きよかわに伝わります' : '受領済みにしました');
    if(supplier){
      // 社内へ通知＋チャットにも残す
      dbSendPushToRole('staff', '発注書が受領されました',
        `${currentUserDisplayName||''} ${o.no}　納品予定 ${text}`, 'order/history').catch(()=>{});
      if(typeof activeTalkPanelSupplier!=='undefined' && activeTalkPanelSupplier){
        dbAddChatMessage(activeTalkPanelSupplier, {role:'them', type:'text',
          text:`発注書 ${o.no} を受領しました\n納品予定：${text}`}).catch(()=>{});
      }
    }
  } else {
    showToast('納品予定日を保存しました');
    const after = orderDeliveryLabel(o);
    if(supplier && after!==before){
      dbSendPushToRole('staff', '納品予定日が変わりました',
        `${currentUserDisplayName||''} ${o.no}　${before||'未定'} → ${after}`, 'order/history').catch(()=>{});
      if(typeof activeTalkPanelSupplier!=='undefined' && activeTalkPanelSupplier){
        dbAddChatMessage(activeTalkPanelSupplier, {role:'them', type:'text',
          text:`発注書 ${o.no} の納品予定日を変更しました\n納品予定：${text}`}).catch(()=>{});
      }
    }
  }
}

// いま出ている画面を描き直す（チャット・発注履歴・原価）
function orderRecvRefresh(){
  try{
    if(typeof talkPanelOpen!=='undefined' && talkPanelOpen && activeTalkPanelSupplier
       && typeof renderTalkPanelMessages==='function'){
      if(typeof resetChatRenderSignature==='function') resetChatRenderSignature();
      renderTalkPanelMessages();
    }
  }catch(_){}
  try{ if(document.getElementById('orders-list') && typeof renderOrders==='function') renderOrders(); }catch(_){}
  try{ if(typeof renderCost==='function' && document.getElementById('page-cost')?.classList.contains('active')) renderCost(); }catch(_){}
}
