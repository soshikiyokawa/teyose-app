// ════ 見積：見積書PDFプレビュー・印刷 ════

function openEstPdf(){
  const data=collectEstData();
  const c=recalcSum();
  const rows=data.sections.map(sec=>{
    const sTotal=sec.items.reduce((s,i)=>s+i.qty*i.price,0);
    return `<tr><td colspan="6" style="padding:7px 8px;background:#f0ebe0;font-weight:700;font-size:13px;border-top:2px solid #d4c9b0">${sec.name||'（工種未入力）'}</td></tr>
    ${sec.items.map(i=>`<tr><td style="padding:5px 7px">${i.name}</td><td style="padding:5px 7px;color:#666">${i.spec}</td><td style="padding:5px 7px;text-align:right">${i.qty}</td><td style="padding:5px 7px">${i.unit}</td><td style="padding:5px 7px;text-align:right">¥${fmt(i.price)}</td><td style="padding:5px 7px;text-align:right;font-weight:600">¥${fmt(i.qty*i.price)}</td></tr>`).join('')}
    <tr style="background:#faf7f0"><td colspan="5" style="padding:5px 8px;text-align:right;font-size:12px;color:#888">小計</td><td style="padding:5px 8px;text-align:right;font-weight:700;color:#5c3d1e">¥${fmt(sTotal)}</td></tr>`;
  }).join('');
  document.getElementById('est-pdf-body').innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px">
      <div><div style="font-size:24px;font-weight:900;letter-spacing:.06em;color:#2a1e0e;margin-bottom:2px">御 見 積 書</div><div style="font-size:11px;color:#888">ESTIMATE</div></div>
      <div style="text-align:right;font-size:11px;color:#555;line-height:1.7"><div style="font-weight:800;font-size:13px;color:#2a1e0e">${COMPANY.name}</div><div>${COMPANY.zip} ${COMPANY.address}</div><div>TEL：${COMPANY.tel}</div><div style="color:#5c7a3e">${COMPANY.url}</div></div>
    </div>
    <div style="background:#f7f3eb;border-radius:7px;padding:12px 14px;margin-bottom:16px;display:grid;grid-template-columns:1fr 1fr;gap:5px 18px;font-size:12px">
      <div><span style="color:#888">施主名：</span><strong>${data.clientName||'　'}</strong></div>
      <div><span style="color:#888">見積番号：</span><strong>${data.no||'　'}</strong></div>
      <div style="grid-column:1/-1"><span style="color:#888">物件名：</span><strong>${data.siteName||'　'}</strong></div>
      <div><span style="color:#888">見積日：</span><strong>${data.date||'　'}</strong></div>
      <div><span style="color:#888">有効期限：</span><strong>${data.expire||'　'}</strong></div>
      <div><span style="color:#888">工事区分：</span><strong>${data.type}</strong></div>
      <div><span style="color:#888">工期：</span><strong>${data.duration||'　'}</strong></div>
    </div>
    <div style="font-size:15px;font-weight:800;color:#2a1e0e;margin-bottom:8px;text-align:right">合計金額（税込）：<span style="font-size:20px;color:#5c3d1e">¥${fmt(c.total)}</span></div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px">
      <thead><tr style="background:#2a1e0e">
        <th style="padding:6px 7px;text-align:left;color:#d4a96a;font-size:11px">工事・品目名</th>
        <th style="padding:6px 7px;text-align:left;color:#d4a96a;font-size:11px">規格・仕様</th>
        <th style="padding:6px 7px;text-align:right;color:#d4a96a;font-size:11px">数量</th>
        <th style="padding:6px 7px;color:#d4a96a;font-size:11px">単位</th>
        <th style="padding:6px 7px;text-align:right;color:#d4a96a;font-size:11px">単価</th>
        <th style="padding:6px 7px;text-align:right;color:#d4a96a;font-size:11px">金額</th>
      </tr></thead>
      <tbody style="border:1px solid #e0d8c8">${rows}</tbody>
    </table>
    <table style="width:240px;margin-left:auto;border-collapse:collapse;font-size:13px">
      <tr><td style="padding:5px 7px;color:#666">工事費 小計</td><td style="padding:5px 7px;text-align:right">¥${fmt(c.wTotal)}</td></tr>
      <tr><td style="padding:5px 7px;color:#666">諸経費（${c.miscRate}%）</td><td style="padding:5px 7px;text-align:right">¥${fmt(c.misc)}</td></tr>
      <tr style="border-top:0.5px solid #ccc"><td style="padding:5px 7px;color:#666">小計</td><td style="padding:5px 7px;text-align:right">¥${fmt(c.sub2)}</td></tr>
      <tr><td style="padding:5px 7px;color:#666">消費税（${c.taxRate}%）</td><td style="padding:5px 7px;text-align:right">¥${fmt(c.tax)}</td></tr>
      <tr style="background:#2a1e0e"><td style="padding:7px 8px;font-weight:800;color:#d4a96a;font-size:14px">合計金額</td><td style="padding:7px 8px;text-align:right;font-weight:800;color:#fff;font-size:15px">¥${fmt(c.total)}</td></tr>
    </table>
    ${data.note?`<div style="margin-top:14px;font-size:12px;color:#555;border-top:1px solid #e0d8c8;padding-top:10px"><strong>備考：</strong>${data.note}</div>`:''}
    <div style="margin-top:18px;font-size:11px;color:#888;text-align:center">上記の通り御見積申し上げます。</div>`;
  document.getElementById('est-pdf-overlay').classList.add('open');
}
function closeEstPdf(){document.getElementById('est-pdf-overlay').classList.remove('open');}

function printEstPdf(){
  const body=document.getElementById('est-pdf-body').innerHTML;
  printHtml('御見積書', body);
}
