// ════ 在庫（加工場に置いてある材料） ════
//
// 在庫は、原価の明細（costEntries）から計算する（calcStock。js/order/order-history.js）。
//   入庫 … 案件「在庫分」で発注した明細
//   出庫 … 発注先「在庫分」で、現場向けに出した明細（その案件の原価になる）
//
// これまでは、発注を通さないと入庫も出庫もできず、一覧も原価管理の奥にあった。
// このページで、
//   ・いまの在庫をすぐ見られる
//   ・発注を通さない入庫（余り材を戻した、など）を入れられる
//   ・案件を選んで出庫できる（その案件の原価に入る）
//   ・数が合わないとき、数え直した数に直せる（棚卸し）
// 書き込みはデータベースの手続き（app_stock_move。migration-genba98.sql）で行う。
// 管理者も一般社員も使える。業者さん・お客様には見せない。

let stkState = { q:'', zero:false, form:null, busy:false };

// 手で入れた動きの目印（原価の明細の「発注番号」の欄に入る）
const STK_TAG = { 'in':'在庫:入庫', out:'在庫:出庫', adjust:'在庫:棚卸し' };
const STOCK_NAME = '在庫分';

// ── 読み出し ──

// まだ届いていない入庫（案件「在庫分」で発注して、納品完了になっていない品目）の数。品目名ごと
function stkPendingByName(){
  const by = {};
  (orders||[]).forEach(o=>{
    if(!o || o.project!==STOCK_NAME || o.suppliers===STOCK_NAME || o.paymentMethod) return;
    if(typeof DELIV_SINCE!=='undefined' && (o.date||'') < DELIV_SINCE) return;   // 納品の記録を始める前の発注
    orderDeliverableItems(o).forEach(({it,i})=>{
      if(typeof orderDeliveredOf==='function' && orderDeliveredOf(o, i)) return;
      by[it.name] = (by[it.name]||0) + (Number(it.qty)||0);
    });
  });
  return by;
}
function stkList(){
  const pend = stkPendingByName();
  return Object.values(calcStock()).map(s=>({...s, pending: pend[s.name]||0,
    value: Math.max(0, s.qty*s.avgCost)}))
    .sort((a,b)=>a.name.localeCompare(b.name,'ja'));
}
// その品目の動き（新しい順）
function stkMoves(name){
  return (costEntries||[]).filter(e=>e.name===name
      && ((e.project===STOCK_NAME && e.supplier!==STOCK_NAME) || (e.supplier===STOCK_NAME && e.project!==STOCK_NAME)))
    .map(e=>{
      const out = e.supplier===STOCK_NAME;
      const kind = out ? '出庫' : e.orderNo===STK_TAG.adjust ? '棚卸し' : e.orderNo===STK_TAG['in'] ? '入庫（手入力）' : '入庫（発注）';
      return { id:e.id, date:e.date||'', kind, qty: out ? -e.qty : e.qty, unit:e.unit||'',
        where: out ? e.project : (e.orderNo && !String(e.orderNo).startsWith('在庫:') ? `${e.supplier||''} ${e.orderNo}` : ''),
        by:e.createdByName||'', note:e.note||'' };
    })
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)) || (b.id||0)-(a.id||0));
}
// onclick="f('…')" の中に入れる品目名。JSの文字列として打ち消してから、HTMLとして打ち消す
function stkArg(name){ return esc(String(name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'")); }
function stkNum(v){ const n=Math.round(Number(v)*100)/100; return Number.isFinite(n) ? String(n) : '0'; }

// ── 描く ──

function renderStockPage(){
  const el = document.getElementById('stock-list');
  if(!el) return;
  const all = stkList();
  const q = stkState.q.trim().toLowerCase();
  const list = all.filter(s=>(stkState.zero || s.qty!==0 || s.pending>0) && (!q || s.name.toLowerCase().includes(q)));
  const total = all.reduce((sum,s)=>sum+s.value, 0);
  const have = all.filter(s=>s.qty>0).length;
  document.getElementById('stock-sum').innerHTML =
    `在庫のある品目 <b>${have}</b>　在庫金額 <b>¥${fmt(total)}</b><span>（税抜・入庫の平均単価で計算）</span>`;
  document.getElementById('stock-zero').checked = stkState.zero;

  if(!all.length){
    el.innerHTML = '<div class="empty">在庫の記録がありません。<br>「＋ 入庫」から入れるか、案件「在庫分」で発注すると在庫に入ります</div>';
    return;
  }
  if(!list.length){
    el.innerHTML = `<div class="empty">${q?'見つかりませんでした':'いま在庫のある品目はありません'}</div>`;
    return;
  }
  el.innerHTML = list.map(s=>{
    const nm = stkArg(s.name);
    return `<div class="stk-row${s.qty<=0?' zero':''}">
      <div class="stk-main" onclick="openStockHistory('${nm}')">
        <div class="stk-name">${esc(s.name)}</div>
        <div class="stk-meta">平均 ¥${fmt(s.avgCost)}/${esc(s.unit||'')}　在庫金額 ¥${fmt(s.value)}${
          s.pending ? `<span class="stk-pend">うち納品待ち ${stkNum(s.pending)}${esc(s.unit||'')}</span>` : ''}</div>
      </div>
      <div class="stk-qty${s.qty<0?' neg':''}"><b>${stkNum(s.qty)}</b><span>${esc(s.unit||'')}</span></div>
      <div class="stk-btns">
        <button type="button" class="btn xs primary" ${s.qty>0?'':'disabled'} onclick="openStockForm('out','${nm}')">出庫</button>
        <button type="button" class="btn xs" onclick="openStockForm('in','${nm}')">入庫</button>
      </div>
    </div>`;
  }).join('');
}
function stkSetQuery(v){ stkState.q = v||''; renderStockPage(); }
function stkSetZero(on){ stkState.zero = !!on; renderStockPage(); }

// ── 入庫・出庫・棚卸しの入力 ──

// kind：'in' 入庫／'out' 出庫／'adjust' 棚卸し。name を渡さない入庫は、新しい品目も入れられる
function openStockForm(kind, name){
  const s = name ? stkList().find(x=>x.name===name) : null;
  if(kind!=='in' && !s){ showToast('品目が見つかりません'); return; }
  stkState.form = { kind, name: s?.name||'', fixed: !!s };
  const title = { 'in':'入庫する', out:'出庫する', adjust:'数を直す（棚卸し）' }[kind];
  document.getElementById('stkf-title').textContent = title;
  const now = s ? `いまの在庫 ${stkNum(s.qty)}${s.unit||''}` : '';
  document.getElementById('stkf-sub').textContent =
    kind==='in' ? (s ? now : '発注を通さずに入ってきたもの（余り材を戻した、など）を入れます')
    : kind==='out' ? `${now}　出庫した分は、選んだ案件の原価に入ります`
    : `${now}　実際に数えた数を入れると、その数に直ります`;

  // 品目名：決まっているときは変えられない。新しく入れるときは、いまある品目と品目マスタから候補を出す
  const nameEl = document.getElementById('stkf-name');
  nameEl.value = s?.name||'';
  nameEl.readOnly = !!s;
  if(!s){
    const names = [...new Set([...stkList().map(x=>x.name), ...((typeof master!=='undefined'?master:[])||[]).map(m=>m.name)])].filter(Boolean);
    document.getElementById('stkf-names').innerHTML = names.slice(0,800).map(n=>`<option value="${esc(n)}">`).join('');
  }
  const unitEl = document.getElementById('stkf-unit');
  unitEl.value = s?.unit||'';
  unitEl.readOnly = !!s;
  document.getElementById('stkf-unit-wrap').style.display = kind==='in' ? '' : 'none';

  const qtyEl = document.getElementById('stkf-qty');
  qtyEl.value = kind==='adjust' ? stkNum(s.qty) : '';
  document.getElementById('stkf-qty-label').textContent =
    kind==='in' ? '入庫する数 *' : kind==='out' ? '出庫する数 *' : '実際に数えた数 *';

  // 単価（入庫だけ）。いまある品目は平均単価を入れておく
  document.getElementById('stkf-cost-wrap').style.display = kind==='in' ? '' : 'none';
  document.getElementById('stkf-cost').value = (kind==='in' && s && s.avgCost) ? Math.round(s.avgCost) : '';

  // 案件（出庫だけ）。もう終わった工事は出さない
  document.getElementById('stkf-proj-wrap').style.display = kind==='out' ? '' : 'none';
  if(kind==='out'){
    const list = (typeof taskProjectOptions==='function') ? taskProjectOptions() : (projects||[]);
    const cur = (typeof selectedProject!=='undefined' && selectedProject?.name) || '';
    document.getElementById('stkf-proj').innerHTML = '<option value="">（案件を選ぶ）</option>'
      + list.map(p=>`<option value="${esc(p.name)}"${p.name===cur?' selected':''}>${esc(p.name)}</option>`).join('');
  }
  document.getElementById('stkf-note').value = '';
  const btn = document.getElementById('stkf-save');
  btn.textContent = { 'in':'入庫する', out:'出庫する', adjust:'この数に直す' }[kind];
  btn.disabled = false;
  document.getElementById('stock-form-modal').classList.add('open');
  setTimeout(()=>(s ? qtyEl : nameEl).focus(), 80);
}
function closeStockForm(){ document.getElementById('stock-form-modal').classList.remove('open'); stkState.form = null; }

// 全角の数字で入れても通す
function stkParseNum(v){
  const s = String(v??'').replace(/[０-９．]/g, c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/[,，\s]/g,'');
  if(s==='') return NaN;
  return Number(s);
}

async function saveStockForm(){
  const f = stkState.form; if(!f || stkState.busy) return;
  const name = document.getElementById('stkf-name').value.trim();
  const unit = document.getElementById('stkf-unit').value.trim();
  const qty  = stkParseNum(document.getElementById('stkf-qty').value);
  const note = document.getElementById('stkf-note').value.trim();
  if(!name){ showToast('品目名を入れてください'); return; }
  if(!Number.isFinite(qty) || (f.kind!=='adjust' && qty<=0) || qty<0){ showToast('数を入れてください'); return; }
  const cur = stkList().find(x=>x.name===name);

  let cost = null, project = '';
  if(f.kind==='in'){
    if(!cur && !unit){ showToast('単位を入れてください（本・枚・箱など）'); return; }
    const c = stkParseNum(document.getElementById('stkf-cost').value);
    if(Number.isFinite(c)){ if(c<0){ showToast('単価が正しくありません'); return; } cost = c; }
    else if(!cur){
      if(!confirm('単価が入っていません。0円の在庫として入れますか？\n（出庫したとき、案件の原価に金額が入りません）')) return;
      cost = 0;
    }
  }
  if(f.kind==='out'){
    project = document.getElementById('stkf-proj').value;
    if(!project){ showToast('出庫先の案件を選んでください'); return; }
    if(cur && qty > cur.qty){ showToast(`在庫が足りません。いまの在庫は ${stkNum(cur.qty)}${cur.unit||''} です`, 6000); return; }
  }
  if(f.kind==='adjust'){
    if(cur && qty===cur.qty){ closeStockForm(); showToast('数は合っています'); return; }
    if(!confirm(`「${name}」の在庫を ${stkNum(cur?.qty||0)} → ${stkNum(qty)}${cur?.unit||''} に直します。よろしいですか？`)) return;
  }

  stkState.busy = true;
  const btn = document.getElementById('stkf-save');
  btn.disabled = true;
  const { data, error } = await sb.rpc('app_stock_move', {
    p_kind: f.kind, p_name: name, p_unit: unit, p_qty: qty, p_unit_cost: cost, p_project: project, p_note: note });
  stkState.busy = false;
  if(error){
    btn.disabled = false;
    const code = String(error.code||''), msg = String(error.message||'');
    showToast((code==='PGRST202' || code==='42883' || /app_stock_move/.test(msg) && /find|exist|schema cache/i.test(msg))
      ? 'データベースの準備が必要です。supabase/migration-genba98.sql を実行してください'
      : '保存できませんでした：'+msg, 8000);
    return;
  }
  // 返ってきた明細を手元に足す（取り直さなくても、在庫と原価にすぐ出る）
  if(data && data.id!=null && typeof costRowTo==='function'){
    costEntries = [costRowTo(data), ...(costEntries||[]).filter(e=>e.id!==data.id)];
  }
  closeStockForm();
  renderStockPage();
  if(document.getElementById('stock-hist-modal')?.classList.contains('open')) openStockHistory(name);
  try{ if(typeof renderCost==='function' && document.getElementById('page-cost')?.classList.contains('active')) renderCost(); }catch(_){}
  showToast(f.kind==='in' ? `${stkNum(qty)}${cur?.unit||unit} 入庫しました`
          : f.kind==='out' ? `${stkNum(qty)}${cur?.unit||''} 出庫しました（${project} の原価に入ります）`
          : '在庫の数を直しました');
}

// ── 品目ごとの動き ──

function openStockHistory(name){
  const s = stkList().find(x=>x.name===name);
  if(!s) return;
  const nm = stkArg(s.name);
  document.getElementById('stkh-title').textContent = s.name;
  document.getElementById('stkh-sub').innerHTML =
    `いまの在庫 <b>${stkNum(s.qty)}${esc(s.unit||'')}</b>　平均 ¥${fmt(s.avgCost)}/${esc(s.unit||'')}${
      s.pending ? `　うち納品待ち ${stkNum(s.pending)}${esc(s.unit||'')}` : ''}`;
  document.getElementById('stkh-btns').innerHTML =
    `<button type="button" class="btn sm primary" ${s.qty>0?'':'disabled'} onclick="openStockForm('out','${nm}')">出庫</button>
     <button type="button" class="btn sm" onclick="openStockForm('in','${nm}')">入庫</button>
     <button type="button" class="btn sm" onclick="openStockForm('adjust','${nm}')">数を直す（棚卸し）</button>`;
  const moves = stkMoves(name);
  document.getElementById('stkh-list').innerHTML = moves.length ? moves.map(m=>`
    <div class="stk-move">
      <div class="stk-move-top"><span>${esc(String(m.date).replace(/-/g,'/'))}　${esc(m.kind)}</span>
        <b class="${m.qty<0?'out':'in'}">${m.qty>0?'+':''}${stkNum(m.qty)}${esc(m.unit)}</b></div>
      ${(m.where||m.by||m.note) ? `<div class="stk-move-sub">${[m.where?esc(m.where):'', m.by?esc(m.by):'', m.note?esc(m.note):''].filter(Boolean).join('　')}</div>` : ''}
    </div>`).join('') : '<div class="empty" style="padding:16px">動きの記録がありません</div>';
  document.getElementById('stock-hist-modal').classList.add('open');
}
function closeStockHistory(){ document.getElementById('stock-hist-modal').classList.remove('open'); }
