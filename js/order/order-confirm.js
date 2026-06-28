// ════ 受発注：発注書プレビュー・発注確定 ════

function openOrderPreview(){
  if(!cart.length){alert('カートが空です。');return;}
  const project=document.getElementById('g-project').value;
  const now=new Date();
  const date=now.toISOString().slice(0,10);
  const no=now.getFullYear()+String(now.getMonth()+1).padStart(2,'0')+String(now.getDate()).padStart(2,'0')+String(now.getHours()).padStart(2,'0')+String(now.getMinutes()).padStart(2,'0');
  const sup=selectedSupplier||{name:'—',tel:'',email:''};
  const subtotal=cart.reduce((s,c)=>s+c.price*c.qty,0);
  const tax=Math.round(subtotal*.1);
  const dueDate=document.getElementById('order-due-date').value;
  currentOrder={no,project,date,dueDate,suppliers:sup.name,supplierObj:sup,items:[...cart.map(c=>({...c}))],subtotal,tax,total:subtotal+tax};

  document.getElementById('order-pdf-body').innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
      <div><div style="font-size:22px;font-weight:900;letter-spacing:.04em;color:#2a1e0e;margin-bottom:2px">発 注 書</div><div style="font-size:11px;color:#888">Purchase Order</div></div>
      <div style="text-align:right;font-size:11px;color:#555;line-height:1.7"><div style="font-weight:800;font-size:13px;color:#2a1e0e">${COMPANY.name}</div><div>${COMPANY.zip} ${COMPANY.address}</div><div>TEL：${COMPANY.tel}</div><div style="color:#5c7a3e">${COMPANY.url}</div></div>
    </div>
    <div style="background:#f7f3eb;border-radius:7px;padding:10px 12px;margin-bottom:16px;display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:12px">
      <div style="grid-column:1/-1"><span style="color:#888">発注先：</span><strong>${sup.name}</strong>${sup.contact&&sup.contact!=='—'?`　担当：${sup.contact}`:''}</div>
      <div><span style="color:#888">発注番号：</span><strong>${no}</strong></div>
      <div><span style="color:#888">発注日：</span><strong>${date}</strong></div>
      <div><span style="color:#888">物件名：</span><strong>${project}</strong></div>
      <div><span style="color:#888">納品希望日：</span><strong>${dueDate||'未指定'}</strong></div>
      ${sup.tel?`<div><span style="color:#888">TEL：</span><strong>${sup.tel}</strong></div>`:''}
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#2a1e0e">
        <th style="padding:6px 8px;text-align:left;color:#d4a96a;font-size:11px">品目名</th>
        <th style="padding:6px 8px;color:#d4a96a;font-size:11px">単位</th>
        <th style="padding:6px 8px;text-align:right;color:#d4a96a;font-size:11px">数量</th>
        <th style="padding:6px 8px;text-align:right;color:#d4a96a;font-size:11px">単価</th>
        <th style="padding:6px 8px;text-align:right;color:#d4a96a;font-size:11px">金額</th>
      </tr></thead>
      <tbody>${cart.map(c=>`<tr>
        <td style="padding:6px 8px;border:0.5px solid #e8e0d0">${c.name}</td>
        <td style="padding:6px 8px;border:0.5px solid #e8e0d0">${c.unit}</td>
        <td style="padding:6px 8px;border:0.5px solid #e8e0d0;text-align:right">${c.qty}</td>
        <td style="padding:6px 8px;border:0.5px solid #e8e0d0;text-align:right">¥${fmt(c.price)}</td>
        <td style="padding:6px 8px;border:0.5px solid #e8e0d0;text-align:right;font-weight:600">¥${fmt(c.price*c.qty)}</td>
      </tr>`).join('')}</tbody>
    </table>
    <div style="margin-top:12px;text-align:right;font-size:13px;line-height:2.2">
      <div>小計：¥${fmt(subtotal)}</div>
      <div>消費税（10%）：¥${fmt(tax)}</div>
      <div style="font-size:17px;font-weight:800;color:#4a3010">合計：¥${fmt(subtotal+tax)}</div>
    </div>
    <div style="margin-top:14px;font-size:11px;color:#888;border-top:1px solid #e0d8c8;padding-top:10px">
      納品場所：${project} 現場　／　ご納品の際は現場担当者へご連絡ください。
    </div>`;
  document.getElementById('order-pdf-foot').style.display='';
  document.getElementById('order-pdf-overlay').classList.add('open');
}

function closeOrderPdf(){document.getElementById('order-pdf-overlay').classList.remove('open');}

async function confirmOrder(){
  if(!currentOrder) return;
  const btn = document.querySelector('#order-pdf-foot .btn.wood');
  if(btn){btn.disabled=true;btn.textContent='処理中…';}

  try{
    // ① 発注書PDFを生成してSupabase Storageに保存し、チャットに添付できるURLを得る
    const bodyEl = document.getElementById('order-pdf-body');
    const body = bodyEl.innerHTML;
    const pdfBlob = await htmlToPdfBlob(`発注書_${currentOrder.no}`, bodyEl);
    currentOrder.pdfUrl = await dbUploadOrderPdf(currentOrder.no, pdfBlob);

    // ② 発注データ・原価・チャットへの投稿をまとめて確定（Supabaseに保存）
    await dbConfirmOrder(currentOrder);
  }catch(e){
    if(btn){btn.disabled=false;btn.textContent='✓ 発注確定・PDF保存';}
    return;
  }

  orders.unshift({...currentOrder, status:'pending'});
  currentOrder.items.forEach(item=>{
    costEntries.unshift({
      date:currentOrder.date, project:currentOrder.project,
      name:item.name, qty:item.qty, unit:item.unit,
      amount:item.cost*item.qty, supplier:item.supplier,
      orderNo:currentOrder.no, status:'pending'
    });
  });

  // 自分用にも印刷ダイアログを表示（ポップアップブロックされても発注確定は完了済み）
  printHtml(`発注書 ${currentOrder.no}`, body);

  // UI後処理
  cart = []; currentOrder = null;
  document.getElementById('order-due-date').value = '';
  renderCart();
  if(selectedSupplier) renderItemSelectList();
  closeOrderPdf();
  if(btn){btn.disabled=false;btn.textContent='✓ 発注確定・PDF保存';}
  document.getElementById('nav-talk-dot').style.display='block';
  showToast('✅ 発注確定・チャットに記録しました');
}

function buildOrderPdfHtml(o){
  return `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px"><div><div style="font-size:22px;font-weight:900;color:#2a1e0e;margin-bottom:2px">発 注 書</div><div style="font-size:11px;color:#888">Purchase Order</div></div><div style="text-align:right;font-size:11px;color:#555;line-height:1.7"><div style="font-weight:800;font-size:13px;color:#2a1e0e">${COMPANY.name}</div><div>${COMPANY.zip} ${COMPANY.address}</div><div>TEL：${COMPANY.tel}</div><div style="color:#5c7a3e">${COMPANY.url}</div></div></div><div style="background:#f7f3eb;border-radius:7px;padding:10px 12px;margin-bottom:16px;display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:12px"><div style="grid-column:1/-1"><span style="color:#888">発注先：</span><strong>${o.suppliers}</strong></div><div><span style="color:#888">発注番号：</span><strong>${o.no}</strong></div><div><span style="color:#888">発注日：</span><strong>${o.date}</strong></div><div><span style="color:#888">物件名：</span><strong>${o.project}</strong></div><div><span style="color:#888">納品希望日：</span><strong>${o.dueDate||'未指定'}</strong></div></div><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#2a1e0e"><th style="padding:6px 8px;text-align:left;color:#d4a96a;font-size:11px">品目名</th><th style="padding:6px 8px;color:#d4a96a;font-size:11px">単位</th><th style="padding:6px 8px;text-align:right;color:#d4a96a;font-size:11px">数量</th><th style="padding:6px 8px;text-align:right;color:#d4a96a;font-size:11px">単価</th><th style="padding:6px 8px;text-align:right;color:#d4a96a;font-size:11px">金額</th></tr></thead><tbody>${o.items.map(c=>`<tr><td style="padding:6px 8px;border:0.5px solid #e8e0d0">${c.name}</td><td style="padding:6px 8px;border:0.5px solid #e8e0d0">${c.unit}</td><td style="padding:6px 8px;border:0.5px solid #e8e0d0;text-align:right">${c.qty}</td><td style="padding:6px 8px;border:0.5px solid #e8e0d0;text-align:right">¥${fmt(c.price)}</td><td style="padding:6px 8px;border:0.5px solid #e8e0d0;text-align:right;font-weight:600">¥${fmt(c.price*c.qty)}</td></tr>`).join('')}</tbody></table><div style="margin-top:12px;text-align:right;font-size:13px;line-height:2.2"><div>小計：¥${fmt(o.subtotal)}</div><div>消費税（10%）：¥${fmt(o.tax)}</div><div style="font-size:17px;font-weight:800;color:#4a3010">合計：¥${fmt(o.total)}</div></div><div style="margin-top:14px;font-size:11px;color:#888;border-top:1px solid #e0d8c8;padding-top:10px">納品場所：${o.project} 現場　／　ご納品の際は現場担当者へご連絡ください。</div>`;
}
