// ════ レシート読み取り（カメラ→Claude Vision→カートに追加） ════

let receiptItems = [];
// 読み取った明細の単価が税込かどうか。レシートによって違うので読み取り側に判定してもらう。
// 原価は税抜で持つので、税込のときだけ税を抜く
let receiptTaxIncluded = true;
let receiptTaxReason = '';     // AIが税込・税抜をそう見た理由（画面に小さく出す）

// ════ レシートに印字された支払額に「合わせ込む」ための持ち物 ════
//
// 税込 → 税抜 → 税込 と往復すると、1円未満の丸めのせいで数円ずれる。
// 店によって端数の扱い（切り捨て・切り上げ・四捨五入）も、税を計算する単位
// （1行ごと・税率ごとの小計・レシート全体）も違うので、計算では合わせきれない。
//
// レシートには最終的に支払った税込金額が必ず印字されている。そこを「正」にして、
// 差は消費税の額で吸収する（消費税は、実際にお店が受け取った額そのものなので、
// 原価をいじるより素直で、原価管理の数字も動かさない）。
let receiptPaidTotal = null;   // 印字された支払額（税込）
let receiptTaxTotals = [];     // 税率ごとの「対象額・消費税額」の印字
let receiptImageBase64 = null; // 整えたレシートの画像（台帳に残す）
let receiptShop = '';          // 店名
let receiptPaidOn = '';        // レシートの日付（買った日）

// カートに入れたレシートぶんの消費税（レシートに印字された額）。
// 印字された税額は、お店が実際に受け取った額そのもの。こちらで計算し直すと
// 端数処理の違いで1円ずれるので、印字があればそれを使う
let cartTaxPrinted = null;
let cartTaxPrintedBase = null;   // そのときのレシート品目の小計。変わったら使わない
// 台帳に残すための材料（発注確定のときに使う）
let cartReceiptRecord = null;
function resetCartTaxPrinted(){
  cartTaxPrinted = null; cartTaxPrintedBase = null; cartReceiptRecord = null;
  // 次のレシートに前の写真が残らないようにする
  rscanSrc = null; rscanQuad = null; rscanDone = null;
}
// いまカートに入っているレシート品目の小計（税抜。行の端数調整を含む）
function cartReceiptSubtotal(){
  return (typeof cart!=='undefined' ? cart : []).filter(c=>c._receipt)
    .reduce((s,c)=>s + (Number(c.cost)||0)*(Number(c.qty)||0) + (Number(c.costAdjust)||0), 0);
}
// 発注に使う消費税。品目をいじったあとは合わせ込みが意味を失うので使わない
function orderPrintedTax(){
  if(cartTaxPrinted==null || cartTaxPrintedBase==null) return null;
  return cartReceiptSubtotal()===cartTaxPrintedBase ? cartTaxPrinted : null;
}

// ════ レシートの内訳を「正」として、原価（税抜）と消費税を確定する ════
//
// 考え方（Codexにも相談して決めた）
//   ・消費税は、レシートに印字された額をそのまま使う。こちらで足し引きしない
//     （申告に使う数字なので、端数のつじつま合わせに使ってはいけない）
//   ・税込→税抜の丸めで出る数円の残りは、原価側で吸収する
//     その税率のいちばん金額の大きい行に「端数」として寄せ、合計がぴったり合うようにする
//   ・税率ごとに1回だけ端数処理する（1品目ずつ丸めて足すのは認められていない）
function receiptSettle(){
  const rates = [...new Set(receiptItems.map(taxRateOf))].sort((a,b)=>b-a);

  // レシートに印字された税率ごとの内訳
  const printed = new Map();
  (receiptTaxTotals||[]).forEach(t=>{
    const r = Number(t.rate);
    if(!TAX_RATES.includes(r)) return;
    const target = Math.round(Number(t.target)||0);
    const tax = (t.tax==null || !Number.isFinite(Number(t.tax))) ? null : Math.round(Number(t.tax));
    printed.set(r, { incl: t.targetTaxIncluded!==false ? target : target + (tax ?? Math.round(target*r/100)), tax });
  });

  const out = { lines: [], rows: [], subtotal:0, tax:0, total:0, warns: [], taxFromPrint:false };

  for(const rate of rates){
    const items = receiptItems.filter(it=>taxRateOf(it)===rate);
    // その税率の税込対象額（明細から）
    const inclFromItems = items.reduce((s,it)=>
      s + (receiptTaxIncluded ? it.price*it.qty : Math.round(it.price*it.qty*(1+rate/100))), 0);
    const p = printed.get(rate);
    if(p && Math.abs(p.incl - inclFromItems) > Math.max(2, Math.round(inclFromItems*0.01))){
      out.warns.push(`${taxRateLabel(rate)}：レシートの対象額 ¥${fmt(p.incl)} と明細の合計 ¥${fmt(inclFromItems)} が違います`);
    }
    const incl = p ? p.incl : inclFromItems;
    // 消費税。印字があればそのまま（お店の端数処理そのもの）
    const tax = (p && p.tax!=null) ? p.tax : Math.round(incl * rate / (100 + rate));
    if(p && p.tax!=null) out.taxFromPrint = true;
    const base = incl - tax;                        // その税率の税抜対象額

    // 行ごとの税抜額。丸めの残りは、いちばん金額の大きい行に寄せる
    const cost = items.map(it => receiptTaxIncluded
      ? Math.round(it.price / (1 + rate/100))
      : Math.round(it.price));
    const sum = items.reduce((s,it,i)=>s + cost[i]*it.qty, 0);
    let big = 0;
    items.forEach((it,i)=>{ if(cost[i]*it.qty > cost[big]*items[big].qty) big = i; });
    const adj = items.map(()=>0);
    if(items.length) adj[big] = base - sum;

    items.forEach((it,i)=>out.lines.push({ ...it, cost:cost[i], costAdjust:adj[i], taxRate:rate }));
    out.rows.push({ rate, base, tax, incl, adjust: items.length ? adj[big] : 0 });
    out.subtotal += base; out.tax += tax; out.total += incl;
  }

  // 印字された支払額との突き合わせ。値引き・ポイントがあると商品代金と支払額は別になる
  if(receiptPaidTotal!=null && receiptPaidTotal>0 && receiptPaidTotal !== out.total){
    out.warns.push(`レシートの支払額 ¥${fmt(receiptPaidTotal)} と、税率ごとの合計 ¥${fmt(out.total)} が違います`
      + `（値引き・ポイントぶんかもしれません）`);
  }
  return out;
}
function setReceiptTaxIncluded(v){ receiptTaxIncluded = !!v; receiptTaxReason=''; renderReceiptItems(); }
// 表示・登録に使う税抜の単価。税率は品目ごと（10／8／非課税）
function receiptCostEx(price, rate){
  const r = TAX_RATES.includes(Number(rate)) ? Number(rate) : 10;
  return receiptTaxIncluded ? Math.round(price / (1 + r/100)) : Math.round(price);
}
function setReceiptRate(i, rate){
  if(!receiptItems[i]) return;
  receiptItems[i].taxRate = Number(rate);
  renderReceiptItems();
}

function openReceiptCamera() {
  document.getElementById('receipt-file-input').click();
}

// 写真は大きいまま送ると失敗しやすいので、長辺2200pxくらいに縮めてから送る
// （明細の文字が読める程度は保ちつつ、通信量を減らす）
function receiptShrinkImage(file){
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 2200;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      if (scale >= 1 && file.size <= 3*1024*1024) { resolve(null); return; }  // そのままで十分小さい
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width*scale); cv.height = Math.round(img.height*scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      resolve({ base64: cv.toDataURL('image/jpeg', 0.85).split(',')[1], mediaType: 'image/jpeg' });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を開けませんでした')); };
    img.src = url;
  });
}

// 呼び出しの失敗から、本当の理由を取り出す。
// そのままだと「Edge Function returned a non-2xx status code」としか出ない
async function receiptErrorText(error, data){
  if (data?.error) return data.error;
  if (error?.context && typeof error.context.json === 'function') {
    try { const j = await error.context.json(); if (j?.error) return j.error; } catch (_) {}
    try { const t = await error.context.text(); if (t) return t.slice(0, 200); } catch (_) {}
  }
  const m = error?.message || '';
  if (/Failed to send|NetworkError|Failed to fetch/i.test(m)) {
    return '読み取りの機能につながりませんでした。通信をご確認ください';
  }
  return m || '読み取りに失敗しました';
}

// ════ 写真を整えてから読み取る ════
//
// 斜めから撮ったレシートは台形にゆがみ、影や机・指が写り込む。
// 先に「切り抜き・ゆがみ直し・白黒」をしてから読ませると、読み取りの精度が上がり、
// 台帳に並べたときも見やすい（整える処理は js/receipt-scan.js）。
let rscanSrc = null;      // 元の写真（canvas）
let rscanQuad = null;     // いまの四隅（元の写真の座標）
let rscanView = 1;        // 画面に映している倍率
let rscanDone = null;     // 仕上がり（canvas）
let rscanMono = true;     // 白黒にするか（選んだら覚えておく）

async function onReceiptFileChange(input) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';

  const isPdf = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name || '');
  if (isPdf && file.size > 25*1024*1024) { showToast('PDFが大きすぎます（25MBまで）。ページを分けてください'); return; }

  // 写真のときは先に整える（PDFはもう平らなのでそのまま読む）。
  //
  // 自動で見つけた範囲が信用できるときは、確認の画面を出さずにそのまま読み取る。
  // 毎回四隅を触るのは手間なので、あやしいときだけ聞く。
  // 切り抜きが気に入らなければ、確認画面の「切り抜きを直す」からやり直せる。
  if (!isPdf && typeof rsScan === 'function') {
    showReceiptLoading(true);
    try {
      const s = await rsScan(file);
      rscanSrc = s.source; rscanQuad = s.quad;
      if (s.confident) {
        const done = rsFinish(rscanSrc, rscanQuad, { mono: rscanMono });
        rscanDone = done;
        await receiptReadFile(null, false, { base64: rsToJpeg(done, 0.85), mediaType:'image/jpeg', scanned: done });
        return;
      }
      showReceiptLoading(false);
      openRscan(s.auto, s.why);
      return;
    } catch (e) {
      showReceiptLoading(false);
      console.warn('写真を整えられませんでした（そのまま読み取ります）', e);
      // 整えられなくても、写真そのままで読み取りに進む
    }
  }
  await receiptReadFile(file, isPdf);
}

// 読み取ったあとに切り抜きをやり直す（自動の結果が気に入らないとき）
function rscanRedo(){
  if(!rscanSrc){ showToast('写真が残っていません。もう一度読み込んでください'); return; }
  closeReceiptConfirm();
  openRscan(true, '');
}

// 範囲を決める画面
function openRscan(auto, why){
  const cv = document.getElementById('rscan-canvas');
  const maxW = Math.min(480, window.innerWidth - 72);
  rscanView = Math.min(1, maxW / rscanSrc.width, 420 / rscanSrc.height);
  cv.width = Math.round(rscanSrc.width * rscanView);
  cv.height = Math.round(rscanSrc.height * rscanView);
  cv.getContext('2d').drawImage(rscanSrc, 0, 0, cv.width, cv.height);
  document.getElementById('rscan-note').textContent = why ? why + '。四隅を直してください'
    : auto ? '自動で見つけた範囲です' : '範囲が分からなかったので全体にしています';
  const mono = document.getElementById('rscan-mono'); if(mono) mono.checked = rscanMono;
  document.getElementById('rscan-modal').classList.add('open');
  rscanPlaceDots();
  rscanPreview();
}
function closeRscan(){
  document.getElementById('rscan-modal').classList.remove('open');
  rscanSrc = null; rscanQuad = null; rscanDone = null;
}
function rscanReset(){
  rscanQuad = [[0,0],[rscanSrc.width,0],[rscanSrc.width,rscanSrc.height],[0,rscanSrc.height]];
  rscanPlaceDots(); rscanPreview();
}
function rscanPlaceDots(){
  document.querySelectorAll('#rscan-stage .rscan-dot').forEach(d=>{
    const p = rscanQuad[Number(d.dataset.i)];
    d.style.left = (p[0]*rscanView) + 'px';
    d.style.top  = (p[1]*rscanView) + 'px';
  });
}
// 仕上がりを小さく出して、決める前に確かめられるようにする
let _rscanTimer = null;
function rscanPreview(){
  clearTimeout(_rscanTimer);
  _rscanTimer = setTimeout(()=>{
    const mono = document.getElementById('rscan-mono')?.checked !== false;
    rscanMono = mono;
    try{
      rscanDone = rsFinish(rscanSrc, rscanQuad, { mono });
      const pv = document.getElementById('rscan-preview');
      pv.width = rscanDone.width; pv.height = rscanDone.height;
      pv.getContext('2d').drawImage(rscanDone, 0, 0);
    }catch(e){ console.warn('仕上がりを作れませんでした', e); }
  }, 60);
}
// 四隅の丸を指で動かす
(function rscanDrag(){
  let active = null;
  const stage = () => document.getElementById('rscan-stage');
  const onDown = e => {
    const d = e.target.closest('.rscan-dot');
    if(!d) return;
    active = Number(d.dataset.i);
    e.preventDefault();
  };
  const onMove = e => {
    if(active===null || !rscanSrc) return;
    const box = stage().getBoundingClientRect();
    const pt = e.touches ? e.touches[0] : e;
    const x = Math.max(0, Math.min(rscanSrc.width,  (pt.clientX - box.left) / rscanView));
    const y = Math.max(0, Math.min(rscanSrc.height, (pt.clientY - box.top)  / rscanView));
    rscanQuad[active] = [x, y];
    rscanPlaceDots();
    rscanPreview();
    e.preventDefault();
  };
  const onUp = () => { active = null; };
  document.addEventListener('pointerdown', onDown);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
})();

// この範囲で読み取る
async function rscanRead(){
  if(!rscanDone){ showToast('仕上がりを作れませんでした'); return; }
  const base64 = rsToJpeg(rscanDone, 0.85);
  const done = rscanDone;
  document.getElementById('rscan-modal').classList.remove('open');
  await receiptReadFile(null, false, { base64, mediaType:'image/jpeg', scanned:done });
}

// 読み取りにかける（写真そのまま／整えたあと／PDF、どれでもここを通る）
async function receiptReadFile(file, isPdf, ready) {
  showReceiptLoading(true);

  try {
    let base64 = ready?.base64, mediaType = ready?.mediaType || file?.type || '';
    if (!base64 && !isPdf) {
      const small = await receiptShrinkImage(file).catch(() => null);
      if (small) { base64 = small.base64; mediaType = small.mediaType; }
    }
    if (!base64) base64 = await fileToBase64(file);
    receiptImageBase64 = (mediaType||'').includes('image') ? base64 : null;   // 台帳に残す用

    const { data, error } = await sb.functions.invoke('read-receipt', {
      // スマホから選ぶと種類が空のことがあるので、ファイル名も送って判断してもらう
      // 整えた画像を渡すときは file が無いので、名前は空でよい（ここで落ちていた）
      body: { file: base64, image: base64, mediaType, fileName: file?.name || '' }
    });

    if (error || data?.error) throw new Error(await receiptErrorText(error, data));
    if (!data?.items?.length) {
      showReceiptLoading(false);
      showToast(data?.reason || '品目を読み取れませんでした。明細の表が全部入るように撮り直すか、PDFで読み込んでください');
      return;
    }

    receiptItems = data.items.map((it, i) => ({
      _id: 'rc_' + i,
      name: it.name || '不明',
      qty: parseFloat(it.qty) || 1,
      unit: it.unit || '式',
      price: Math.round(parseFloat(it.price) || parseFloat(it.amount) || 0),
      amount: Math.round(parseFloat(it.amount) || 0),
      taxRate: TAX_RATES.includes(Number(it.taxRate)) ? Number(it.taxRate) : 10,
    }));

    receiptTaxIncluded = data.taxIncluded !== false;
    receiptTaxReason = String(data.taxIncludedReason || '');
    receiptPaidTotal = (data.paidTotal==null || !(Number(data.paidTotal)>0)) ? null : Math.round(Number(data.paidTotal));
    receiptTaxTotals = Array.isArray(data.taxTotals) ? data.taxTotals : [];
    receiptShop = String(data.shop || '');
    receiptPaidOn = /^\d{4}-\d{2}-\d{2}$/.test(String(data.paidOn||'')) ? data.paidOn : '';
    if(ready?.scanned) receiptImageBase64 = rsToJpeg(ready.scanned, 0.85);
    showReceiptLoading(false);
    if (data.reason) showToast(data.reason);
    openReceiptConfirm();
  } catch (e) {
    showReceiptLoading(false);
    showToast('読み取りエラー：' + e.message);
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result; // data:image/jpeg;base64,XXXX
      const b64 = result.split(',')[1];
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showReceiptLoading(show) {
  const btn = document.getElementById('receipt-scan-btn');
  if (!btn) return;
  btn.disabled = show;
  btn.innerHTML = show
    ? '<span style="display:inline-block;animation:spin 1s linear infinite">⟳</span> 読み取り中…'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="13" height="13" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> レシート読み取り';
}

function openReceiptConfirm() {
  renderReceiptItems();
  document.getElementById('receipt-confirm-overlay').classList.add('open');
}

function closeReceiptConfirm() {
  document.getElementById('receipt-confirm-overlay').classList.remove('open');
}

function renderReceiptItems() {
  const el = document.getElementById('receipt-item-list');
  if (!receiptItems.length) { el.innerHTML = '<div class="empty">品目なし</div>'; return; }

  const _st = receiptSettle();   // 行ごとの原価をここで一度だけ確定させる
  el.innerHTML = (rscanSrc ? `<div class="rr-tax" style="justify-content:space-between">
    <span>写真は自動で切り抜いて整えました</span>
    <button type="button" class="btn xs" onclick="rscanRedo()">切り抜きを直す</button>
  </div>` : '') + `<div class="rr-tax">
    <span>レシートの単価は</span>
    <button class="btn xs${receiptTaxIncluded?' primary':''}" onclick="setReceiptTaxIncluded(true)">税込</button>
    <button class="btn xs${receiptTaxIncluded?'':' primary'}" onclick="setReceiptTaxIncluded(false)">税抜</button>
    <span class="rr-tax-note">${receiptTaxIncluded
      ? '品目ごとの税率で税を抜いて、原価（税抜）にします'
      : 'そのまま原価（税抜）として登録します'}${
      receiptTaxReason ? `<br>AIの見立て：${esc(receiptTaxReason)}` : ''}</span>
  </div>` + receiptItems.map((it, i) => `
    <div class="receipt-row" id="rr-${i}">
      <div class="rr-name">
        <input class="rr-input" value="${esc(it.name)}" onchange="receiptItems[${i}].name=this.value">
      </div>
      <div class="rr-qty">
        <input class="rr-input num" type="number" min="0.01" step="any" value="${it.qty}" onchange="receiptItems[${i}].qty=parseFloat(this.value)||1;updateReceiptAmt(${i})">
        <input class="rr-input unit" value="${esc(it.unit)}" onchange="receiptItems[${i}].unit=this.value">
      </div>
      <div class="rr-price">
        <span style="font-size:11px;color:var(--text-muted)">${receiptTaxIncluded?'税込':'税抜'}単価</span>
        <input class="rr-input num" type="number" min="0" step="1" value="${it.price}" onchange="receiptItems[${i}].price=parseFloat(this.value)||0;updateReceiptAmt(${i})">
      </div>
      <div class="rr-rate">
        ${TAX_RATES.map(r=>`<button class="btn xs${taxRateOf(it)===r?' primary':''}" onclick="setReceiptRate(${i},${r})">${taxRateLabel(r)}</button>`).join('')}
      </div>
      <div class="rr-amt" style="flex-direction:column;align-items:flex-end;gap:1px">
        <span style="font-size:11px">${receiptTaxIncluded?'税込':'税抜'} ¥<span id="rr-amt-${i}">${fmt(it.price * it.qty)}</span></span>
        <span style="font-size:10px;color:var(--text-muted)">原価 ¥${fmt(receiptLineBase(it, _st))}</span>
      </div>
      <button class="btn danger xs" onclick="removeReceiptItem(${i})" style="flex-shrink:0">×</button>
    </div>`).join('') + receiptRateSummaryHtml() + '<div id="receipt-check" class="rr-check"></div>';

  updateReceiptTotals();
}

// 税率ごとの内訳。レシートの「8%対象」「10%対象」と見比べられるように出す
function receiptRateSummaryHtml(){
  const by = new Map();
  receiptItems.forEach(it=>{
    const r = taxRateOf(it);
    by.set(r, (by.get(r)||0) + it.price * it.qty);
  });
  if(by.size <= 1) return '';
  const rows = [...by.entries()].sort((a,b)=>b[0]-a[0])
    .map(([r,amt])=>`<span class="rr-rate-chip">${r===0?'非課税':r+'%対象'}　¥${fmt(amt)}</span>`).join('');
  return `<div class="rr-rate-sum">${receiptTaxIncluded?'税込':'税抜'}の内訳　${rows}</div>`;
}

function updateReceiptTotals(){
  const st = receiptSettle();
  const tEl = document.getElementById('receipt-total');
  if (tEl) tEl.textContent = fmt(st.total);
  const exEl = document.getElementById('receipt-total-ex');
  if (exEl) exEl.textContent = fmt(st.subtotal);
  renderReceiptCheck(st);
}

// その行の確定した税抜額（端数を寄せた行は、そのぶんを含む）
function receiptLineBase(it, st){
  const line = (st || receiptSettle()).lines.find(l=>l._id===it._id);
  return line ? line.cost*line.qty + line.costAdjust : receiptCostEx(it.price, it.taxRate)*it.qty;
}

// レシートの内訳と、どう合わせたかを見せる
function renderReceiptCheck(st){
  const el = document.getElementById('receipt-check');
  if(!el) return;
  st = st || receiptSettle();
  const rows = st.rows.map(r=>
    `${r.rate===0?'非課税':r.rate+'%'}：税抜 ¥${fmt(r.base)}＋消費税 ¥${fmt(r.tax)}＝¥${fmt(r.incl)}`
    + (r.adjust ? `<span class="rr-check-fix">（うち端数 ${r.adjust>0?'＋':'−'}¥${fmt(Math.abs(r.adjust))}）</span>` : '')
  ).join('<br>');
  el.className = 'rr-check' + (st.warns.length ? ' warn' : '');
  el.innerHTML = (st.warns.length ? '⚠ ' + st.warns.map(esc).join('<br>⚠ ') + '<br>' : '')
    + rows
    + `<br>合計 <b>¥${fmt(st.total)}</b>`
    + (st.taxFromPrint ? '（消費税はレシートの印字どおり）' : '（消費税は税率ごとに1回だけ端数処理）')
    + `<br><span class="rr-check-fix">税込から税抜に直すときの数円のずれは、その税率でいちばん大きい行の原価に寄せて、合計がぴったり合うようにしています</span>`;
}

function updateReceiptAmt(i) {
  const el = document.getElementById('rr-amt-' + i);
  if (el) el.textContent = fmt(receiptItems[i].price * receiptItems[i].qty);
  updateReceiptTotals();
}

function removeReceiptItem(i) {
  receiptItems.splice(i, 1);
  renderReceiptItems();
}

function addReceiptToCart() {
  if (!selectedSupplier) { showToast('発注先を選択してください'); return; }
  if (!receiptItems.length) { showToast('品目がありません'); return; }

  // 確定した内訳（行ごとの税抜額と、レシートに印字された消費税）をそのまま使う
  const st = receiptSettle();
  if(st.taxFromPrint) cartTaxPrinted = (cartTaxPrinted||0) + st.tax;

  st.lines.forEach(it => {
    // 同じ品名でも税率が違えば別の行にする（まとめると消費税が合わなくなる）。
    // 端数を寄せた行は、寄せたぶんが混ざらないよう、まとめずに別の行で持つ
    const existing = (it.costAdjust===0)
      ? cart.find(c => c.name === it.name && c._receipt && taxRateOf(c) === taxRateOf(it) && !c.costAdjust)
      : null;
    if (existing) {
      existing.qty += it.qty;
    } else {
      cart.push({
        id: it._id,
        name: it.name,
        qty: it.qty,
        unit: it.unit,
        cost: it.cost,
        price: it.cost,
        costAdjust: it.costAdjust || 0,   // 税込→税抜の丸めで出た端数（円）
        taxRate: taxRateOf(it),
        supplier: selectedSupplier.name,
        cat: '仕入',
        _receipt: true,
      });
    }
  });

  // 品目をいじったら印字の消費税を使わない判定に使う（いまの小計を覚えておく）
  cartTaxPrintedBase = cartReceiptSubtotal();

  // 台帳に残すための材料を、発注確定のときまで持っておく
  cartReceiptRecord = {
    paidOn: receiptPaidOn || localYmd(new Date()),
    shop: receiptShop,
    subtotal: st.subtotal, tax: st.tax, total: st.total,
    taxRows: st.rows,
    items: st.lines.map(l=>({name:l.name, qty:l.qty, unit:l.unit, price:l.price, taxRate:l.taxRate})),
    image: receiptImageBase64,
  };

  closeReceiptConfirm();
  renderItemSelectList();
  renderCart();
  showToast(`✅ ${receiptItems.length}件をカートに追加しました`);
}
