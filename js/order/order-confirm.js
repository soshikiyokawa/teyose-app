// ════ 受発注：発注書プレビュー・発注確定 ════

// レシートから取り込んだ品目がカートにあるか（＝その場で支払い済みの発注）
function isReceiptOrder(){ return cart.some(c=>c._receipt); }

// カートの内容・費目区分・納品希望日（レシートの場合は支払方法）が揃うまで
// 「発注書作成」ボタンを押せないように見せる
// （クリック自体は無効化しない。押された時にエラーを表示するため）
function updateOrderPreviewBtnState(){
  const btn=document.getElementById('order-preview-btn');
  if(!btn) return;
  // レシート取り込みは支払済みなので、納品希望日の代わりに支払方法を必須にする
  const receipt=isReceiptOrder();
  const dueWrap=document.getElementById('order-due-wrap');
  const payWrap=document.getElementById('order-pay-wrap');
  if(dueWrap) dueWrap.style.display = receipt ? 'none' : '';
  if(payWrap) payWrap.style.display = receipt ? '' : 'none';

  const costType=document.getElementById('order-cost-type')?.value;
  const dueDate=document.getElementById('order-due-date')?.value;
  const payment=document.getElementById('order-payment')?.value;
  const project=document.getElementById('order-project')?.value;
  const ready = !!(cart.length && costType && project && (receipt ? payment : dueDate));
  btn.classList.toggle('btn-incomplete', !ready);
}

function openOrderPreview(){
  if(!cart.length){alert('カートが空です。');return;}
  const receipt=isReceiptOrder();
  const costType=document.getElementById('order-cost-type').value;
  const dueDate=receipt ? '' : document.getElementById('order-due-date').value;
  const payment=receipt ? document.getElementById('order-payment').value : '';
  const project=document.getElementById('order-project').value;
  if(!project){alert('案件を選択してください。\n（現場に紐づかない発注の場合は「在庫分」を選択）');return;}
  if(!costType){alert('費目区分を選択してください。');return;}
  if(receipt && !payment){alert('支払方法（JCB／Visa／現金）を選択してください。');return;}
  if(!receipt && !dueDate){alert('納品希望日を入力してください。');return;}
  // 在庫からの出庫：出庫先は現場（案件）のみ。確定直前にも在庫数を再チェックする
  if(selectedSupplier?.name==='在庫分'){
    if(project==='在庫分'){alert('発注先「在庫分」の場合は、在庫を使う現場（案件）を選択してください。');return;}
    const stock=calcStock();
    for(const c of cart){
      const s=stock[c.name];
      if(!s || c.qty>s.qty){alert(`在庫が足りません。「${c.name}」の現在庫は ${s?s.qty:0}${c.unit} です。`);return;}
    }
  }
  const now=new Date();
  const date=now.toISOString().slice(0,10);
  const no=now.getFullYear()+String(now.getMonth()+1).padStart(2,'0')+String(now.getDate()).padStart(2,'0')+String(now.getHours()).padStart(2,'0')+String(now.getMinutes()).padStart(2,'0');
  const sup=selectedSupplier||{name:'—',tel:'',email:''};
  // メーカー送料を含めた形にする。
  //   1つごとの送料 … 単価に足し込む
  //   1回の発注につきの送料 … 「送料」の行としてまとめて足す
  const orderItems=cart.map(c=>{
    const {shipping, shippingPer, ...rest}=c;
    const add=cartUnitShipping(c);
    return add ? {...rest, cost:c.cost+add, price:c.cost+add, shippingIncluded:add} : {...rest};
  });
  const ship=cartOrderShipping();
  if(ship) orderItems.push({name:'送料',qty:1,unit:'式',cost:ship,price:ship,isShipping:true,supplier:sup.name});
  const subtotal=orderItems.reduce((s,c)=>s+c.cost*c.qty,0);
  const tax=Math.round(subtotal*.1);
  currentOrder={no,project,date,dueDate,costType,paymentMethod:payment,suppliers:sup.name,supplierObj:sup,items:orderItems,subtotal,tax,total:subtotal+tax};

  document.getElementById('order-pdf-body').innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
      <div><div style="font-size:22px;font-weight:900;letter-spacing:.04em;color:#2a1e0e;margin-bottom:2px">発 注 書</div><div style="font-size:11px;color:#888">Purchase Order</div></div>
      <div style="text-align:right;font-size:11px;color:#555;line-height:1.7"><div style="font-weight:800;font-size:13px;color:#2a1e0e">${COMPANY.name}</div><div>${COMPANY.zip} ${COMPANY.address}</div><div>TEL：${COMPANY.tel}</div><div style="color:#5c7a3e">${COMPANY.url}</div></div>
    </div>
    <div style="background:#f7f3eb;border-radius:7px;padding:10px 12px;margin-bottom:16px;font-size:12px">
      <div style="margin-bottom:4px"><span style="color:#888">発注先：</span><strong>${sup.name}</strong>${sup.contact&&sup.contact!=='—'?`　担当：${sup.contact}`:''}</div>
      <div style="display:flex;gap:16px;margin-bottom:4px"><div style="flex:1"><span style="color:#888">発注番号：</span><strong>${no}</strong></div><div style="flex:1"><span style="color:#888">発注日：</span><strong>${date}</strong></div></div>
      <div style="display:flex;gap:16px;margin-bottom:4px"><div style="flex:1"><span style="color:#888">費目区分：</span><strong>${costType}</strong></div></div>
      <div style="display:flex;gap:16px"><div style="flex:1"><span style="color:#888">物件名：</span><strong>${project}</strong></div><div style="flex:1">${receipt?`<span style="color:#888">支払方法：</span><strong>${payment}</strong>`:`<span style="color:#888">納品希望日：</span><strong>${dueDate||'未指定'}</strong>`}</div></div>
      ${sup.tel?`<div style="margin-top:4px"><span style="color:#888">TEL：</span><strong>${sup.tel}</strong></div>`:''}
    </div>
    <div style="display:flex;background:#2a1e0e;font-size:11px;color:#d4a96a">
      <div style="flex:3;padding:6px 8px;text-align:left">品目名</div>
      <div style="flex:1;padding:6px 8px;text-align:center">単位</div>
      <div style="flex:1;padding:6px 8px;text-align:right">数量</div>
      <div style="flex:1.2;padding:6px 8px;text-align:right">単価</div>
      <div style="flex:1.2;padding:6px 8px;text-align:right">金額</div>
    </div>
    ${orderItems.map(c=>`<div style="display:flex;font-size:12px;border-bottom:0.5px solid #e8e0d0">
      <div style="flex:3;min-width:0;padding:6px 8px;word-break:break-word;overflow-wrap:anywhere">${c.name}${
        c.shippingIncluded?`<span style="font-size:10px;color:#888">（送料 ¥${fmt(c.shippingIncluded)} 込み）</span>`:''}</div>
      <div style="flex:1;padding:6px 8px;text-align:center">${c.unit}</div>
      <div style="flex:1;padding:6px 8px;text-align:right">${c.qty}</div>
      <div style="flex:1.2;padding:6px 8px;text-align:right">¥${fmt(c.cost)}</div>
      <div style="flex:1.2;padding:6px 8px;text-align:right;font-weight:600">¥${fmt(c.cost*c.qty)}</div>
    </div>`).join('')}
    <div style="margin-top:12px;text-align:right;font-size:13px;line-height:2.2">
      <div>小計：¥${fmt(subtotal)}</div>
      <div>消費税（10%）：¥${fmt(tax)}</div>
      <div style="font-size:17px;font-weight:800;color:#4a3010">合計：¥${fmt(subtotal+tax)}</div>
    </div>
    <div style="margin-top:14px;font-size:11px;color:#888;border-top:1px solid #e0d8c8;padding-top:10px">
      ${receipt
        ? `この発注はレシートから取り込んだ支払済みの記録です（支払方法：${payment}）。`
        : `納品場所：${project} 現場　／　ご納品の際は現場担当者へご連絡ください。`}
    </div>`;
  document.getElementById('order-pdf-foot').style.display='';
  document.getElementById('order-pdf-overlay').classList.add('open');
}

function closeOrderPdf(){document.getElementById('order-pdf-overlay').classList.remove('open');}

async function confirmOrder(){
  if(!currentOrder) return;
  const btn = document.querySelector('#order-pdf-foot .btn.wood');
  if(btn){btn.disabled=true;btn.textContent='処理中…';}

  // ① PDF生成（失敗しても発注確定は続行する。フォント取得エラー等で落ちることがあるため）
  try{
    currentOrder.pdfUrl = await dbGenerateOrderPdf(currentOrder);
  }catch(pdfErr){
    console.warn('PDF生成に失敗しました（発注確定は続行）:', pdfErr);
    currentOrder.pdfUrl = null;
  }

  // ② 発注データ・原価・チャットへの投稿をまとめて確定（Supabaseに保存）
  try{
    await dbConfirmOrder(currentOrder);
  }catch(e){
    if(btn){btn.disabled=false;btn.textContent='✓ 発注確定・PDF保存';}
    showToast('発注確定に失敗しました：'+e.message);
    return;
  }

  orders.unshift({...currentOrder, status:'pending'});
  currentOrder.items.forEach(item=>{
    costEntries.unshift({
      date:currentOrder.date, project:currentOrder.project,
      name:item.name, qty:item.qty, unit:item.unit,
      amount:item.cost*item.qty, supplier:item.supplier,
      orderNo:currentOrder.no, costType:currentOrder.costType, status:'pending'
    });
  });

  // UI後処理
  cart = []; currentOrder = null;
  document.getElementById('order-due-date').value = '';
  document.getElementById('order-payment').value = '';
  document.getElementById('order-cost-type').value = '';
  document.getElementById('order-project').value = '';
  renderCart();
  updateOrderPreviewBtnState();
  if(selectedSupplier) renderItemSelectList();
  closeOrderPdf();
  if(btn){btn.disabled=false;btn.textContent='✓ 発注確定・PDF保存';}
  document.getElementById('nav-talk-dot').style.display='block';
  showToast('✅ 発注確定・チャットに記録しました');
}

function buildOrderPdfHtml(o){
  const edits=Array.isArray(o.priceEdits)?o.priceEdits:[];
  const last=edits.length?edits[edits.length-1]:null;
  const editedOn=last?String(last.at||'').slice(0,10):'';
  return `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px"><div><div style="font-size:22px;font-weight:900;color:#2a1e0e;margin-bottom:2px">発 注 書</div><div style="font-size:11px;color:#888">Purchase Order</div>${last?`<div style="font-size:11px;color:#5c7a3e;font-weight:700;margin-top:3px">単価変更あり（${editedOn} 改定・${edits.length}回目）</div>`:''}</div><div style="text-align:right;font-size:11px;color:#555;line-height:1.7"><div style="font-weight:800;font-size:13px;color:#2a1e0e">${COMPANY.name}</div><div>${COMPANY.zip} ${COMPANY.address}</div><div>TEL：${COMPANY.tel}</div><div style="color:#5c7a3e">${COMPANY.url}</div></div></div><div style="background:#f7f3eb;border-radius:7px;padding:10px 12px;margin-bottom:16px;display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:12px"><div style="grid-column:1/-1"><span style="color:#888">発注先：</span><strong>${o.suppliers}</strong></div><div><span style="color:#888">発注番号：</span><strong>${o.no}</strong></div><div><span style="color:#888">発注日：</span><strong>${o.date}</strong></div><div><span style="color:#888">物件名：</span><strong>${o.project}</strong></div><div>${o.paymentMethod?`<span style="color:#888">支払方法：</span><strong>${o.paymentMethod}</strong>`:`<span style="color:#888">納品希望日：</span><strong>${o.dueDate||'未指定'}</strong>`}</div></div><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#2a1e0e"><th style="padding:6px 8px;text-align:left;color:#d4a96a;font-size:11px">品目名</th><th style="padding:6px 8px;color:#d4a96a;font-size:11px">単位</th><th style="padding:6px 8px;text-align:right;color:#d4a96a;font-size:11px">数量</th><th style="padding:6px 8px;text-align:right;color:#d4a96a;font-size:11px">単価</th><th style="padding:6px 8px;text-align:right;color:#d4a96a;font-size:11px">金額</th></tr></thead><tbody>${o.items.map(c=>{
    // 単価をあとから直した品目は、当初いくらだったかも載せる
    const now=(typeof itemNowPrice==='function')?itemNowPrice(c):Math.round(Number(c.cost??c.price)||0);
    const orig=(typeof itemOrigPrice==='function')?itemOrigPrice(c):now;
    const q=Number(c.qty)||0;
    const was=orig!==now?`<div style="font-size:10px;color:#999">当初 ¥${fmt(orig)}</div>`:'';
    return `<tr><td style="padding:6px 8px;border:0.5px solid #e8e0d0;word-break:break-word;overflow-wrap:anywhere">${c.name}</td><td style="padding:6px 8px;border:0.5px solid #e8e0d0;white-space:nowrap">${c.unit}</td><td style="padding:6px 8px;border:0.5px solid #e8e0d0;text-align:right">${q}</td><td style="padding:6px 8px;border:0.5px solid #e8e0d0;text-align:right">¥${fmt(now)}${was}</td><td style="padding:6px 8px;border:0.5px solid #e8e0d0;text-align:right;font-weight:600">¥${fmt(now*q)}</td></tr>`;
  }).join('')}</tbody></table><div style="margin-top:12px;text-align:right;font-size:13px;line-height:2.2"><div>小計：¥${fmt(o.subtotal)}</div><div>消費税（10%）：¥${fmt(o.tax)}</div><div style="font-size:17px;font-weight:800;color:#4a3010">合計：¥${fmt(o.total)}</div>${last?`<div style="font-size:11px;color:#888;line-height:1.6">（当初の合計：¥${fmt(edits[0]?.total?.before)}）</div>`:''}</div>${o.paymentMethod?`<div style="margin-top:14px;font-size:11px;color:#888;border-top:1px solid #e0d8c8;padding-top:10px">この発注はレシートから取り込んだ支払済みの記録です（支払方法：${o.paymentMethod}）。</div>`:`<div style="margin-top:14px;font-size:11px;color:#888;border-top:1px solid #e0d8c8;padding-top:10px">納品場所：${o.project} 現場　／　ご納品の際は現場担当者へご連絡ください。</div>`}`;
}
