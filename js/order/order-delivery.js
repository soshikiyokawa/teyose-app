// ════ 納品（業者さんが、納めた品目を知らせる） ════
//
// 発注があった品目を、品目ごとに並べる。
// 業者さんは、納め終わった品目を選んで（いくつでも）、納品日を入れて「納品完了」を押す。
// 押すと、きよかわとのチャットに1通入り、社員に通知が行く。
//
//   ・「納品予定日」（受領のときに入れる日。js/order/order-receive.js）とは別に、
//     実際に納めた日を持つ（orders.delivered_dates。migration-genba96.sql）
//   ・記録はデータベースの手続きで行う。2台から同時に押しても、片方が消えない
//   ・受領がまだの発注も並べる。納品完了にはできない（先に受領してもらう）
//   ・きよかわからキャンセルの連絡があった品目は、選んで「キャンセル品にする」を押す。
//     きよかわが確認（承認）すると、キャンセルになって、ここから消える（js/order/order-cancel.js）
//   ・送料の行と、レシートから取り込んだ発注（もう手元にある）は並べない
//
// この機能を入れる前の発注まで「未納」に並ぶと探しにくいので、
// 下の日付より前の発注は「未納」に出さない。
const DELIV_SINCE = '2026-10-01';
const DELIV_DONE_MAX = 200;      // 「納品済み」に出す件数（新しい順）

let delivState = { tab:'todo', sel:new Set(), on:'', busy:false };

// ── 読み出し ──

// その品目の納品の記録（無ければ null）。
// 並び順と品目名の両方が合うものを使う。並びがずれていたときは品目名で探すが、
// 同じ名前の品目が2つ以上ある発注では取り違えるので、そのときは探さない
function orderDeliveredOf(o, i){
  const list = Array.isArray(o?.deliveredDates) ? o.deliveredDates : [];
  const name = o?.items?.[i]?.name;
  let hit = list.find(d=>d && Number(d.i)===i && d.name===name);
  if(!hit && (o?.items||[]).filter(x=>x && x.name===name).length===1){
    hit = list.find(d=>d && d.name===name);
  }
  return (hit && /^\d{4}-\d{2}-\d{2}$/.test(hit.on||'')) ? hit : null;
}
// 納品が済んだ品目の数と、数える品目の数（送料の行は除く）
function orderDeliveredCount(o){
  const items = orderDeliverableItems(o);
  return { done: items.filter(x=>orderDeliveredOf(o, x.i)).length, all: items.length };
}
// 発注履歴に出す短い書き方。「納品済み 2/3」。記録が無ければ ''
function orderDeliveredLabel(o){
  const c = orderDeliveredCount(o);
  return c.done ? `納品済み ${c.done}/${c.all}` : '';
}

function delivKey(o, i){ return o.id + ':' + i; }
function delivToday(){ return localYmd(new Date()); }

// 並べる品目（1品目1行）
function delivRows(){
  const out = [];
  (orders||[]).forEach(o=>{
    if(!o || o.paymentMethod) return;                   // レシートから取り込んだ発注
    orderDeliverableItems(o).forEach(({it,i})=>{
      out.push({ key:delivKey(o,i), o, i, it,
        plan: orderPlanDateOf(o, i), done: orderDeliveredOf(o, i), req: orderCancelRequested(o, i) });
    });
  });
  return out;
}
function delivTodoRows(){
  return delivRows()
    .filter(r=>!r.done && ((r.o.date||'') >= DELIV_SINCE || (r.o.deliveryOn||'') >= DELIV_SINCE))
    // 納品予定日の早い順。予定日がまだ無いもの（未受領など）は後ろ
    .sort((a,b)=> (a.plan||'9999').localeCompare(b.plan||'9999')
      || String(a.o.date||'').localeCompare(String(b.o.date||''))
      || String(a.o.no||'').localeCompare(String(b.o.no||'')) || a.i-b.i);
}
function delivDoneRows(){
  return delivRows().filter(r=>r.done)
    .sort((a,b)=> b.done.on.localeCompare(a.done.on)
      || String(b.done.at||'').localeCompare(String(a.done.at||''))
      || String(a.o.no||'').localeCompare(String(b.o.no||'')) || a.i-b.i);
}
// 選べる品目か（キャンセル品に指定して確認待ちのものは、選べない）
function delivCanPick(r){ return !r.req; }
// 納品完了にできる品目か（受領済みの発注だけ）
function delivCanDeliver(r){ return !r.req && r.o.status==='received'; }

// ── 描く ──

function delivSetTab(t){
  delivState.tab = t==='done' ? 'done' : 'todo';
  renderDeliveryPage();
  window.scrollTo(0,0);
}

function renderDeliveryPage(){
  const page = document.getElementById('page-delivery');
  if(!page) return;
  const todo = delivTodoRows();
  // もう選べなくなったもの（ほかの端末で納品済みにした・発注が消えた）は、選択から外す
  const pickable = new Set(todo.filter(delivCanPick).map(r=>r.key));
  [...delivState.sel].forEach(k=>{ if(!pickable.has(k)) delivState.sel.delete(k); });
  if(!/^\d{4}-\d{2}-\d{2}$/.test(delivState.on||'')) delivState.on = delivToday();

  const today = delivToday();
  document.getElementById('deliv-tab-todo').classList.toggle('on', delivState.tab==='todo');
  document.getElementById('deliv-tab-done').classList.toggle('on', delivState.tab==='done');
  document.getElementById('deliv-tab-todo').textContent = `未納（${todo.length}）`;

  const list = document.getElementById('deliv-list');
  const bar  = document.getElementById('deliv-bar');
  if(delivState.tab==='done'){
    bar.style.display = 'none';
    const done = delivDoneRows();
    list.innerHTML = done.length ? done.slice(0, DELIV_DONE_MAX).map(r=>`
      <div class="dlv-row done">
        <div class="dlv-main">
          <div class="dlv-name">${esc(r.it.name||'')}</div>
          <div class="dlv-meta">${esc(String(r.it.qty??''))}${esc(r.it.unit||'')}　${esc(r.o.project||'')}　${esc(r.o.no||'')}</div>
          <div class="dlv-plan ok">✓ ${orderMd(r.done.on)} 納品${r.done.by?`（${esc(r.done.by)}）`:''}</div>
        </div>
        <button type="button" class="btn xs" onclick="delivCancel('${esc(r.key)}')">取り消し</button>
      </div>`).join('')
      + (done.length>DELIV_DONE_MAX ? `<div class="empty" style="padding:14px">新しい順に${DELIV_DONE_MAX}件まで出しています</div>` : '')
      : '<div class="empty">納品済みの品目は、まだありません</div>';
    return;
  }

  list.innerHTML = todo.length ? todo.map(r=>{
    const can = delivCanPick(r);
    const recv = r.o.status==='received';
    const sel = delivState.sel.has(r.key);
    const late = !!(r.plan && r.plan < today);
    const plan = r.req ? '<span class="dlv-plan cxl">キャンセル品に指定済み（きよかわの確認待ち）</span>'
      : !recv ? '<span class="dlv-plan wait">受領がまだです</span>'
      : r.plan ? `<span class="dlv-plan${late?' late':''}">納品予定 ${orderMd(r.plan)}${late?'（過ぎています）':r.plan===today?'（今日）':''}</span>`
      : '<span class="dlv-plan wait">納品予定日が入っていません</span>';
    return `<div class="dlv-row${sel?' sel':''}${can?'':' off'}">
      <input type="checkbox" class="dlv-ck" ${sel?'checked':''} ${can?'':'disabled'}
        onchange="delivSelect('${esc(r.key)}', this.checked)" aria-label="この品目を選ぶ">
      <div class="dlv-main" ${can?`onclick="delivSelect('${esc(r.key)}')"`:''}>
        <div class="dlv-name">${esc(r.it.name||'')}</div>
        <div class="dlv-meta">${esc(String(r.it.qty??''))}${esc(r.it.unit||'')}　${esc(r.o.project||'')}　${esc(r.o.no||'')}</div>
        <div>${plan}</div>
      </div>
      ${r.req ? `<button type="button" class="btn xs" onclick="delivWithdrawCancel('${esc(r.key)}')">指定を取り消す</button>`
        : recv ? '' : `<button type="button" class="btn xs primary" onclick="openOrderReceive('${esc(r.o.no)}','receive')">受領する</button>`}
    </div>`;
  }).join('') : '<div class="empty">これから納める品目はありません</div>';

  // 下の帯（選んだ数・納品日・納品完了）
  const nSel = delivState.sel.size;
  bar.style.display = pickable.size ? '' : 'none';
  const all = document.getElementById('deliv-all');
  all.checked = pickable.size>0 && nSel===pickable.size;
  all.indeterminate = nSel>0 && nSel<pickable.size;
  const on = document.getElementById('deliv-on');
  if(document.activeElement !== on) on.value = delivState.on;
  on.max = today;
  const btn = document.getElementById('deliv-save');
  btn.textContent = nSel ? `納品完了（${nSel}品目）` : '納品完了';
  btn.disabled = !nSel || delivState.busy;
  const cxl = document.getElementById('deliv-cxl');
  if(cxl) cxl.disabled = !nSel || delivState.busy;
}

// ── 選ぶ ──

function delivSelect(key, on){
  const want = (on===undefined) ? !delivState.sel.has(key) : !!on;
  if(want) delivState.sel.add(key); else delivState.sel.delete(key);
  renderDeliveryPage();
}
function delivSelectAll(on){
  delivState.sel = new Set(on ? delivTodoRows().filter(delivCanPick).map(r=>r.key) : []);
  renderDeliveryPage();
}
function delivSetOn(ymd){
  delivState.on = /^\d{4}-\d{2}-\d{2}$/.test(ymd||'') ? ymd : '';
}

// ── 納品完了 ──

// データベースの準備（migration-genba96.sql）がまだのときの案内
function delivNotReady(error){
  const code = String(error?.code||''), msg = String(error?.message||'');
  return code==='PGRST202' || code==='42883' || /app_(un)?mark_delivered|app_request_cancel|app_withdraw_cancel|delivered_dates|cancel_requests/.test(msg) && /find|exist|schema cache/i.test(msg);
}
function delivFail(error, what){
  showToast(delivNotReady(error)
    ? 'データベースの準備が必要です。supabase/migration-genba96.sql を実行してください'
    : `${what}：${error?.message||'通信できませんでした'}`, 7000);
}

async function saveDelivery(){
  if(delivState.busy) return;
  const on = document.getElementById('deliv-on').value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(on||'')){ showToast('納品日を入れてください'); return; }
  if(on > delivToday()){ showToast('納品日に、先の日付は入れられません'); return; }
  const picked = delivTodoRows().filter(r=>delivCanPick(r) && delivState.sel.has(r.key));
  if(!picked.length){ showToast('納品が済んだ品目を選んでください'); return; }
  const wait = picked.find(r=>!delivCanDeliver(r));
  if(wait){ showToast(`「${wait.it.name}」は、発注書の受領がまだです。先に「受領する」から受領してください`, 6000); return; }
  const early = picked.find(r=>r.o.date && on < r.o.date);
  if(early){ showToast(`「${early.it.name}」は、納品日が発注日（${orderMd(early.o.date)}）より前になっています`, 6000); return; }

  // 発注ごとにまとめて記録する
  const byOrder = new Map();
  picked.forEach(r=>{ if(!byOrder.has(r.o.id)) byOrder.set(r.o.id, {o:r.o, rows:[]}); byOrder.get(r.o.id).rows.push(r); });

  delivState.busy = true;
  renderDeliveryPage();
  const saved = [];          // 今回あらたに記録できたもの（お知らせに書く）
  let failed = null;
  for(const {o, rows} of byOrder.values()){
    const { data, error } = await sb.rpc('app_mark_delivered',
      { p_order_id:o.id, p_items:rows.map(r=>({i:r.i, name:r.it.name||''})), p_on:on });
    if(error){ failed = error; break; }
    if(Array.isArray(data?.delivered_dates)) o.deliveredDates = data.delivered_dates;
    const changed = Array.isArray(data?.changed) ? data.changed : [];
    rows.forEach(r=>{
      delivState.sel.delete(r.key);
      // もう記録してあったもの（ほかの端末で先に押した）は、お知らせに入れない
      if(changed.some(c=>Number(c.i)===r.i)) saved.push(r);
    });
  }
  delivState.busy = false;
  delivState.on = delivToday();
  renderDeliveryPage();
  delivRefreshOthers();

  if(failed) delivFail(failed, '納品を記録できませんでした');
  if(!saved.length){
    if(!failed) showToast('選んだ品目は、もう納品済みになっていました');
    return;
  }
  const sent = await delivNotify(saved, on, false);
  showToast(sent ? `${saved.length}品目を納品済みにしました。きよかわに伝わります`
                 : `${saved.length}品目を納品済みにしましたが、チャットに送れませんでした。お手数ですが、チャットでお知らせください`, sent?3000:8000);
}

// ── キャンセル品にする ──
//
// きよかわから電話などでキャンセルの連絡があった品目を、業者さんが指定する。
// これだけではキャンセルにならず、きよかわが確認（承認）して、はじめてキャンセルになる

async function requestCancelItems(){
  if(delivState.busy) return;
  const picked = delivTodoRows().filter(r=>delivCanPick(r) && delivState.sel.has(r.key));
  if(!picked.length){ showToast('キャンセル品にする品目を選んでください'); return; }
  if(!confirm(`次の${picked.length}品目を「キャンセル品」として、きよかわに知らせます。\n\n`
    + picked.slice(0,12).map(r=>`・${r.it.name} × ${r.it.qty??''}${r.it.unit||''}`).join('\n')
    + (picked.length>12 ? `\nほか ${picked.length-12}品目` : '')
    + `\n\nきよかわが確認すると、キャンセルになります。よろしいですか？`)) return;

  const byOrder = new Map();
  picked.forEach(r=>{ if(!byOrder.has(r.o.id)) byOrder.set(r.o.id, {o:r.o, rows:[]}); byOrder.get(r.o.id).rows.push(r); });
  delivState.busy = true;
  renderDeliveryPage();
  const saved = [];
  let failed = null;
  for(const {o, rows} of byOrder.values()){
    const { data, error } = await sb.rpc('app_request_cancel',
      { p_order_id:o.id, p_items:rows.map(r=>({i:r.i, name:r.it.name||''})) });
    if(error){ failed = error; break; }
    if(Array.isArray(data?.cancel_requests)) o.cancelRequests = data.cancel_requests;
    const changed = Array.isArray(data?.changed) ? data.changed : [];
    rows.forEach(r=>{
      delivState.sel.delete(r.key);
      if(changed.some(c=>Number(c.i)===r.i)) saved.push(r);
    });
  }
  delivState.busy = false;
  renderDeliveryPage();
  delivRefreshOthers();
  if(failed) delivFail(failed, 'キャンセル品に指定できませんでした');
  if(!saved.length){
    if(!failed) showToast('選んだ品目は、もうキャンセル品に指定されていました');
    return;
  }
  const sent = await delivNotifyCancel(saved, 'request');
  showToast(sent ? `${saved.length}品目をキャンセル品に指定しました。きよかわの確認をお待ちください`
                 : `${saved.length}品目をキャンセル品に指定しましたが、チャットに送れませんでした。お手数ですが、チャットでお知らせください`, sent?4000:8000);
}

// 指定を取り消す（押しまちがい用）。きよかわが確認する前なら、いつでも戻せる
async function delivWithdrawCancel(key){
  const r = delivTodoRows().find(x=>x.key===key);
  if(!r || !r.req || delivState.busy) return;
  if(!confirm(`「${r.it.name}」の、キャンセル品の指定を取り消しますか？`)) return;
  delivState.busy = true;
  const { data, error } = await sb.rpc('app_withdraw_cancel',
    { p_order_id:r.o.id, p_i:r.i, p_name:r.it.name||'' });
  delivState.busy = false;
  if(error){ delivFail(error, '取り消せませんでした'); return; }
  if(Array.isArray(data?.cancel_requests)) r.o.cancelRequests = data.cancel_requests;
  renderDeliveryPage();
  delivRefreshOthers();
  if(!data?.changed){ showToast('もう取り消されていました'); return; }
  const sent = await delivNotifyCancel([r], 'withdraw');
  showToast(sent ? 'キャンセル品の指定を取り消しました' : '取り消しましたが、チャットに送れませんでした', sent?3000:7000);
}

// キャンセル品の指定・取り消しを、チャットに知らせる
async function delivNotifyCancel(rows, kind){
  const bySup = new Map();
  rows.forEach(r=>{ const n=r.o.suppliers; if(!n) return; if(!bySup.has(n)) bySup.set(n, []); bySup.get(n).push(r); });
  if(!bySup.size) return false;
  let ok = true;
  for(const [name, rs] of bySup){
    const byOrder = new Map();
    rs.forEach(r=>{ if(!byOrder.has(r.o.id)) byOrder.set(r.o.id, {o:r.o, rows:[]}); byOrder.get(r.o.id).rows.push(r); });
    const lines = [kind==='request'
      ? 'キャンセル品として指定しました。ご確認をお願いします。'
      : 'キャンセル品の指定を取り消しました（キャンセルではありません）。'];
    for(const {o, rows:list} of byOrder.values()){
      lines.push(`■ ${o.project||'（案件名なし）'}（${o.no||''}）`);
      list.slice(0,30).forEach(r=>lines.push(`・${r.it.name||''} × ${r.it.qty??''}${r.it.unit||''}`));
      if(list.length>30) lines.push(`ほか ${list.length-30}品目`);
    }
    try{
      await dbAddChatMessage(name, { role: currentUserRole==='supplier' ? 'them' : 'me', type:'text', text: lines.join('\n') });
    }catch(_){ ok = false; }
  }
  return ok;
}

// ── 取り消し ──

async function delivCancel(key){
  const r = delivDoneRows().find(x=>x.key===key);
  if(!r || delivState.busy) return;
  if(!confirm(`「${r.it.name}」の納品完了（${orderMd(r.done.on)}）を取り消しますか？\n取り消したことは、きよかわに伝わります。`)) return;
  delivState.busy = true;
  const { data, error } = await sb.rpc('app_unmark_delivered',
    { p_order_id:r.o.id, p_i:Number(r.done.i), p_name:r.done.name||'', p_on:r.done.on, p_at:String(r.done.at||'') });
  delivState.busy = false;
  if(error){ delivFail(error, '取り消せませんでした'); return; }
  if(Array.isArray(data?.delivered_dates)) r.o.deliveredDates = data.delivered_dates;
  renderDeliveryPage();
  delivRefreshOthers();
  if(!data?.changed){ showToast('もう取り消されていました'); return; }
  const sent = await delivNotify([r], r.done.on, true);
  showToast(sent ? '納品完了を取り消しました' : '取り消しましたが、チャットに送れませんでした', sent?3000:7000);
}

// ── チャットに知らせる ──
//
// その発注の発注先とのチャットに、1通にまとめて入れる。
// 発注先→きよかわの書き込みは、社員への通知も一緒に出る（dbAddChatMessage）
function delivMessageText(rows, on, cancel){
  const head = cancel ? `納品完了を取り消しました（${orderMd(on)} 納品としていた分）`
                      : `納品完了しました（納品日 ${orderMd(on)}）`;
  const byOrder = new Map();
  rows.forEach(r=>{ if(!byOrder.has(r.o.id)) byOrder.set(r.o.id, {o:r.o, rows:[]}); byOrder.get(r.o.id).rows.push(r); });
  const lines = [head];
  let shown = 0;
  const MAX = 30;                 // 長くなりすぎないように
  for(const {o, rows:rs} of byOrder.values()){
    if(shown >= MAX) break;
    lines.push(`■ ${o.project||'（案件名なし）'}（${o.no||''}）`);
    rs.forEach(r=>{
      if(shown >= MAX) return;
      lines.push(`・${r.it.name||''} × ${r.it.qty??''}${r.it.unit||''}`);
      shown++;
    });
    if(!cancel){
      const c = orderDeliveredCount(o);
      if(c.all && c.done===c.all) lines.push('　→ この発注は、すべて納品済みです');
      else if(c.all) lines.push(`　→ 残り ${c.all-c.done}品目`);
    }
  }
  if(rows.length > shown) lines.push(`ほか ${rows.length-shown}品目`);
  return lines.join('\n');
}
async function delivNotify(rows, on, cancel){
  // 発注先ごとに分ける（業者さんの画面では、いつも1つ）
  const bySup = new Map();
  rows.forEach(r=>{ const n=r.o.suppliers; if(!n) return; if(!bySup.has(n)) bySup.set(n, []); bySup.get(n).push(r); });
  if(!bySup.size) return false;
  let ok = true;
  for(const [name, rs] of bySup){
    try{
      await dbAddChatMessage(name, { role: currentUserRole==='supplier' ? 'them' : 'me',
        type:'text', text: delivMessageText(rs, on, cancel) });
    }catch(_){ ok = false; }
  }
  return ok;
}

// ほかの画面（発注履歴・チャット）も描き直す
function delivRefreshOthers(){
  try{ if(typeof orderRecvRefresh==='function') orderRecvRefresh(); }catch(_){}
}
