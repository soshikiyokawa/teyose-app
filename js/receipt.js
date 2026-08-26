// ════ レシート読み取り（カメラ→Claude Vision→カートに追加） ════

let receiptItems = [];
// 読み取った明細の単価が税込かどうか。レシートによって違うので読み取り側に判定してもらう。
// 原価は税抜で持つので、税込のときだけ ÷1.1 する
let receiptTaxIncluded = true;
function setReceiptTaxIncluded(v){ receiptTaxIncluded = !!v; renderReceiptItems(); }
// 表示・登録に使う税抜の単価
function receiptCostEx(price){ return receiptTaxIncluded ? Math.round(price / 1.1) : Math.round(price); }

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

async function onReceiptFileChange(input) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';

  const isPdf = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name || '');
  if (isPdf && file.size > 25*1024*1024) { showToast('PDFが大きすぎます（25MBまで）。ページを分けてください'); return; }

  showReceiptLoading(true);

  try {
    let base64, mediaType = file.type || '';
    if (!isPdf) {
      const small = await receiptShrinkImage(file).catch(() => null);
      if (small) { base64 = small.base64; mediaType = small.mediaType; }
    }
    if (!base64) base64 = await fileToBase64(file);

    const { data, error } = await sb.functions.invoke('read-receipt', {
      // スマホから選ぶと種類が空のことがあるので、ファイル名も送って判断してもらう
      body: { file: base64, image: base64, mediaType, fileName: file.name || '' }
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
    }));

    receiptTaxIncluded = data.taxIncluded !== false;
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

  el.innerHTML = `<div class="rr-tax">
    <span>レシートの単価は</span>
    <button class="btn xs${receiptTaxIncluded?' primary':''}" onclick="setReceiptTaxIncluded(true)">税込</button>
    <button class="btn xs${receiptTaxIncluded?'':' primary'}" onclick="setReceiptTaxIncluded(false)">税抜</button>
    <span class="rr-tax-note">${receiptTaxIncluded
      ? '原価は税抜（÷1.1）にして登録します'
      : 'そのまま原価（税抜）として登録します'}</span>
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
      <div class="rr-amt" style="flex-direction:column;align-items:flex-end;gap:1px">
        <span style="font-size:11px">${receiptTaxIncluded?'税込':'税抜'} ¥<span id="rr-amt-${i}">${fmt(it.price * it.qty)}</span></span>
        <span style="font-size:10px;color:var(--text-muted)">原価 ¥${fmt(receiptCostEx(it.price) * it.qty)}</span>
      </div>
      <button class="btn danger xs" onclick="removeReceiptItem(${i})" style="flex-shrink:0">×</button>
    </div>`).join('');

  const total = receiptItems.reduce((s, it) => s + it.price * it.qty, 0);
  const totalEx = receiptItems.reduce((s, it) => s + receiptCostEx(it.price) * it.qty, 0);
  document.getElementById('receipt-total').textContent = fmt(total);
  const exEl = document.getElementById('receipt-total-ex');
  if (exEl) exEl.textContent = fmt(totalEx);
}

function updateReceiptAmt(i) {
  const el = document.getElementById('rr-amt-' + i);
  if (el) el.textContent = fmt(receiptItems[i].price * receiptItems[i].qty);
  const total = receiptItems.reduce((s, it) => s + it.price * it.qty, 0);
  const totalEx = receiptItems.reduce((s, it) => s + receiptCostEx(it.price) * it.qty, 0);
  document.getElementById('receipt-total').textContent = fmt(total);
  const exEl = document.getElementById('receipt-total-ex');
  if (exEl) exEl.textContent = fmt(totalEx);
}

function removeReceiptItem(i) {
  receiptItems.splice(i, 1);
  renderReceiptItems();
}

function addReceiptToCart() {
  if (!selectedSupplier) { showToast('発注先を選択してください'); return; }
  if (!receiptItems.length) { showToast('品目がありません'); return; }

  receiptItems.forEach(it => {
    const existing = cart.find(c => c.name === it.name && c._receipt);
    if (existing) {
      existing.qty += it.qty;
    } else {
      const costEx = receiptCostEx(it.price);
      cart.push({
        id: it._id,
        name: it.name,
        qty: it.qty,
        unit: it.unit,
        cost: costEx,
        price: costEx,
        supplier: selectedSupplier.name,
        cat: '仕入',
        _receipt: true,
      });
    }
  });

  closeReceiptConfirm();
  renderItemSelectList();
  renderCart();
  showToast(`✅ ${receiptItems.length}件をカートに追加しました`);
}
