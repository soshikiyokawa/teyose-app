// ════ レシート読み取り（カメラ→Claude Vision→カートに追加） ════

let receiptItems = [];

function openReceiptCamera() {
  document.getElementById('receipt-file-input').click();
}

async function onReceiptFileChange(input) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';

  showReceiptLoading(true);

  try {
    const base64 = await fileToBase64(input.files[0] || file);
    const mediaType = file.type || 'image/jpeg';

    const { data, error } = await sb.functions.invoke('read-receipt', {
      body: { image: base64, mediaType }
    });

    if (error) throw new Error(error.message);
    if (!data?.items?.length) { showToast('品目を読み取れませんでした。もう一度お試しください。'); showReceiptLoading(false); return; }

    receiptItems = data.items.map((it, i) => ({
      _id: 'rc_' + i,
      name: it.name || '不明',
      qty: parseFloat(it.qty) || 1,
      unit: it.unit || '式',
      price: Math.round(parseFloat(it.price) || parseFloat(it.amount) || 0),
      amount: Math.round(parseFloat(it.amount) || 0),
    }));

    showReceiptLoading(false);
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

  el.innerHTML = `<div style="font-size:11px;color:var(--text-muted);padding:4px 0 8px;text-align:center">
    税込金額で表示 → 原価登録時に税抜換算（÷1.1）します
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
        <span style="font-size:11px;color:var(--text-muted)">税込単価</span>
        <input class="rr-input num" type="number" min="0" step="1" value="${it.price}" onchange="receiptItems[${i}].price=parseFloat(this.value)||0;updateReceiptAmt(${i})">
      </div>
      <div class="rr-amt" style="flex-direction:column;align-items:flex-end;gap:1px">
        <span style="font-size:11px">税込 ¥<span id="rr-amt-${i}">${fmt(it.price * it.qty)}</span></span>
        <span style="font-size:10px;color:var(--text-muted)">税抜 ¥${fmt(Math.floor(it.price / 1.1) * it.qty)}</span>
      </div>
      <button class="btn danger xs" onclick="removeReceiptItem(${i})" style="flex-shrink:0">×</button>
    </div>`).join('');

  const total = receiptItems.reduce((s, it) => s + it.price * it.qty, 0);
  const totalEx = receiptItems.reduce((s, it) => s + Math.floor(it.price / 1.1) * it.qty, 0);
  document.getElementById('receipt-total').textContent = fmt(total);
  const exEl = document.getElementById('receipt-total-ex');
  if (exEl) exEl.textContent = fmt(totalEx);
}

function updateReceiptAmt(i) {
  const el = document.getElementById('rr-amt-' + i);
  if (el) el.textContent = fmt(receiptItems[i].price * receiptItems[i].qty);
  const total = receiptItems.reduce((s, it) => s + it.price * it.qty, 0);
  const totalEx = receiptItems.reduce((s, it) => s + Math.floor(it.price / 1.1) * it.qty, 0);
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
      const costEx = Math.floor(it.price / 1.1);
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
