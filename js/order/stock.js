// ════ 在庫（加工場・倉庫に置いてある材料） ════
//
// 在庫は、原価の明細（costEntries）から計算する（calcStock。js/order/order-history.js）。
//   入庫 … 案件「在庫分」で発注した明細
//   出庫 … 発注先「在庫分」で、現場向けに出した明細（その案件の原価になる）
//
// これまでは、発注を通さないと入庫も出庫もできず、一覧も原価管理の奥にあった。
// このページで、
//   ・いまの在庫を、置き場ごとにすぐ見られる
//   ・発注を通さない入庫（余り材を戻した、など）を入れられる
//   ・案件を選んで出庫できる（その案件の原価に入る）
//   ・数が合わないとき、数え直した数に直せる（棚卸し）
//   ・単価がちがっていたら直せる
// 書き込みはデータベースの手続き（app_stock_move。migration-genba98.sql）で行う。
// 管理者も一般社員も使える。業者さん・お客様には見せない。
//
// 置き場：可部加工場・亀山倉庫。置き場の入っていない明細（これまでの分、発注から入った分）は
// 可部加工場として数える。平均単価は、置き場で分けずに品目ごとに1つ。

const STOCK_NAME = '在庫分';
const STOCK_PLACES = ['可部加工場', '亀山倉庫'];
const STOCK_PLACE_DEFAULT = STOCK_PLACES[0];
// 明細の置き場（入っていなければ可部加工場）
function stockPlaceOf(e){ return e?.stockPlace || STOCK_PLACE_DEFAULT; }

// place：見ている置き場。'' は、すべての置き場の合計
// cat・sup：カテゴリ・発注先での絞り込み（'' はすべて。'-' は「入っていないもの」）
let stkState = { q:'', zero:false, place:STOCK_PLACE_DEFAULT, cat:'', sup:'', form:null, busy:false };

// ── 品目ごとの情報（カテゴリ・いつもの発注先） ──
//
// 数は原価の明細から計算するが、カテゴリと発注先は品目の表（stock_items。migration-genba101.sql）に持つ。
// 在庫タブを開いたときに読む（起動のときには読まない。立ち上がりを重くしないため）。
// 表に入っていない品目は、品目マスタに同じ名前の品目があれば、そこから借りて見せる
const STOCK_CATS = ['木材', '建材', '金物', '設備', '副資材', 'その他'];   // よく使うもの。自由に書いてもよい
let stockItems = {};          // 品目名 -> {cat, supplierId}
let stockItemsReady = true;   // 表がまだ無い環境では false（絞り込みと編集を出さない）

async function stkLoadInfo(){
  const { data, error } = await sb.from('stock_items').select('*');
  if(error){ stockItemsReady = false; stockItems = {}; return; }
  stockItemsReady = true;
  stockItems = {};
  (data||[]).forEach(r=>{ stockItems[r.name] = { cat:r.cat||'', supplierId:r.supplier_id||null }; });
}
// その品目のカテゴリと発注先（名前）
function stkInfoOf(name){
  const row = stockItems[name];
  const m = ((typeof master!=='undefined' ? master : [])||[]).find(x=>x.name===name && x.supplier!==STOCK_NAME);
  const supName = row?.supplierId ? ((suppliers||[]).find(s=>s.id===row.supplierId)?.name||'') : (row ? '' : (m?.supplier||''));
  return { cat: row ? row.cat : (m?.cat||''), supplier: supName, supplierId: row?.supplierId||null };
}
// 在庫タブを開いたとき。品目の情報を読み直してから描く
function openStockTab(){
  renderStockPage();
  stkLoadInfo().then(renderStockPage).catch(()=>{});
}

// 手で入れた動きの目印（原価の明細の「発注番号」の欄に入る）
const STK_TAG = { 'in':'在庫:入庫', out:'在庫:出庫', adjust:'在庫:棚卸し', cost:'在庫:単価', first:'在庫:初期登録' };

// ── 読み出し ──

// まだ届いていない入庫（案件「在庫分」で発注して、納品完了になっていない品目）の数。品目名ごと。
// 発注から入る分は、可部加工場に入るものとして数える
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
// place を渡すとその置き場の数、渡さなければ見ている置き場（すべてのときは合計）
function stkList(place){
  const p = place===undefined ? stkState.place : place;
  const pend = (!p || p===STOCK_PLACE_DEFAULT) ? stkPendingByName() : {};
  return Object.values(calcStock(p||undefined)).map(s=>({...s, pending: pend[s.name]||0,
    value: Math.max(0, s.qty*s.avgCost)}))
    .sort((a,b)=>a.name.localeCompare(b.name,'ja'));
}
// その品目の動き（新しい順）。place を渡すとその置き場のものだけ
function stkMoves(name, place){
  return (costEntries||[]).filter(e=>e.name===name
      && ((e.project===STOCK_NAME && e.supplier!==STOCK_NAME) || (e.supplier===STOCK_NAME && e.project!==STOCK_NAME))
      && (!place || stockPlaceOf(e)===place))
    .map(e=>{
      const out = e.supplier===STOCK_NAME;
      const tag = e.orderNo;
      const kind = out ? '出庫' : tag===STK_TAG.adjust ? '棚卸し' : tag===STK_TAG['in'] ? '入庫（手入力）'
        : tag===STK_TAG.first ? 'はじめの数' : tag===STK_TAG.cost ? '単価の修正' : '入庫（発注）';
      return { id:e.id, date:e.date||'', kind, qty: out ? -e.qty : e.qty, unit:e.unit||'',
        isCost: tag===STK_TAG.cost, amount:e.amount, place: stockPlaceOf(e),
        manual: String(tag||'').startsWith('在庫:'),
        where: out ? e.project : (tag && !String(tag).startsWith('在庫:') ? `${e.supplier||''} ${tag}` : ''),
        by:(e.createdByName && e.createdByName!=='初期登録') ? e.createdByName : '', note:e.note||'' };
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
  // 在庫場所の絞り込み（カテゴリ・発注先と同じ並びに置く）
  document.getElementById('stock-place').innerHTML =
    ['', ...STOCK_PLACES].map(p=>`<option value="${p}"${stkState.place===p?' selected':''}>${p||'在庫場所：すべて'}</option>`).join('');

  const all = stkList().map(s=>({...s, info: stkInfoOf(s.name)}));
  const q = stkState.q.trim().toLowerCase();
  // カテゴリ・発注先の選択肢は、いま在庫にある品目に付いているものから作る
  const cats = [...new Set(all.map(s=>s.info.cat).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ja'));
  const sups = [...new Set(all.map(s=>s.info.supplier).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ja'));
  if(stkState.cat && stkState.cat!=='-' && !cats.includes(stkState.cat)) stkState.cat = '';
  if(stkState.sup && stkState.sup!=='-' && !sups.includes(stkState.sup)) stkState.sup = '';
  const opt = (v, label, cur)=>`<option value="${esc(v)}"${v===cur?' selected':''}>${esc(label)}</option>`;
  document.getElementById('stock-cat').innerHTML = opt('', 'カテゴリ：すべて', stkState.cat)
    + cats.map(c=>opt(c, c, stkState.cat)).join('') + opt('-', '（カテゴリなし）', stkState.cat);
  document.getElementById('stock-sup').innerHTML = opt('', '発注先：すべて', stkState.sup)
    + sups.map(c=>opt(c, c, stkState.sup)).join('') + opt('-', '（発注先なし）', stkState.sup);
  const hit = (want, has)=> !want || (want==='-' ? !has : has===want);
  const list = all.filter(s=>(stkState.zero || s.qty!==0 || s.pending>0)
    && (!q || s.name.toLowerCase().includes(q))
    && hit(stkState.cat, s.info.cat) && hit(stkState.sup, s.info.supplier));
  const total = all.reduce((sum,s)=>sum+s.value, 0);
  const have = all.filter(s=>s.qty>0).length;
  document.getElementById('stock-sum').innerHTML =
    `${esc(stkState.place||'すべての置き場')}：在庫のある品目 <b>${have}</b>　在庫金額 <b>¥${fmt(total)}</b><span>（税抜・入庫の平均単価で計算）</span>`;
  document.getElementById('stock-zero').checked = stkState.zero;

  if(!all.length){
    el.innerHTML = `<div class="empty">${stkState.place?esc(stkState.place)+'には、':''}在庫の記録がありません。<br>「＋ 入庫」から入れられます</div>`;
    return;
  }
  if(!list.length){
    el.innerHTML = `<div class="empty">${(q||stkState.cat||stkState.sup)?'見つかりませんでした':'いま在庫のある品目はありません（「在庫が0の品目も出す」で、登録してある品目が出ます）'}</div>`;
    return;
  }
  // カテゴリごとにまとめて並べる。順番は、よく使うカテゴリ（STOCK_CATS）→ そのほか → カテゴリなし。
  // カテゴリの中は品目名の順
  const catRank = c => { if(!c) return 9999; const i = STOCK_CATS.indexOf(c); return i>=0 ? i : 500; };
  list.sort((a,b)=> catRank(a.info.cat)-catRank(b.info.cat)
    || String(a.info.cat).localeCompare(String(b.info.cat),'ja')
    || a.name.localeCompare(b.name,'ja'));
  let lastCat = null;
  el.innerHTML = list.map(s=>{
    const nm = stkArg(s.name);
    // カテゴリが変わるところに見出しを入れる（その中の品目数つき）
    let head = '';
    if(s.info.cat !== lastCat){
      lastCat = s.info.cat;
      const n = list.filter(x=>x.info.cat===s.info.cat).length;
      head = `<div class="stk-cat-head">${esc(s.info.cat||'カテゴリなし')}<span>${n}品目</span></div>`;
    }
    return `${head}<div class="stk-row${s.qty<=0?' zero':''}">
      <div class="stk-main" onclick="openStockHistory('${nm}')">
        <div class="stk-name">${esc(s.name)}</div>
        ${s.info.supplier ? `<div class="stk-tags"><span class="stk-sup">${esc(s.info.supplier)}</span></div>` : ''}
        <div class="stk-meta">${s.avgCost ? `平均 ¥${fmt(s.avgCost)}/${esc(s.unit||'')}　在庫金額 ¥${fmt(s.value)}` : '<span class="stk-nocost">単価が入っていません</span>'}${
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
function stkSetCat(v){ stkState.cat = v||''; renderStockPage(); }
function stkSetSup(v){ stkState.sup = v||''; renderStockPage(); }
function stkSetPlace(p){ stkState.place = STOCK_PLACES.includes(p) ? p : ''; renderStockPage(); }

// ── 入庫・出庫・棚卸し・単価の入力 ──

// kind：'in' 入庫／'out' 出庫／'adjust' 棚卸し／'cost' 単価を直す／'info' カテゴリ・発注先を直す。
// name を渡さない入庫は、新しい品目も入れられる
function openStockForm(kind, name){
  // 品目そのもの（単位・平均単価）は、すべての置き場をまとめたものから取る
  const s = name ? stkList('').find(x=>x.name===name) : null;
  if(kind!=='in' && !s){ showToast('品目が見つかりません'); return; }
  stkState.form = { kind, name: s?.name||'', fixed: !!s };
  document.getElementById('stkf-title').textContent =
    { 'in':'入庫する', out:'出庫する', adjust:'数を直す（棚卸し）', cost:'単価・単位を直す', info:'カテゴリ・発注先' }[kind];

  // 品目名：決まっているときは変えられない。新しく入れるときは、いまある品目と品目マスタから候補を出す
  const nameEl = document.getElementById('stkf-name');
  nameEl.value = s?.name||'';
  nameEl.readOnly = !!s;
  if(!s){
    const names = [...new Set([...stkList('').map(x=>x.name), ...((typeof master!=='undefined'?master:[])||[]).map(m=>m.name)])].filter(Boolean);
    document.getElementById('stkf-names').innerHTML = names.slice(0,800).map(n=>`<option value="${esc(n)}">`).join('');
  }
  // 置き場。見ている置き場をはじめに選んでおく（「すべて」を見ているときは可部加工場）
  const placeEl = document.getElementById('stkf-place');
  placeEl.innerHTML = STOCK_PLACES.map(p=>`<option value="${p}">${p}</option>`).join('');
  placeEl.value = stkState.place || STOCK_PLACE_DEFAULT;
  document.getElementById('stkf-place-wrap').style.display = (kind==='cost' || kind==='info') ? 'none' : '';
  // カテゴリ・発注先：直すとき（info）と、新しい品目を入庫するときに出す
  const showInfo = stockItemsReady && (kind==='info' || (kind==='in' && !s));
  document.getElementById('stkf-info-wrap').style.display = showInfo ? '' : 'none';
  if(showInfo){
    const info = s ? stkInfoOf(s.name) : { cat:'', supplier:'', supplierId:null };
    const used = Object.values(stockItems).map(x=>x.cat).filter(Boolean);
    document.getElementById('stkf-cats').innerHTML = [...new Set([...STOCK_CATS, ...used])].map(c=>`<option value="${esc(c)}">`).join('');
    document.getElementById('stkf-cat').value = info.cat||'';
    const supId = info.supplierId || (suppliers||[]).find(x=>x.name===info.supplier)?.id || '';
    document.getElementById('stkf-sup').innerHTML = '<option value="">（決まっていない）</option>'
      + (suppliers||[]).filter(x=>x.name!==STOCK_NAME).sort((a,b)=>String(a.name).localeCompare(String(b.name),'ja'))
          .map(x=>`<option value="${x.id}"${String(x.id)===String(supId)?' selected':''}>${esc(x.name)}</option>`).join('');
  }
  document.getElementById('stkf-qty-wrap').style.display = kind==='info' ? 'none' : '';
  document.getElementById('stkf-note-wrap').style.display = kind==='info' ? 'none' : '';
  document.getElementById('stkf-place-label').textContent =
    kind==='in' ? '入れる置き場' : kind==='out' ? '出す置き場' : '数える置き場';

  const unitEl = document.getElementById('stkf-unit');
  unitEl.value = s?.unit||'';
  // 単位は、いまある品目の入庫では変えられない（品目の中でばらつかないように）。直すのは「単価・単位を直す」から
  unitEl.readOnly = !!s && kind!=='cost';
  document.getElementById('stkf-unit-wrap').style.display = (kind==='in' || kind==='cost') ? '' : 'none';

  document.getElementById('stkf-qty').closest('.fg').style.display = kind==='cost' ? 'none' : '';
  if(kind==='info') document.getElementById('stkf-unit-wrap').style.display = 'none';
  document.getElementById('stkf-qty-label').textContent =
    kind==='in' ? '入庫する数 *' : kind==='out' ? '出庫する数 *' : '実際に数えた数 *';

  // 単価（入庫と、単価を直すとき）。いまある品目は平均単価を入れておく
  document.getElementById('stkf-cost-wrap').style.display = (kind==='in' || kind==='cost') ? '' : 'none';
  document.getElementById('stkf-cost').value = (s && s.avgCost) ? Math.round(s.avgCost) : '';
  document.getElementById('stkf-cost').placeholder = kind==='cost' ? '0' : '空なら、いまの平均単価';
  document.getElementById('stkf-cost-label').textContent =
    kind==='cost' ? '正しい単価（税抜・1つあたり）' : '単価（税抜・1つあたり）';

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
  btn.textContent = { 'in':'入庫する', out:'出庫する', adjust:'この数に直す', cost:'直す', info:'保存' }[kind];
  btn.disabled = false;
  stkFormPlaceChanged();
  document.getElementById('stock-form-modal').classList.add('open');
  setTimeout(()=>(kind==='cost' ? document.getElementById('stkf-cost') : s ? document.getElementById('stkf-qty') : nameEl).focus(), 80);
}
function closeStockForm(){ document.getElementById('stock-form-modal').classList.remove('open'); stkState.form = null; }

// 置き場を変えたら、その置き場のいまの数を出し直す
function stkFormPlaceChanged(){
  const f = stkState.form; if(!f) return;
  const place = document.getElementById('stkf-place').value;
  const here = f.name ? stkList(place).find(x=>x.name===f.name) : null;
  const all  = f.name ? stkList('').find(x=>x.name===f.name) : null;
  const now = f.name ? `${place}のいまの在庫 ${stkNum(here?.qty||0)}${all?.unit||''}` : '';
  document.getElementById('stkf-sub').textContent =
    f.kind==='in' ? (f.name ? now : '発注を通さずに入ってきたもの（余り材を戻した、など）を入れます')
    : f.kind==='out' ? `${now}　出庫した分は、選んだ案件の原価に入ります`
    : f.kind==='info' ? 'カテゴリと、いつもの発注先を入れておくと、一覧で絞り込めます'
    : f.kind==='adjust' ? `${now}　実際に数えた数を入れると、その数に直ります`
    : `いまの平均単価 ¥${fmt(all?.avgCost||0)}/${all?.unit||''}　在庫の金額と、これから出庫する分の原価が変わります`;
  if(f.kind==='adjust') document.getElementById('stkf-qty').value = stkNum(here?.qty||0);
  else if(document.activeElement?.id!=='stkf-qty' && f.kind!=='cost' && !document.getElementById('stkf-qty').value) document.getElementById('stkf-qty').value = '';
}

// 全角の数字で入れても通す
function stkParseNum(v){
  const s = String(v??'').replace(/[０-９．]/g, c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/[,，\s¥￥]/g,'');
  if(s==='') return NaN;
  return Number(s);
}

async function saveStockForm(){
  const f = stkState.form; if(!f || stkState.busy) return;
  const name  = document.getElementById('stkf-name').value.trim();
  const unit  = document.getElementById('stkf-unit').value.trim();
  const place = document.getElementById('stkf-place').value || STOCK_PLACE_DEFAULT;
  const note  = document.getElementById('stkf-note').value.trim();
  let qty = stkParseNum(document.getElementById('stkf-qty').value);
  if(!name){ showToast('品目名を入れてください'); return; }
  const all  = stkList('').find(x=>x.name===name);       // 品目そのもの（すべての置き場）
  const here = stkList(place).find(x=>x.name===name);    // その置き場の数
  const hereQty = here?.qty||0;

  // カテゴリ・発注先だけを直す
  if(f.kind==='info'){
    stkState.busy = true;
    const ok = await stkSaveInfo(name);
    stkState.busy = false;
    if(!ok) return;
    closeStockForm();
    renderStockPage();
    if(document.getElementById('stock-hist-modal')?.classList.contains('open')) openStockHistory(name);
    showToast('保存しました');
    return;
  }
  // 新しい品目の入庫では、カテゴリ・発注先もいっしょに入れられる（入れた分だけ保存する）
  const withInfo = f.kind==='in' && !f.fixed && stockItemsReady
    && (document.getElementById('stkf-cat').value.trim() || document.getElementById('stkf-sup').value);

  let cost = null, project = '';
  if(f.kind==='cost'){
    qty = 0;
    const c = stkParseNum(document.getElementById('stkf-cost').value);
    if(Number.isFinite(c) && c<0){ showToast('正しい単価を入れてください'); return; }
    cost = Number.isFinite(c) ? c : null;
    if(!unit){ showToast('単位を入れてください（本・枚・箱など）'); return; }
    const sameCost = cost===null || (all && Math.round(all.avgCost)===Math.round(cost));
    if(sameCost && unit===(all?.unit||'')){ closeStockForm(); showToast('変わっていません'); return; }
    // 在庫の数が 0 の品目は金額を持てないので、単価は入庫のときに入れてもらう
    if(cost!==null && cost>0 && all && !(all.allIn>0)){
      if(!confirm('この品目はいま在庫が無いので、単価は直せません（単位だけ直します）。\n単価は、入庫するときに入れてください。よろしいですか？')) return;
      cost = null;
    }
  } else if(!Number.isFinite(qty) || (f.kind!=='adjust' && qty<=0) || qty<0){
    showToast('数を入れてください'); return;
  }
  if(f.kind==='in'){
    if(!all && !unit){ showToast('単位を入れてください（本・枚・箱など）'); return; }
    const c = stkParseNum(document.getElementById('stkf-cost').value);
    if(Number.isFinite(c)){ if(c<0){ showToast('単価が正しくありません'); return; } cost = c; }
    else if(!all || !all.avgCost){
      if(!confirm('単価が入っていません。0円の在庫として入れますか？\n（出庫したとき、案件の原価に金額が入りません。あとから「単価を直す」で入れられます）')) return;
      cost = 0;
    }
  }
  if(f.kind==='out'){
    project = document.getElementById('stkf-proj').value;
    if(!project){ showToast('出庫先の案件を選んでください'); return; }
    if(qty > hereQty){ showToast(`在庫が足りません。${place}のいまの在庫は ${stkNum(hereQty)}${all?.unit||''} です`, 6000); return; }
  }
  if(f.kind==='adjust'){
    if(qty===hereQty){ closeStockForm(); showToast('数は合っています'); return; }
    if(!confirm(`${place}の「${name}」の在庫を ${stkNum(hereQty)} → ${stkNum(qty)}${all?.unit||''} に直します。よろしいですか？`)) return;
  }

  stkState.busy = true;
  const btn = document.getElementById('stkf-save');
  btn.disabled = true;
  const { data, error } = await sb.rpc('app_stock_move', {
    p_kind: f.kind, p_name: name, p_unit: unit, p_qty: qty, p_unit_cost: cost,
    p_project: project, p_note: note, p_place: place });
  stkState.busy = false;
  if(error){
    btn.disabled = false;
    const code = String(error.code||''), msg = String(error.message||'');
    showToast((code==='PGRST202' || code==='42883' || /app_stock_move|stock_place/.test(msg) && /find|exist|schema cache/i.test(msg))
      ? 'データベースの準備が必要です。supabase/migration-genba98.sql を実行してください'
      : '保存できませんでした：'+msg, 8000);
    return;
  }
  // 単位を直したときは、前からある明細も書き換わっているので、取り直す
  if(f.kind==='cost' && typeof refetchOrdersAndCost==='function'){ try{ await refetchOrdersAndCost(); }catch(_){} }
  // 返ってきた明細を手元に足す（取り直さなくても、在庫と原価にすぐ出る）
  if(data && data.id!=null && typeof costRowTo==='function'){
    costEntries = [costRowTo(data), ...(costEntries||[]).filter(e=>e.id!==data.id)];
  }
  if(withInfo && !stockItems[name]) await stkSaveInfo(name, true);
  closeStockForm();
  renderStockPage();
  if(document.getElementById('stock-hist-modal')?.classList.contains('open')) openStockHistory(name);
  try{ if(typeof renderCost==='function' && document.getElementById('page-cost')?.classList.contains('active')) renderCost(); }catch(_){}
  const u = all?.unit||unit;
  showToast(f.kind==='in' ? `${place}に ${stkNum(qty)}${u} 入庫しました`
          : f.kind==='out' ? `${stkNum(qty)}${u} 出庫しました（${project} の原価に入ります）`
          : f.kind==='cost' ? '直しました'
          : '在庫の数を直しました');
}

// カテゴリ・発注先を保存する。quiet … 失敗しても何も出さない（入庫のついでに入れるとき）
async function stkSaveInfo(name, quiet){
  const cat = document.getElementById('stkf-cat').value.trim();
  const supplierId = Number(document.getElementById('stkf-sup').value) || null;
  const { error } = await sb.from('stock_items').upsert({
    name, cat, supplier_id: supplierId, updated_at: new Date().toISOString(), updated_by: currentUserDisplayName||'' },
    { onConflict:'name' });
  if(error){
    if(!quiet){
      const msg = String(error.message||'');
      showToast(/stock_items/.test(msg) && /find|exist|schema cache/i.test(msg)
        ? 'データベースの準備が必要です。supabase/migration-genba101.sql を実行してください'
        : '保存できませんでした：'+msg, 8000);
    }
    return false;
  }
  stockItems[name] = { cat, supplierId };
  return true;
}

// ── 品目ごとの動き ──

function openStockHistory(name){
  const all = stkList('').find(x=>x.name===name);
  if(!all) return;
  const nm = stkArg(all.name);
  const u = esc(all.unit||'');
  // 置き場ごとの数
  const per = STOCK_PLACES.map(p=>{ const s = stkList(p).find(x=>x.name===name); return `${p} <b>${stkNum(s?.qty||0)}${u}</b>`; }).join('　');
  document.getElementById('stkh-title').textContent = all.name;
  const info = stkInfoOf(name);
  document.getElementById('stkh-sub').innerHTML =
    `${(info.cat||info.supplier) ? `<span class="stk-tags">${info.cat?`<span class="stk-cat">${esc(info.cat)}</span>`:''}${info.supplier?`<span class="stk-sup">${esc(info.supplier)}</span>`:''}</span><br>` : ''}${per}<br>${(typeof stkMasterOf==='function') ? (stkMasterOf(name) ? '<span class="stk-linked">品目マスタにあります</span>　' : '<span class="stk-nocost">品目マスタにありません</span>　') : ''}${all.avgCost ? `平均 ¥${fmt(all.avgCost)}/${u}` : '単価が入っていません'}${
      all.pending ? `　うち納品待ち ${stkNum(all.pending)}${u}` : ''}`;
  document.getElementById('stkh-btns').innerHTML =
    `<button type="button" class="btn sm primary" ${all.qty>0?'':'disabled'} onclick="openStockForm('out','${nm}')">出庫</button>
     <button type="button" class="btn sm" onclick="openStockForm('in','${nm}')">入庫</button>
     <button type="button" class="btn sm" onclick="openStockForm('adjust','${nm}')">数を直す（棚卸し）</button>
     <button type="button" class="btn sm" onclick="openStockForm('cost','${nm}')">単価・単位を直す</button>`
    + (stockItemsReady ? `<button type="button" class="btn sm" onclick="openStockForm('info','${nm}')">カテゴリ・発注先</button>` : '')
    + (typeof openStockLink==='function' ? `<button type="button" class="btn sm" onclick="openStockLink('${nm}')">品目マスタと紐づける</button>` : '')
    // 削除は社員（管理者・一般社員）
    + (stkCanDelete() ? `<button type="button" class="btn sm danger" onclick="deleteStockItem('${nm}')">この品目を削除</button>` : '');
  const moves = stkMoves(name);
  document.getElementById('stkh-list').innerHTML = moves.length ? moves.map(m=>`
    <div class="stk-move">
      <div class="stk-move-top"><span>${esc(String(m.date).replace(/-/g,'/'))}　${esc(m.kind)}　${esc(m.place)}</span>
        ${m.isCost ? `<b>${m.amount>0?'+':''}¥${fmt(m.amount)}</b>`
                   : `<b class="${m.qty<0?'out':'in'}">${m.qty>0?'+':''}${stkNum(m.qty)}${esc(m.unit)}</b>`}</div>
      ${(m.where||m.by||m.note) ? `<div class="stk-move-sub">${[m.where?esc(m.where):'', m.by?esc(m.by):'', m.note?esc(m.note):''].filter(Boolean).join('　')}</div>` : ''}
      ${(m.manual && stkCanDelete()) ? `<button type="button" class="stk-move-del" onclick="deleteStockMove(${Number(m.id)}, '${nm}')">この記録を取り消す</button>` : ''}
    </div>`).join('') : '<div class="empty" style="padding:16px">動きの記録がありません</div>';
  document.getElementById('stock-hist-modal').classList.add('open');
}
function closeStockHistory(){ document.getElementById('stock-hist-modal').classList.remove('open'); }

// ── 削除（社員ならだれでも。業者さん・お客様は不可） ──

function stkCanDelete(){ return currentUserRole==='staff' || currentUserRole==='carpenter'; }

function stkDeleteFail(error, what){
  const code = String(error?.code||''), msg = String(error?.message||'');
  showToast((code==='PGRST202' || code==='42883' || /app_stock_delete/.test(msg) && /find|exist|schema cache/i.test(msg))
    ? 'データベースの準備が必要です。supabase/migration-genba100.sql を実行してください'
    : `${what}：${msg||'通信できませんでした'}`, 8000);
}
// 削除のあと、原価の明細を取り直して描き直す
async function stkAfterDelete(name){
  if(typeof refetchOrdersAndCost==='function'){ try{ await refetchOrdersAndCost(); }catch(_){} }
  renderStockPage();
  if(name && stkList('').some(x=>x.name===name)) openStockHistory(name);
  else closeStockHistory();
}

// 品目を削除する。
//   手で入れた記録しか無い品目 … 記録ごと消える
//   発注で入れた記録や出庫の記録がある品目 … 記録は残し、数を 0 にする（ふだんの一覧からは隠れる）
async function deleteStockItem(name){
  if(!stkCanDelete()){ showToast('削除できるのは、きよかわの社員だけです'); return; }
  if(stkState.busy) return;
  const hasHistory = stkMoves(name).some(m=>!m.manual);
  if(!confirm(hasHistory
    ? `「${name}」を在庫から外しますか？\n\nこの品目には、発注で入れた記録か、出庫の記録があります。\n記録は消さずに、すべての置き場の数を 0 にします（ふだんの一覧からは隠れます）。`
    : `「${name}」を在庫から削除しますか？\n\n入庫・棚卸しの記録ごと消えます。元には戻せません。`)) return;
  stkState.busy = true;
  const { data, error } = await sb.rpc('app_stock_delete_item', { p_name: name });
  stkState.busy = false;
  if(error){ stkDeleteFail(error, '削除できませんでした'); return; }
  if(data?.mode!=='zero'){
    delete stockItems[name];
    sb.from('stock_items').delete().eq('name', name).then(()=>{}, ()=>{});
  }
  await stkAfterDelete(data?.mode==='zero' ? name : null);
  showToast(data?.mode==='zero' ? '在庫の数を 0 にしました（記録は残っています）' : '在庫から削除しました');
}

// 手で入れた動きを1件取り消す（入れまちがい用）
async function deleteStockMove(id, name){
  if(!stkCanDelete()){ showToast('取り消せるのは、きよかわの社員だけです'); return; }
  if(stkState.busy) return;
  const m = stkMoves(name).find(x=>x.id===id);
  if(!m) return;
  const what = m.isCost ? `単価の修正（${m.amount>0?'+':''}¥${fmt(m.amount)}）` : `${m.kind} ${m.qty>0?'+':''}${stkNum(m.qty)}${m.unit}`;
  if(!confirm(`${String(m.date).replace(/-/g,'/')} の「${what}」を取り消しますか？\n${m.kind==='出庫' ? `${m.where} の原価からも消えます。` : ''}元には戻せません。`)) return;
  stkState.busy = true;
  const { error } = await sb.rpc('app_stock_delete_move', { p_id: id });
  stkState.busy = false;
  if(error){ stkDeleteFail(error, '取り消せませんでした'); return; }
  await stkAfterDelete(name);
  showToast('記録を取り消しました');
}
